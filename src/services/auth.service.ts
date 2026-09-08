import { Prisma, type User } from '@prisma/client';
import { config } from '../config/env';
import { prisma } from '../db/prisma';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
} from '../schemas/auth.schema';
import { ApiError } from '../utils/api-error';
import { equalisePasswordTiming, hashPassword, verifyPassword } from '../utils/password';
import { sendTemporaryPassword } from './email.service';
import {
  type IssuedRefreshToken,
  generateRefreshToken,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
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
const INVALID_TEMPORARY_PASSWORD = 'Invalid email or temporary password.';

export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    mustChangePassword: user.mustChangePassword,
  };
}

/**
 * True only when the account is mid-recovery (`mustChangePassword`) and that recovery's
 * window has passed. Always false for a real password, since `tempPasswordExpiresAt` is
 * null for one — this can never misfire and reject a normal password.
 */
function isTempPasswordExpired(user: User): boolean {
  return (
    user.mustChangePassword &&
    user.tempPasswordExpiresAt !== null &&
    user.tempPasswordExpiresAt.getTime() <= Date.now()
  );
}

/**
 * Burns an expired temporary password the moment someone tries it, so the same value can
 * never be replayed even if the caller keeps retrying. `mustChangePassword` stays true —
 * the account still needs a temp password, just not this one — and the user's only path
 * forward is a fresh POST /auth/forgot-password.
 *
 * Best-effort: this runs on a path that is about to reject the request with a 401
 * regardless, so a failure here must not turn that 401 into a 500.
 */
async function invalidateExpiredTempPassword(userId: string): Promise<void> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(generateRefreshToken()),
        tempPasswordExpiresAt: null,
      },
    });
  } catch (error) {
    console.error(
      '[error] failed to invalidate expired temporary password:',
      error instanceof Error ? error.message : 'unknown error',
    );
  }
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

  // A correct-but-expired temporary password is rejected exactly like a wrong one — the
  // 10-minute window is a security boundary, not just a change-password reminder, so a
  // leaked email can't be used to sign in indefinitely just by never "finishing" the reset.
  if (isTempPasswordExpired(user)) {
    await invalidateExpiredTempPassword(user.id);
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

/**
 * Exchanges a Refresh Token for a new Access Token, rotating the Refresh Token in the
 * process so the presented one can never be redeemed again.
 *
 * Missing, unknown, already-used and expired tokens all raise the same bare 401. The
 * frontend treats that as "the session is over" and sends the user to the login screen;
 * that redirect is deliberately its decision, not the backend's.
 */
export async function refreshSession(rawRefreshToken: string | undefined): Promise<AuthSession> {
  if (!rawRefreshToken) {
    throw ApiError.unauthorized();
  }

  const rotated = await rotateRefreshToken(rawRefreshToken);

  if (!rotated) {
    throw ApiError.unauthorized();
  }

  // The foreign key cascade already removes tokens with the user, so this cannot
  // normally miss — but the session must never outlive the account it belongs to.
  const user = await prisma.user.findUnique({ where: { id: rotated.userId } });

  if (!user) {
    throw ApiError.unauthorized();
  }

  return {
    user: toSafeUser(user),
    accessToken: signAccessToken(user.id),
    refreshToken: { token: rotated.token, expiresAt: rotated.expiresAt },
  };
}

/**
 * Starts password recovery. Always resolves, and always in roughly the same way, so the
 * endpoint cannot be used to discover which addresses are registered.
 *
 * The stored password is replaced only *after* the Lambda confirms it sent the email.
 * Doing it the other way round would lock a user out with a password they never got if
 * delivery failed.
 */
export async function requestPasswordReset(input: ForgotPasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user) {
    return;
  }

  let temporaryPassword: string;

  try {
    temporaryPassword = await sendTemporaryPassword(user.email);
  } catch (error) {
    // Reported to the operator, never to the caller: a distinguishable failure here
    // would reveal that the address exists. Logs the reason only — never the password.
    console.error(
      '[error] temporary password dispatch failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
      tempPasswordExpiresAt: new Date(Date.now() + config.tempPassword.expiresInMs),
    },
  });
}

/**
 * Completes recovery: the temporary password from the email is the credential that
 * authorises setting a new one, so this route is public rather than Access Token
 * protected — the user cannot sign in until it succeeds.
 */
export async function changePassword(input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user) {
    await equalisePasswordTiming();
    throw ApiError.unauthorized(INVALID_TEMPORARY_PASSWORD);
  }

  if (!(await verifyPassword(input.tempPassword, user.passwordHash))) {
    throw ApiError.unauthorized(INVALID_TEMPORARY_PASSWORD);
  }

  // Distinguishing "expired" from "wrong" is safe here specifically: the caller just proved
  // — via a successful bcrypt comparison — that they know the correct temporary password.
  // Telling them it expired reveals nothing they didn't already know, and points them to
  // forgot-password instead of leaving them to keep retrying a value that can never work.
  if (isTempPasswordExpired(user)) {
    await invalidateExpiredTempPassword(user.id);
    throw ApiError.unauthorized('Temporary password has expired. Please request a new one.');
  }

  // The temporary password travelled by email in plain text, so keeping it would leave
  // the account in exactly the state this flow exists to get out of.
  if (input.tempPassword === input.newPassword) {
    throw ApiError.badRequest('Choose a password different from the temporary one.', {
      newPassword: 'Choose a password different from the temporary one.',
    });
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, tempPasswordExpiresAt: null },
    }),
    // Anyone holding a session opened with the temporary password loses it.
    prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
  ]);
}
