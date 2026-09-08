import request from 'supertest';
import { config } from '../../src/config/env';
import { createApp } from '../../src/app';
import { prisma } from '../../src/db/prisma';
import { sendTemporaryPassword } from '../../src/services/email.service';
import { verifyPassword } from '../../src/utils/password';
import { resetDatabase } from '../helpers/db';

// The Lambda is external; its own request/response contract is covered separately in
// tests/services/email.service.test.ts.
jest.mock('../../src/services/email.service');

const sendTemporaryPasswordMock = jest.mocked(sendTemporaryPassword);

const app = createApp();

const VALID_USER = {
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'Analytical1!',
};

const TEMPORARY_PASSWORD = 'Tmp-9f3a!zQ2';
const GENERIC_FORGOT_RESPONSE = {
  message: 'If that account exists, a temporary password has been emailed to it.',
};

beforeEach(async () => {
  await resetDatabase();
  sendTemporaryPasswordMock.mockResolvedValue(TEMPORARY_PASSWORD);
});

function registerUser() {
  return request(app).post('/api/auth/register').send(VALID_USER);
}

/** Simulates the 10-minute window having passed, without actually waiting for it. */
function expireTempPassword(email: string) {
  return prisma.user.update({
    where: { email },
    data: { tempPasswordExpiresAt: new Date(Date.now() - 1000) },
  });
}

describe('POST /api/auth/forgot-password', () => {
  it('asks the Lambda to email the user and stores a hash of what it returned', async () => {
    await registerUser();

    const response = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: VALID_USER.email });

    expect(response.status).toBe(200);
    expect(sendTemporaryPasswordMock).toHaveBeenCalledWith(VALID_USER.email);

    const user = await prisma.user.findUnique({ where: { email: VALID_USER.email } });
    expect(user?.mustChangePassword).toBe(true);
    expect(await verifyPassword(TEMPORARY_PASSWORD, user!.passwordHash)).toBe(true);
    // The temporary password is stored hashed, exactly like any other.
    expect(user?.passwordHash).not.toBe(TEMPORARY_PASSWORD);
  });

  it('never returns or hints at the temporary password', async () => {
    await registerUser();

    const response = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: VALID_USER.email });

    expect(JSON.stringify(response.body)).not.toContain(TEMPORARY_PASSWORD);
    expect(response.body).toEqual(GENERIC_FORGOT_RESPONSE);
  });

  it('answers identically for an address that has no account', async () => {
    await registerUser();

    const known = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: VALID_USER.email });
    const unknown = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });

    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
  });

  it('does not contact the Lambda for an address that has no account', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });

    expect(sendTemporaryPasswordMock).not.toHaveBeenCalled();
  });

  it('leaves the existing password intact when the Lambda fails', async () => {
    await registerUser();
    const before = await prisma.user.findUnique({ where: { email: VALID_USER.email } });
    sendTemporaryPasswordMock.mockRejectedValue(new Error('Lambda timed out'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: VALID_USER.email });

    // Same generic response — a different one would reveal that the account exists.
    expect(response.status).toBe(200);
    expect(response.body).toEqual(GENERIC_FORGOT_RESPONSE);

    // Critically, the user is not locked out with a password they never received.
    const after = await prisma.user.findUnique({ where: { email: VALID_USER.email } });
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(after?.mustChangePassword).toBe(false);

    errorSpy.mockRestore();
  });

  it('rejects a malformed email address', async () => {
    const response = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'not-an-email' });

    expect(response.status).toBe(400);
    expect(response.body.errors.email).toBe('Please enter a valid email address.');
  });

  it('gives the temporary password a roughly 10-minute window', async () => {
    await registerUser();

    await request(app).post('/api/auth/forgot-password').send({ email: VALID_USER.email });

    const user = await prisma.user.findUnique({ where: { email: VALID_USER.email } });
    const remainingMs = user!.tempPasswordExpiresAt!.getTime() - Date.now();
    expect(remainingMs).toBeCloseTo(config.tempPassword.expiresInMs, -3);
  });
});

