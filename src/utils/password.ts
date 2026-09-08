import bcrypt from 'bcryptjs';
import { config } from '../config/env';

export function hashPassword(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, config.bcryptSaltRounds);
}

export function verifyPassword(plainText: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainText, passwordHash);
}
