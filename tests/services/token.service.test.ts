import jwt from 'jsonwebtoken';
import { config } from '../../src/config/env';
import { prisma } from '../../src/db/prisma';
import {
  generateRefreshToken,
  hashRefreshToken,
  issueRefreshToken,
  revokeAllRefreshTokensForUser,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../../src/services/token.service';
import { resetDatabase } from '../helpers/db';
import { createTestUser } from '../helpers/factories';

beforeEach(resetDatabase);

describe('access tokens', () => {
  it('round-trips the user id and carries no other claims', () => {
    const token = signAccessToken('user-123');

    expect(verifyAccessToken(token)).toEqual({ userId: 'user-123' });

    const decoded = jwt.decode(token) as Record<string, unknown>;
    expect(Object.keys(decoded).sort()).toEqual(['exp', 'iat', 'userId']);
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign({ userId: 'user-123' }, 'a-different-secret-that-is-long-enough');

    expect(() => verifyAccessToken(forged)).toThrow();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign(
      { userId: 'user-123', exp: Math.floor(Date.now() / 1000) - 60 },
      config.accessToken.secret,
    );

    expect(() => verifyAccessToken(expired)).toThrow();
  });

  it('rejects a validly signed token whose payload has no user id', () => {
    const shapeless = jwt.sign({ somethingElse: true }, config.accessToken.secret);

    expect(() => verifyAccessToken(shapeless)).toThrow();
  });
});

describe('refresh token hashing', () => {
  it('generates a distinct high-entropy token each time', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateRefreshToken));

    expect(tokens.size).toBe(100);
    // 32 random bytes, base64url-encoded.
    expect(generateRefreshToken()).toHaveLength(43);
  });

  it('hashes deterministically so the value can be used as a lookup key', () => {
    const token = generateRefreshToken();

    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).toHaveLength(64);
    expect(hashRefreshToken(token)).not.toBe(hashRefreshToken(generateRefreshToken()));
  });
});

describe('issueRefreshToken', () => {
  it('stores only the hash, never the raw token', async () => {
    const user = await createTestUser();

    const { token } = await issueRefreshToken(user.id, false);
    const stored = await prisma.refreshToken.findFirst({ where: { userId: user.id } });

    expect(stored?.tokenHash).toBe(hashRefreshToken(token));
    expect(stored?.tokenHash).not.toBe(token);
  });

  it('gives a Remember Me session a longer lifetime than a normal one', async () => {
    const user = await createTestUser();

    const normal = await issueRefreshToken(user.id, false);
    const remembered = await issueRefreshToken(user.id, true);

    expect(remembered.expiresAt.getTime()).toBeGreaterThan(normal.expiresAt.getTime());
    expect(normal.expiresAt.getTime() - Date.now()).toBeCloseTo(
      config.refreshToken.shortExpiresInMs,
      -3,
    );
  });

  it('lets one user hold several concurrent sessions', async () => {
    const user = await createTestUser();

    await issueRefreshToken(user.id, false);
    await issueRefreshToken(user.id, true);

    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(2);
  });
});

describe('rotateRefreshToken', () => {
  it('replaces the used token and refuses to redeem it a second time', async () => {
    const user = await createTestUser();
    const original = await issueRefreshToken(user.id, false);

    const rotated = await rotateRefreshToken(original.token);

    expect(rotated?.userId).toBe(user.id);
    expect(rotated?.token).not.toBe(original.token);
    expect(await rotateRefreshToken(original.token)).toBeNull();

    // Exactly one live session — the replacement, not both.
    const remaining = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.tokenHash).toBe(hashRefreshToken(rotated!.token));
  });

  it('inherits the original expiry so refreshing cannot extend the session forever', async () => {
    const user = await createTestUser();
    const original = await issueRefreshToken(user.id, true);

    const rotated = await rotateRefreshToken(original.token);

    expect(rotated?.expiresAt.getTime()).toBe(original.expiresAt.getTime());
  });

  it('returns null for an unknown token', async () => {
    expect(await rotateRefreshToken(generateRefreshToken())).toBeNull();
  });

  it('returns null for an expired token and clears the dead row', async () => {
    const user = await createTestUser();
    const token = generateRefreshToken();
    await prisma.refreshToken.create({
      data: {
        tokenHash: hashRefreshToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    expect(await rotateRefreshToken(token)).toBeNull();
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it('lets only one of two concurrent rotations win', async () => {
    const user = await createTestUser();
    const original = await issueRefreshToken(user.id, false);

    const results = await Promise.all([
      rotateRefreshToken(original.token),
      rotateRefreshToken(original.token),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('revoking', () => {
  it('removes the matching row so the token stops working', async () => {
    const user = await createTestUser();
    const { token } = await issueRefreshToken(user.id, false);

    await revokeRefreshToken(token);

    expect(await rotateRefreshToken(token)).toBeNull();
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it('ignores a token that is already gone', async () => {
    await expect(revokeRefreshToken(generateRefreshToken())).resolves.toBeUndefined();
  });

  it('ends every session for a user at once', async () => {
    const user = await createTestUser();
    await issueRefreshToken(user.id, false);
    await issueRefreshToken(user.id, true);

    await revokeAllRefreshTokensForUser(user.id);

    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });

  it('drops a user’s tokens when the user is deleted', async () => {
    const user = await createTestUser();
    await issueRefreshToken(user.id, false);

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);
  });
});
