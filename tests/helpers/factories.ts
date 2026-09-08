import { randomUUID } from 'node:crypto';
import type { User } from '@prisma/client';
import { prisma } from '../../src/db/prisma';

/** Creates a persisted user. The password hash is a placeholder unless a test needs a real one. */
export function createTestUser(overrides: Partial<User> = {}): Promise<User> {
  return prisma.user.create({
    data: {
      fullName: 'Test User',
      email: `user-${randomUUID()}@example.com`,
      passwordHash: 'placeholder-hash',
      ...overrides,
    },
  });
}
