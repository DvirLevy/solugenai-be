import { prisma } from '../../src/db/prisma';

/**
 * Clears every table between tests. CASCADE covers the User -> RefreshToken relation,
 * so ordering here doesn't matter as the schema grows.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "refresh_tokens", "users" RESTART IDENTITY CASCADE',
  );
}
