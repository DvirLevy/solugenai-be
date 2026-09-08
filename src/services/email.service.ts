import { config } from '../config/env';

export interface TemporaryPasswordRequest {
  to: string;
  fullName: string;
}

/** Don't let an unresponsive Lambda hold an HTTP request open indefinitely. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The single point of contact with the external AWS Lambda — controllers never call it
 * directly, so its request and response shape can change without touching route code.
 *
 * The Lambda owns generation: it creates the temporary password, emails it to the user,
 * and returns it here so the backend can bcrypt it into the database. The plain value
 * therefore exists in this process only long enough to be hashed, and is deliberately
 * never logged, never returned to the client, and never written to the database as-is.
 */
export async function sendTemporaryPassword(request: TemporaryPasswordRequest): Promise<string> {
  const { url, apiKey } = config.emailLambda;

  if (!url) {
    throw new Error('EMAIL_LAMBDA_URL is not configured');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body: JSON.stringify({ to: request.to, fullName: request.fullName }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    // Status only — a Lambda error body could echo the address or the password back.
    throw new Error(`Email Lambda responded with status ${response.status}`);
  }

  const payload = (await response.json()) as { temporaryPassword?: unknown };

  if (typeof payload.temporaryPassword !== 'string' || payload.temporaryPassword.length === 0) {
    throw new Error('Email Lambda did not return a temporary password');
  }

  return payload.temporaryPassword;
}
