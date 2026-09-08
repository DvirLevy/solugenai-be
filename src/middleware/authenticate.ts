import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../services/token.service';
import { ApiError } from '../utils/api-error';
import { ACCESS_TOKEN_COOKIE } from '../utils/cookies';

/**
 * Authenticates a protected route using the Access Token cookie, and nothing else.
 *
 * A Refresh Token is deliberately not accepted here: its only privilege is to mint a
 * new Access Token at POST /api/auth/refresh. That separation is what makes a short
 * Access Token lifetime meaningful.
 *
 * Missing, malformed and expired tokens all produce the same bare 401, so a caller
 * learns nothing about why verification failed. The frontend responds to that 401 by
 * attempting a refresh.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token: unknown = req.cookies?.[ACCESS_TOKEN_COOKIE];

  if (typeof token !== 'string' || token.length === 0) {
    next(ApiError.unauthorized());
    return;
  }

  try {
    req.userId = verifyAccessToken(token).userId;
    next();
  } catch {
    next(ApiError.unauthorized());
  }
}

/**
 * Narrows `req.userId` for controllers mounted behind `authenticate`. The throw is a
 * type guard for a route that was wired up without the middleware, not a runtime path
 * that can be reached through the router.
 */
export function getAuthenticatedUserId(req: Request): string {
  if (!req.userId) {
    throw ApiError.unauthorized();
  }

  return req.userId;
}
