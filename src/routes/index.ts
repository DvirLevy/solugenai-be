import { Router } from 'express';
import { authRouter } from './auth.routes';
import { healthRouter } from './health.routes';

/** Everything is mounted under `/api`, which is what the frontend's VITE_API_URL points at. */
export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use('/auth', authRouter);
