import crypto from 'node:crypto';
import jwt, { JsonWebTokenError, type SignOptions } from 'jsonwebtoken';
import { config } from '../config/env';
import { prisma } from '../db/prisma';

/** Minimal claims by design — nothing sensitive travels inside the Access Token. */
export interface AccessTokenPayload {
  userId: string;
}

export interface IssuedRefreshToken {
  /** The raw token. Only ever sent to the client as an HttpOnly cookie — never stored, never logged. */
  token: string;
  expiresAt: Date;
}

const REFRESH_TOKEN_BYTES = 32;

export function signAccessToken(userId: string): string {
  const options: SignOptions = {
    expiresIn: config.accessToken.expiresIn as SignOptions['expiresIn'],
  };

  return jwt.sign({ userId } satisfies AccessTokenPayload, config.accessToken.secret, options);
}

/** Throws (never returns null) so callers can't accidentally treat a bad token as anonymous. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, config.accessToken.secret);

  if (typeof decoded === 'string' || typeof decoded.userId !== 'string') {
    throw new JsonWebTokenError('Malformed access token payload');
  }

  return { userId: decoded.userId };
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/**
 * SHA-256 rather than bcrypt, deliberately: the hash is a *lookup key*, and bcrypt's
 * per-hash salt would make `findUnique({ tokenHash })` impossible. The security
 * argument bcrypt exists for — slowing down brute force against low-entropy human
 * passwords — doesn't apply to 256 bits of CSPRNG output.
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function issueRefreshToken(
  userId: string,
  rememberMe: boolean,
): Promise<IssuedRefreshToken> {
  const token = generateRefreshToken();
  const lifetimeMs = rememberMe
    ? config.refreshToken.rememberMeExpiresInMs
    : config.refreshToken.shortExpiresInMs;
  const expiresAt = new Date(Date.now() + lifetimeMs);

  await prisma.refreshToken.create({
    data: { tokenHash: hashRefreshToken(token), userId, expiresAt },
  });

  return { token, expiresAt };
}

export interface RotatedRefreshToken extends IssuedRefreshToken {
  userId: string;
}

/**
 * Swaps a used Refresh Token for a fresh one, atomically, so a token can never be
 * redeemed twice.
 *
 * The replacement inherits the original `expiresAt` rather than restarting the clock.
 * That keeps Remember Me meaningful: the session ends a fixed period after *login*,
 * instead of being extended indefinitely by routine refreshes.
 *
 * Returns null for a token that is unknown, already used, or expired — the caller
 * turns every one of those into the same 401, so nothing about which check failed
 * reaches the client.
 */
export async function rotateRefreshToken(rawToken: string): Promise<RotatedRefreshToken | null> {
  const tokenHash = hashRefreshToken(rawToken);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing) return null;

    const { count } = await tx.refreshToken.deleteMany({ where: { id: existing.id } });
    if (count === 0) return null;

    if (existing.expiresAt.getTime() <= Date.now()) return null;

    const token = generateRefreshToken();
    await tx.refreshToken.create({
      data: {
        tokenHash: hashRefreshToken(token),
        userId: existing.userId,
        expiresAt: existing.expiresAt,
      },
    });

    return { token, expiresAt: existing.expiresAt, userId: existing.userId };
  });
}

/** Idempotent: logging out with an already-invalid cookie is not an error. */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { tokenHash: hashRefreshToken(rawToken) } });
}

/** Ends every session for a user — used when a password changes. */
export async function revokeAllRefreshTokensForUser(userId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { userId } });
}
