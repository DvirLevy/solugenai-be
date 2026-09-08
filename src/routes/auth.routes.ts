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
authRouter.get('/me', authenticate, me);
authRouter.post('/logout', logout);
authRouter.post('/refresh', refresh);
authRouter.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
authRouter.post('/change-password', validate(changePasswordSchema), changePassword);
