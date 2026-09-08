import { Router } from 'express';
import { login, logout, me, register } from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import { loginSchema, registerSchema } from '../schemas/auth.schema';

export const authRouter = Router();

authRouter.post('/register', validate(registerSchema), register);
authRouter.post('/login', validate(loginSchema), login);

// Protected by the Access Token. A Refresh Token cannot authorise this route.
authRouter.get('/me', authenticate, me);

// Unauthenticated on purpose: an expired Access Token must not prevent a user from
// ending their session, and the Refresh Token cookie is what identifies it anyway.
authRouter.post('/logout', logout);
