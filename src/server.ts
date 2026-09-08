import { createApp } from './app';
import { config } from './config/env';
import { prisma } from './db/prisma';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}/api (${config.nodeEnv})`);
});

/** Drain in-flight requests and release the shared pool before the process exits. */
async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down.`);

  server.close(() => {
    void prisma.$disconnect().then(() => process.exit(0));
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
