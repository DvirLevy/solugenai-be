import type { CookieOptions, Response } from 'express';
import { config } from '../config/env';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * The Refresh Token is scoped to the auth routes instead of `/`, so it isn't attached
 * to every ordinary API request.
 *
 * `/api/auth` rather than `/api/auth/refresh` because logout also has to read the
 * cookie in order to delete the matching row from PostgreSQL — with the narrower path
 * the browser would never send it there, and logout could only clear cookies while
 * leaving a working Refresh Token in the database.
 */
export const REFRESH_TOKEN_COOKIE_PATH = '/api/auth';

/**
 * `sameSite: 'none'` is required in production because the frontend is deployed on a
 * different origin, and it only works alongside `secure`. In development both run on
 * localhost — different ports are still the same site — so `lax` is sufficient and
 * avoids requiring HTTPS locally.
 */
function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: config.isProduction ? 'none' : 'lax',
  };
}

export function setAccessTokenCookie(res: Response, token: string): void {
  res.cookie(ACCESS_TOKEN_COOKIE, token, {
    ...baseCookieOptions(),
    path: '/',
    maxAge: config.accessToken.expiresInMs,
  });
}

/** Cookie expiry mirrors the database row exactly, so the two can't drift apart. */
export function setRefreshTokenCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    ...baseCookieOptions(),
    path: REFRESH_TOKEN_COOKIE_PATH,
    expires: expiresAt,
  });
}

/** Attributes must match those used when setting, or the browser keeps the cookie. */
export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, { ...baseCookieOptions(), path: '/' });
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    ...baseCookieOptions(),
    path: REFRESH_TOKEN_COOKIE_PATH,
  });
}
