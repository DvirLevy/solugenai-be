import type { Request, RequestHandler, Response } from 'express';
import { getAuthenticatedUserId } from '../middleware/authenticate';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
} from '../schemas/auth.schema';
import {
  type AuthSession,
  type SafeUser,
  changePassword as changePasswordService,
  getUserById,
  loginUser,
  logoutUser,
  refreshSession,
  registerUser,
  requestPasswordReset,
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

/** Both cookies are replaced: a new Access Token, and the rotated Refresh Token. */
export const refresh: RequestHandler<unknown, SafeUser> = async (req, res) => {
  const session = await refreshSession(req.cookies?.[REFRESH_TOKEN_COOKIE]);

  sendSession(res, session);
  res.status(200).json(session.user);
};

/**
 * Always answers the same way, whether or not the address belongs to an account, so the
 * endpoint reveals nothing about who is registered.
 */
export const forgotPassword: RequestHandler<unknown, { message: string }, ForgotPasswordInput> =
  async (req, res) => {
    await requestPasswordReset(req.body);

    res.status(200).json({
      message: 'If that account exists, a temporary password has been emailed to it.',
    });
  };

export const changePassword: RequestHandler<unknown, { message: string }, ChangePasswordInput> =
  async (req, res) => {
    await changePasswordService(req.body);

    clearAuthCookies(res);
    res.status(200).json({ message: 'Your password has been changed. Please sign in.' });
  };
