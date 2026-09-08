import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import { config } from './config/env';
import { errorHandler } from './middleware/error-handler';
import { notFoundHandler } from './middleware/not-found';
import { apiRouter } from './routes';

/**
 * Builds the Express application without binding a port, so the integration suite can
 * mount it directly with supertest while `server.ts` owns the actual listener.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');

  app.use(
    cors({
      origin: config.frontendUrl,
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
