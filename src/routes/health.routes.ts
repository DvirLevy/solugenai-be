import { Router } from 'express';
import { prisma } from '../db/prisma';

export const healthRouter = Router();

/**
 * Liveness + database readiness. A failed database probe reports 503 rather than
 * throwing, so an orchestrator gets a meaningful signal instead of a generic 500.
 */
healthRouter.get('/health', async (_req, res) => {
  let database: 'connected' | 'disconnected' = 'connected';

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'disconnected';
  }

  res.status(database === 'connected' ? 200 : 503).json({
    status: database === 'connected' ? 'ok' : 'degraded',
    database,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
