import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db/prisma';
import { generateRefreshToken, hashRefreshToken } from '../../src/services/token.service';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../../src/utils/cookies';
import { resetDatabase } from '../helpers/db';
import { createTestUser } from '../helpers/factories';

const app = createApp();

const VALID_USER = {
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'Analytical1!',
};

const UNAUTHORIZED = { message: 'Unauthorized.' };

beforeEach(resetDatabase);

function cookieFor(response: request.Response, name: string): string | undefined {
  const headers = (response.headers['set-cookie'] ?? []) as unknown as string[];
  return headers.find((header) => header.startsWith(`${name}=`));
}

function cookieValue(response: request.Response, name: string): string {
  const value = cookieFor(response, name)?.split(';')[0]?.split('=')[1];
  if (!value) throw new Error(`No ${name} cookie on response`);
  return value;
}

/** Registers a user and returns the refresh token their session was opened with. */
async function signIn(): Promise<string> {
  const response = await request(app).post('/api/auth/register').send(VALID_USER);
  return cookieValue(response, REFRESH_TOKEN_COOKIE);
}

describe('POST /api/auth/refresh', () => {
  it('issues a new access token and rotates the refresh token', async () => {
    const original = await signIn();

    const response = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${original}`);

    expect(response.status).toBe(200);
    expect(response.body.email).toBe(VALID_USER.email);
    expect(cookieFor(response, ACCESS_TOKEN_COOKIE)).toContain('HttpOnly');
    expect(cookieValue(response, REFRESH_TOKEN_COOKIE)).not.toBe(original);
  });

  it('refuses to redeem the same refresh token twice', async () => {
    const original = await signIn();

    const first = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${original}`);
    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${original}`);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(401);
    expect(replay.body).toEqual(UNAUTHORIZED);
  });

  it('replaces the stored row rather than accumulating sessions', async () => {
    const original = await signIn();

    await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${original}`);

    const rows = await prisma.refreshToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(hashRefreshToken(original));
  });

  it('keeps the original expiry so refreshing cannot extend a session indefinitely', async () => {
    const original = await signIn();
    const before = await prisma.refreshToken.findFirst();

    await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${original}`);

    const after = await prisma.refreshToken.findFirst();
    expect(after!.expiresAt.getTime()).toBe(before!.expiresAt.getTime());
  });

  it('returns an access token that actually works on a protected route', async () => {
    const original = await signIn();

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${original}`);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${cookieValue(refreshed, ACCESS_TOKEN_COOKIE)}`);

    expect(me.status).toBe(200);
    expect(me.body.email).toBe(VALID_USER.email);
  });

  it('rejects a request with no refresh cookie', async () => {
    const response = await request(app).post('/api/auth/refresh');

    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHORIZED);
  });

  it('rejects an unknown refresh token', async () => {
    const response = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${generateRefreshToken()}`);

    expect(response.status).toBe(401);
  });

  it('rejects an expired refresh token and clears the dead row', async () => {
    const user = await createTestUser();
    const token = generateRefreshToken();
    await prisma.refreshToken.create({
      data: {
        tokenHash: hashRefreshToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const response = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${token}`);

    expect(response.status).toBe(401);
    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it('rejects an access token presented at the refresh endpoint', async () => {
    const registered = await request(app).post('/api/auth/register').send(VALID_USER);

    const response = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${cookieValue(registered, ACCESS_TOKEN_COOKIE)}`);

    expect(response.status).toBe(401);
  });

  it('stops working once the user has logged out', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send(VALID_USER);
    await agent.post('/api/auth/logout');

    const response = await agent.post('/api/auth/refresh');

    expect(response.status).toBe(401);
  });

  it('answers every kind of failure with an identical body', async () => {
    const bodies = await Promise.all(
      [
        request(app).post('/api/auth/refresh'),
        request(app)
          .post('/api/auth/refresh')
          .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${generateRefreshToken()}`),
        request(app).post('/api/auth/refresh').set('Cookie', `${REFRESH_TOKEN_COOKIE}=garbage`),
      ].map((pending) => pending.then((response) => response.body)),
    );

    for (const body of bodies) {
      expect(body).toEqual(UNAUTHORIZED);
    }
  });
});
