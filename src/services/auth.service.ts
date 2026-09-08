import { Prisma, type User } from '@prisma/client';
import { prisma } from '../db/prisma';
import type { LoginInput, RegisterInput } from '../schemas/auth.schema';
import { ApiError } from '../utils/api-error';
import { equalisePasswordTiming, hashPassword, verifyPassword } from '../utils/password';
import {
  type IssuedRefreshToken,
  issueRefreshToken,
  revokeRefreshToken,
  signAccessToken,
} from './token.service';

/**
 * The only user shape that ever leaves the API. Built by hand rather than by deleting
 * keys, so a column added to the schema later can't silently start being returned.
 */
export interface SafeUser {
  id: string;
  fullName: string;
  email: string;
  mustChangePassword: boolean;
}

export interface AuthSession {
  user: SafeUser;
  accessToken: string;
  refreshToken: IssuedRefreshToken;
}

const INVALID_CREDENTIALS = 'Invalid email or password.';

export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    mustChangePassword: user.mustChangePassword,
  };
}

function createSession(user: User, rememberMe: boolean): Promise<AuthSession> {
  return issueRefreshToken(user.id, rememberMe).then((refreshToken) => ({
    user: toSafeUser(user),
    accessToken: signAccessToken(user.id),
    refreshToken,
  }));
}

/**
 * Registration signs the user straight in. The frontend's RegisterPage re-checks
 * /auth/me after a successful submit and routes to the dashboard or the login screen
 * based on the answer, so it handles this correctly either way.
 */
export async function registerUser(input: RegisterInput): Promise<AuthSession> {
  const passwordHash = await hashPassword(input.password);

  try {
    const user = await prisma.user.create({
      data: { fullName: input.fullName, email: input.email, passwordHash },
    });

    return await createSession(user, false);
  } catch (error) {
    // Relying on the unique constraint rather than a pre-flight lookup means two
    // simultaneous registrations for the same address can't both get through.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw ApiError.conflict('An account with this email already exists.', {
        email: 'An account with this email already exists.',
      });
    }

    throw error;
  }
}

export async function loginUser(input: LoginInput): Promise<AuthSession> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user) {
    await equalisePasswordTiming();
    throw ApiError.unauthorized(INVALID_CREDENTIALS);
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw ApiError.unauthorized(INVALID_CREDENTIALS);
  }

  // Remember Me only selects the Refresh Token lifetime — the Access Token stays short.
  return createSession(user, input.rememberMe);
}

/** The Access Token verified, but the account may have been deleted since it was issued. */
export async function getUserById(userId: string): Promise<SafeUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw ApiError.unauthorized();
  }

  return toSafeUser(user);
}

/**
 * Deletes the server-side session so the Refresh Token stops working, rather than only
 * clearing the browser's cookies. Absent or already-invalid tokens are not an error —
 * logging out twice should still leave the caller logged out.
 */
export async function logoutUser(rawRefreshToken: string | undefined): Promise<void> {
  if (rawRefreshToken) {
    await revokeRefreshToken(rawRefreshToken);
  }
}
