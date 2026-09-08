import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db/prisma';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '../../src/utils/cookies';
import { resetDatabase } from '../helpers/db';

const app = createApp();

const VALID_USER = {
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'Analytical1!',
};

beforeEach(resetDatabase);

/** Reads the Set-Cookie header for one cookie name, or undefined if it wasn't set. */
function cookieFor(response: request.Response, name: string): string | undefined {
  const headers = (response.headers['set-cookie'] ?? []) as unknown as string[];
  return headers.find((header) => header.startsWith(`${name}=`));
}

function cookieValue(response: request.Response, name: string): string | undefined {
  return cookieFor(response, name)?.split(';')[0]?.split('=')[1];
}

describe('POST /api/auth/register', () => {
  it('creates the account, returns the bare user and signs them in', async () => {
    const response = await request(app).post('/api/auth/register').send(VALID_USER);

    expect(response.status).toBe(201);
    // The frontend types AuthResponse as User itself, not { user: ... }.
    expect(response.body).toEqual({
      id: expect.any(String),
      fullName: 'Ada Lovelace',
      email: 'ada@example.com',
      mustChangePassword: false,
    });
    expect(cookieFor(response, ACCESS_TOKEN_COOKIE)).toContain('HttpOnly');
    expect(cookieFor(response, REFRESH_TOKEN_COOKIE)).toContain('HttpOnly');
  });

  it('stores a bcrypt hash and never the password itself', async () => {
    await request(app).post('/api/auth/register').send(VALID_USER);

    const user = await prisma.user.findUnique({ where: { email: VALID_USER.email } });

    expect(user?.passwordHash).not.toBe(VALID_USER.password);
    expect(user?.passwordHash.startsWith('$2')).toBe(true);
  });

  it('leaks neither tokens nor the password hash in the response body', async () => {
    const response = await request(app).post('/api/auth/register').send(VALID_USER);
    const body = JSON.stringify(response.body);

    expect(body).not.toContain(VALID_USER.password);
    expect(body).not.toMatch(/passwordHash|accessToken|refreshToken|token/i);
  });

  it('normalises the email so casing and spacing cannot create a duplicate account', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ ...VALID_USER, email: '  Ada@EXAMPLE.com  ' });

    const response = await request(app).post('/api/auth/register').send(VALID_USER);

    expect(response.status).toBe(409);
    expect(response.body.errors).toEqual({
      email: 'An account with this email already exists.',
    });
  });

  it.each([
    ['too short', 'Ab1!', 'Password must be at least 8 characters.'],
    ['missing a number', 'Analytical!', 'Password must contain at least one number.'],
    ['missing a symbol', 'Analytical1', 'Password must contain at least one symbol.'],
  ])('rejects a password that is %s', async (_label, password, message) => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ ...VALID_USER, password });

    expect(response.status).toBe(400);
    expect(response.body.errors.password).toBe(message);
    expect(await prisma.user.count()).toBe(0);
  });

  it('reports every invalid field at once for the form to render', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'A', email: 'not-an-email', password: 'weak' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed.');
    expect(Object.keys(response.body.errors).sort()).toEqual(['email', 'fullName', 'password']);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/auth/register').send(VALID_USER);
  });

  it('returns the user and sets both cookies', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password, rememberMe: false });

    expect(response.status).toBe(200);
    expect(response.body.email).toBe(VALID_USER.email);
    expect(cookieFor(response, ACCESS_TOKEN_COOKIE)).toContain('HttpOnly');
    expect(cookieFor(response, REFRESH_TOKEN_COOKIE)).toContain('HttpOnly');
  });

  it('gives Remember Me a longer refresh session without lengthening the access token', async () => {
    // Registration already opened a session; clear it so only the two logins are compared.
    await prisma.refreshToken.deleteMany();

    const without = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password, rememberMe: false });

    const withRememberMe = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password, rememberMe: true });

    const sessions = await prisma.refreshToken.findMany({ orderBy: { createdAt: 'asc' } });
    expect(sessions).toHaveLength(2);
    expect(sessions[1]!.expiresAt.getTime()).toBeGreaterThan(sessions[0]!.expiresAt.getTime());

    // The access cookie's Max-Age is identical either way.
    const maxAge = (response: request.Response) =>
      /Max-Age=(\d+)/.exec(cookieFor(response, ACCESS_TOKEN_COOKIE) ?? '')?.[1];
    expect(maxAge(withRememberMe)).toBe(maxAge(without));
  });

  it('defaults rememberMe to the shorter session when the field is omitted', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password });

    expect(response.status).toBe(200);
  });

  it('answers identically for a wrong password and an unknown account', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: 'Wrong1234!', rememberMe: false });

    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: VALID_USER.password, rememberMe: false });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // Same body, so a caller cannot probe which addresses are registered.
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body).toEqual({ message: 'Invalid email or password.' });
  });

  it('issues no session when the credentials are rejected', async () => {
    await prisma.refreshToken.deleteMany();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: 'Wrong1234!', rememberMe: false });

    expect(cookieFor(response, ACCESS_TOKEN_COOKIE)).toBeUndefined();
    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it('lets the same user hold sessions on several devices at once', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password, rememberMe: false });
    await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password, rememberMe: true });

    // One from registration plus the two logins.
    expect(await prisma.refreshToken.count()).toBe(3);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the signed-in user', async () => {
    const registered = await request(app).post('/api/auth/register').send(VALID_USER);
    const accessToken = cookieValue(registered, ACCESS_TOKEN_COOKIE);

    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(registered.body);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Unauthorized.' });
  });

  it('refuses a refresh token presented in place of an access token', async () => {
    const registered = await request(app).post('/api/auth/register').send(VALID_USER);
    const refreshToken = cookieValue(registered, REFRESH_TOKEN_COOKIE);

    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=${refreshToken}`);

    expect(response.status).toBe(401);
  });

  it('rejects a token whose user has since been deleted', async () => {
    const registered = await request(app).post('/api/auth/register').send(VALID_USER);
    const accessToken = cookieValue(registered, ACCESS_TOKEN_COOKIE);
    await prisma.user.deleteMany();

    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `${ACCESS_TOKEN_COOKIE}=${accessToken}`);

    expect(response.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('invalidates the stored session and clears both cookies', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send(VALID_USER);
    expect(await prisma.refreshToken.count()).toBe(1);

    const response = await agent.post('/api/auth/logout');

    expect(response.status).toBe(204);
    // The row is gone from PostgreSQL, not merely forgotten by the browser.
    expect(await prisma.refreshToken.count()).toBe(0);
    expect(cookieFor(response, ACCESS_TOKEN_COOKIE)).toContain('Expires=Thu, 01 Jan 1970');
    expect(cookieFor(response, REFRESH_TOKEN_COOKIE)).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('ends only the session that logged out, leaving other devices signed in', async () => {
    const firstDevice = request.agent(app);
    await firstDevice.post('/api/auth/register').send(VALID_USER);
    await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password, rememberMe: true });

    await firstDevice.post('/api/auth/logout');

    expect(await prisma.refreshToken.count()).toBe(1);
  });

  it('succeeds without any cookies at all', async () => {
    const response = await request(app).post('/api/auth/logout');

    expect(response.status).toBe(204);
  });

  it('sends the refresh cookie to logout despite its narrowed path', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send(VALID_USER);

    // Proves the /api/auth cookie path reaches logout — with /api/auth/refresh it
    // would not, and the stored token could never be invalidated.
    await agent.post('/api/auth/logout');

    expect(await prisma.refreshToken.count()).toBe(0);
  });
});
