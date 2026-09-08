import { PrismaClient } from '@prisma/client';
import { config } from '../config/env';

/**
 * Singleton PrismaClient — the one design pattern this project applies deliberately.
 *
 * Every service imports this instance rather than constructing its own, so the whole
 * application shares a single connection pool. Node's module cache already guarantees
 * one instance per process, so no Singleton *class* is needed; the `globalThis` guard
 * exists only because `tsx watch` re-evaluates modules on reload, which would otherwise
 * leak a new pool (and eventually exhaust PostgreSQL connections) on every file save.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: config.databaseUrl,
    log: config.isTest ? [] : config.isProduction ? ['error'] : ['error', 'warn'],
  });

if (!config.isProduction) {
  globalForPrisma.prisma = prisma;
}
