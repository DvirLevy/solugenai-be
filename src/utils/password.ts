import bcrypt from 'bcryptjs';
import { config } from '../config/env';

export function hashPassword(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, config.bcryptSaltRounds);
}

export function verifyPassword(plainText: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainText, passwordHash);
}

const TIMING_PLACEHOLDER = 'timing-equalisation-placeholder';
let placeholderHash: string | undefined;

/**
 * Burns roughly the same time a real password check costs.
 *
 * Login returns an identical message whether the email is unknown or the password is
 * wrong, but skipping bcrypt entirely for an unknown email would make the "no such
 * account" case measurably faster and reintroduce user enumeration through timing.
 * Computed lazily so it costs nothing at startup.
 */
export async function equalisePasswordTiming(): Promise<void> {
  placeholderHash ??= await hashPassword(TIMING_PLACEHOLDER);
  await verifyPassword(TIMING_PLACEHOLDER, placeholderHash);
}
