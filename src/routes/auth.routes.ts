import { Router } from 'express';
import {
  changePassword,
  forgotPassword,
  login,
  logout,
  me,
  refresh,
  register,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
} from '../schemas/auth.schema';

export const authRouter = Router();

authRouter.post('/register', validate(registerSchema), register);
authRouter.post('/login', validate(loginSchema), login);

// Protected by the Access Token. A Refresh Token cannot authorise this route.
authRouter.get('/me', authenticate, me);

// Unauthenticated on purpose: an expired Access Token must not prevent a user from
// ending their session, and the Refresh Token cookie is what identifies it anyway.
authRouter.post('/logout', logout);

// The only route a Refresh Token may be redeemed at.
authRouter.post('/refresh', refresh);

// Public: a user in password recovery has no valid Access Token by definition. The
// temporary password emailed to them is the credential that authorises the change.
authRouter.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
authRouter.post('/change-password', validate(changePasswordSchema), changePassword);
