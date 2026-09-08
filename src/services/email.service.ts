import { config } from '../config/env';

/** The only email this service currently sends; the Lambda uses `type` to pick a template. */
const TEMPORARY_PASSWORD_TYPE = 'TEMPORARY_PASSWORD';

/** Where the emailed link sends the user — a page in the separate frontend repo. */
const RESET_PASSWORD_PATH = '/reset-password/';

/** Don't let an unresponsive Lambda hold an HTTP request open indefinitely. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Built from `FRONTEND_URL` rather than hardcoded, so it points at the right place in
 * every environment: `http://localhost:5173/reset-password/?email=...` in development,
 * and the deployed frontend origin in production.
 */
function buildResetPasswordUrl(email: string): string {
  return `${config.frontendUrl}${RESET_PASSWORD_PATH}?email=${encodeURIComponent(email)}`;
}

/**
 * The single point of contact with the external AWS Lambda — controllers never call it
 * directly, so its request and response shape can change without touching route code.
 *
 * The Lambda owns generation: it creates the temporary password, emails it to the given
 * address (along with a reset-password link and the password's lifetime, for the email
 * template), and returns the password here so the backend can bcrypt it into the database.
 * The plain value therefore exists in this process only long enough to be hashed, and is
 * deliberately never logged, never returned to the client, and never written to the
 * database as-is.
 */
export async function sendTemporaryPassword(to: string): Promise<string> {
  const { url, apiKey } = config.emailLambda;

  if (!url) {
    throw new Error('EMAIL_LAMBDA_URL is not configured');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // The Lambda allow-lists origins and rejects anything else with 403 — but a
      // server-side fetch never sends this header on its own the way a browser does, so
      // it has to be set explicitly to the same origin the Lambda already allows.
      Origin: config.frontendUrl,
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body: JSON.stringify({
      type: TEMPORARY_PASSWORD_TYPE,
      to,
      resetPasswordUrl: buildResetPasswordUrl(to),
      // Minutes, matching how an email template reads naturally ("expires in 10 minutes").
      // Derived from the same TEMP_PASSWORD_EXPIRATION that governs actual enforcement, so
      // the two can never drift out of sync.
      expiresIn: Math.round(config.tempPassword.expiresInMs / 60_000),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    // Status only — a Lambda error body could echo the address or the password back.
    throw new Error(`Email Lambda responded with status ${response.status}`);
  }

  // The Lambda's response also carries an `info` field, which is discarded — the caller
  // only ever needs the password.
  const payload = (await response.json()) as { temp_pass?: unknown };

  if (typeof payload.temp_pass !== 'string' || payload.temp_pass.length === 0) {
    throw new Error('Email Lambda did not return a temporary password');
  }

  return payload.temp_pass;
}
