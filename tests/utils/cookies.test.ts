import express from 'express';
import request from 'supertest';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE_PATH,
  clearAuthCookies,
  setAccessTokenCookie,
  setRefreshTokenCookie,
} from '../../src/utils/cookies';

const app = express();

app.get('/set', (_req, res) => {
  setAccessTokenCookie(res, 'access-token-value');
  setRefreshTokenCookie(res, 'refresh-token-value', new Date(Date.now() + 86_400_000));
  res.status(204).end();
});

app.get('/clear', (_req, res) => {
  clearAuthCookies(res);
  res.status(204).end();
});

/** Picks one Set-Cookie header out of the response by cookie name. */
async function setCookieHeader(path: string, name: string): Promise<string> {
  const response = await request(app).get(path);
  const headers = response.headers['set-cookie'] as unknown as string[];
  const match = headers.find((header) => header.startsWith(`${name}=`));

  if (!match) throw new Error(`No Set-Cookie header for ${name}`);
  return match;
}

describe('auth cookies', () => {
  it('makes the access token HttpOnly and available to the whole API', async () => {
    const cookie = await setCookieHeader('/set', ACCESS_TOKEN_COOKIE);

    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/;');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('scopes the refresh token to the auth routes only', async () => {
    const cookie = await setCookieHeader('/set', REFRESH_TOKEN_COOKIE);

    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain(`Path=${REFRESH_TOKEN_COOKIE_PATH}`);
    // Reaches /api/auth/refresh and /api/auth/logout, but no other API route.
    expect(cookie).not.toContain('Path=/;');
  });

  it('keeps both cookies out of reach of frontend JavaScript', async () => {
    const response = await request(app).get('/set');
    const headers = response.headers['set-cookie'] as unknown as string[];

    expect(headers).toHaveLength(2);
    for (const header of headers) {
      expect(header).toContain('HttpOnly');
    }
  });

  it('omits Secure outside production so localhost works over plain HTTP', async () => {
    const cookie = await setCookieHeader('/set', ACCESS_TOKEN_COOKIE);

    expect(cookie).not.toContain('Secure');
  });

  it('expires both cookies on clear, matching the paths they were set with', async () => {
    const access = await setCookieHeader('/clear', ACCESS_TOKEN_COOKIE);
    const refresh = await setCookieHeader('/clear', REFRESH_TOKEN_COOKIE);

    expect(access).toContain('Expires=Thu, 01 Jan 1970');
    expect(access).toContain('Path=/;');
    expect(refresh).toContain('Expires=Thu, 01 Jan 1970');
    expect(refresh).toContain(`Path=${REFRESH_TOKEN_COOKIE_PATH}`);
  });
});