describe('POST /api/auth/change-password', () => {
  const NEW_PASSWORD = 'Bernoulli7#';

  /** Puts the account into the state the emailed temporary password leaves it in. */
  async function startRecovery() {
    await registerUser();
    await request(app).post('/api/auth/forgot-password').send({ email: VALID_USER.email });
  }

  it('replaces the temporary password and clears the must-change flag', async () => {
    await startRecovery();

    const response = await request(app).post('/api/auth/change-password').send({
      email: VALID_USER.email,
      tempPassword: TEMPORARY_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(response.status).toBe(200);
    const user = await prisma.user.findUnique({ where: { email: VALID_USER.email } });
    expect(user?.mustChangePassword).toBe(false);
    expect(await verifyPassword(NEW_PASSWORD, user!.passwordHash)).toBe(true);
  });

  it('lets the user sign in with the new password and not the temporary one', async () => {
    await startRecovery();
    await request(app).post('/api/auth/change-password').send({
      email: VALID_USER.email,
      tempPassword: TEMPORARY_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    const withNew = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: NEW_PASSWORD, rememberMe: false });
    const withTemporary = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: TEMPORARY_PASSWORD, rememberMe: false });

    expect(withNew.status).toBe(200);
    expect(withTemporary.status).toBe(401);
  });

  it('ends every existing session', async () => {
    await startRecovery();
    await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: TEMPORARY_PASSWORD, rememberMe: true });
    expect(await prisma.refreshToken.count()).toBeGreaterThan(0);

    await request(app).post('/api/auth/change-password').send({
      email: VALID_USER.email,
      tempPassword: TEMPORARY_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it('answers a wrong temporary password and an unknown account identically', async () => {
    await startRecovery();

    const wrongPassword = await request(app).post('/api/auth/change-password').send({
      email: VALID_USER.email,
      tempPassword: 'NotTheOne1!',
      newPassword: NEW_PASSWORD,
    });
    const unknownEmail = await request(app).post('/api/auth/change-password').send({
      email: 'nobody@example.com',
      tempPassword: TEMPORARY_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it('applies the registration password policy to the new password', async () => {
    await startRecovery();

    const response = await request(app).post('/api/auth/change-password').send({
      email: VALID_USER.email,
      tempPassword: TEMPORARY_PASSWORD,
      newPassword: 'weak',
    });

    expect(response.status).toBe(400);
    expect(response.body.errors.newPassword).toBe('Password must be at least 8 characters.');
  });

  it('refuses to keep the emailed password as the permanent one', async () => {
    await startRecovery();

    const response = await request(app).post('/api/auth/change-password').send({
      email: VALID_USER.email,
      tempPassword: TEMPORARY_PASSWORD,
      newPassword: TEMPORARY_PASSWORD,
    });

    expect(response.status).toBe(400);
  });

  it('checks the confirmation when one is supplied', async () => {
    await startRecovery();

    const response = await request(app).post('/api/auth/change-password').send({
      email: VALID_USER.email,
      tempPassword: TEMPORARY_PASSWORD,
      newPassword: NEW_PASSWORD,
      confirmPassword: 'Different1!',
    });

    expect(response.status).toBe(400);
    expect(response.body.errors.confirmPassword).toBe('Passwords do not match.');
  });

  it('returns no password material of any kind', async () => {
    await startRecovery();

    const response = await request(app).post('/api/auth/change-password').send({
      email: VALID_USER.email,
      tempPassword: TEMPORARY_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    const body = JSON.stringify(response.body);
    expect(body).not.toContain(NEW_PASSWORD);
    expect(body).not.toContain(TEMPORARY_PASSWORD);
    expect(body).not.toMatch(/\$2[aby]\$/);
  });

  it('rejects a correct-but-expired temporary password with a distinct message', async () => {
    await startRecovery();
    await expireTempPassword(VALID_USER.email);

    const response = await request(app).post('/api/auth/change-password').send({
      email: VALID_USER.email,
      tempPassword: TEMPORARY_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      message: 'Temporary password has expired. Please request a new one.',
    });

    // The window is a real security boundary — the flow did not quietly go through anyway.
    const user = await prisma.user.findUnique({ where: { email: VALID_USER.email } });
    expect(user?.mustChangePassword).toBe(true);
  });

  it('burns the expired temporary password so it cannot be retried', async () => {
    await startRecovery();
    await expireTempPassword(VALID_USER.email);
    await request(app).post('/api/auth/change-password').send({
      email: VALID_USER.email,
      tempPassword: TEMPORARY_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    // A second attempt with the very same value now fails for the ordinary reason —
    // the hash underneath it has already been overwritten with an unguessable one.
    const retry = await request(app).post('/api/auth/change-password').send({
      email: VALID_USER.email,
      tempPassword: TEMPORARY_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(retry.status).toBe(401);
    expect(retry.body).toEqual({ message: 'Invalid email or temporary password.' });
  });

  it('lets the user recover normally with a fresh temporary password after expiry', async () => {
    await startRecovery();
    await expireTempPassword(VALID_USER.email);
    await request(app).post('/api/auth/change-password').send({
      email: VALID_USER.email,
      tempPassword: TEMPORARY_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    const FRESH_TEMPORARY_PASSWORD = 'Tmp-fresh1!Zz';
    sendTemporaryPasswordMock.mockResolvedValue(FRESH_TEMPORARY_PASSWORD);
    await request(app).post('/api/auth/forgot-password').send({ email: VALID_USER.email });

    const response = await request(app).post('/api/auth/change-password').send({
      email: VALID_USER.email,
      tempPassword: FRESH_TEMPORARY_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(response.status).toBe(200);
  });

  it('does not reject a temporary password used well within the window', async () => {
    await startRecovery();

    const response = await request(app).post('/api/auth/change-password').send({
      email: VALID_USER.email,
      tempPassword: TEMPORARY_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(response.status).toBe(200);
  });
});

describe('signing in with a temporary password', () => {
  const NEW_PASSWORD = 'Bernoulli7#';

  async function startRecovery() {
    await registerUser();
    await request(app).post('/api/auth/forgot-password').send({ email: VALID_USER.email });
  }

  it('succeeds within the window and reports mustChangePassword', async () => {
    await startRecovery();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: TEMPORARY_PASSWORD, rememberMe: false });

    expect(response.status).toBe(200);
    expect(response.body.mustChangePassword).toBe(true);
  });

  it('rejects it once expired, indistinguishably from a wrong password', async () => {
    await startRecovery();
    await expireTempPassword(VALID_USER.email);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: TEMPORARY_PASSWORD, rememberMe: false });

    // Not the change-password "expired" message — login never distinguishes failure reasons.
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: 'Invalid email or password.' });
  });

  it('burns the expired temporary password on the failed login attempt', async () => {
    await startRecovery();
    await expireTempPassword(VALID_USER.email);
    await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: TEMPORARY_PASSWORD, rememberMe: false });

    // The 10-minute limit is a real security boundary, not just a change-password nudge —
    // an intercepted email cannot be used to sign in indefinitely by never "finishing" the reset.
    const stillWorks = await request(app).post('/api/auth/change-password').send({
      email: VALID_USER.email,
      tempPassword: TEMPORARY_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(stillWorks.status).toBe(401);
    expect(stillWorks.body).toEqual({ message: 'Invalid email or temporary password.' });
  });

  it('does not open a session when the temporary password has expired', async () => {
    await startRecovery();
    // Registration signs the user in, so one session already exists before this attempt.
    const sessionsBefore = await prisma.refreshToken.count();
    await expireTempPassword(VALID_USER.email);

    await request(app)
      .post('/api/auth/login')
      .send({ email: VALID_USER.email, password: TEMPORARY_PASSWORD, rememberMe: false });

    // The rejected login must not have opened a new one.
    expect(await prisma.refreshToken.count()).toBe(sessionsBefore);
  });
});
