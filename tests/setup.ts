import { prisma } from '../src/db/prisma';

// Jest sets NODE_ENV=test, which makes src/config/env.ts resolve TEST_DATABASE_URL
// and drop the bcrypt cost factor — so the suite never touches the dev database.

afterAll(async () => {
  await prisma.$disconnect();
});
