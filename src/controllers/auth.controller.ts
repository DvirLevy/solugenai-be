import type { Request, RequestHandler, Response } from 'express';
import { getAuthenticatedUserId } from '../middleware/authenticate';
import type { LoginInput, RegisterInput } from '../schemas/auth.schema';
import {
  type AuthSession,
  type SafeUser,
  getUserById,
  loginUser,
  logoutUser,
  registerUser,
} from '../services/auth.service';
import {
  REFRESH_TOKEN_COOKIE,
  clearAuthCookies,
  setAccessTokenCookie,
  setRefreshTokenCookie,
} from '../utils/cookies';

/** Both tokens leave only as HttpOnly cookies — never in a response body. */
function sendSession(res: Response, session: AuthSession): void {
  setAccessTokenCookie(res, session.accessToken);
  setRefreshTokenCookie(res, session.refreshToken.token, session.refreshToken.expiresAt);
}

export const register: RequestHandler<unknown, SafeUser, RegisterInput> = async (req, res) => {
  const session = await registerUser(req.body);

  sendSession(res, session);
  res.status(201).json(session.user);
};

export const login: RequestHandler<unknown, SafeUser, LoginInput> = async (req, res) => {
  const session = await loginUser(req.body);

  sendSession(res, session);
  res.status(200).json(session.user);
};

export const me: RequestHandler<unknown, SafeUser> = async (req, res) => {
  res.status(200).json(await getUserById(getAuthenticatedUserId(req)));
};

export const logout: RequestHandler = async (req: Request, res) => {
  await logoutUser(req.cookies?.[REFRESH_TOKEN_COOKIE]);

  clearAuthCookies(res);
  res.status(204).end();
};
