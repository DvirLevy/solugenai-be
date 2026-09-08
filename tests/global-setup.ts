import { execSync } from 'node:child_process';
import 'dotenv/config';

/**
 * Brings the dedicated test database up to date once per run. It is a separate
 * database from development (see TEST_DATABASE_URL in .env) so suites can truncate
 * tables freely without destroying local data.
 */
export default function globalSetup(): void {
  const databaseUrl = process.env.TEST_DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('TEST_DATABASE_URL must be set in .env to run the test suite.');
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
}
