const LAMBDA_URL = 'https://lambda.example.test/send-temporary-password';
const API_KEY = 'test-api-key';
const TEMPORARY_PASSWORD = 'Tmp-9f3a!zQ2';

const RECIPIENT_EMAIL = 'ada@example.com';

// Set explicitly (rather than relying on the real .env) so the expected reset URL and
// expiresIn below are self-contained and don't silently drift if .env values change.
const FRONTEND_URL = 'https://frontend.example.test';
const TEMP_PASSWORD_EXPIRATION = '10m';
const EXPECTED_RESET_URL = `${FRONTEND_URL}/reset-password/?email=${encodeURIComponent(RECIPIENT_EMAIL)}`;
const EXPECTED_EXPIRES_IN_MINUTES = 10;

const originalEnv = { ...process.env };
const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

/**
 * config/env.ts freezes its values at import time, so the Lambda settings have to be in
 * place before the module graph is rebuilt.
 */
function loadEmailService(
  overrides: Record<string, string | undefined> = {},
): typeof import('../../src/services/email.service') {
  jest.resetModules();
  process.env.EMAIL_LAMBDA_URL = LAMBDA_URL;
  process.env.EMAIL_LAMBDA_API_KEY = API_KEY;
  process.env.FRONTEND_URL = FRONTEND_URL;
  process.env.TEMP_PASSWORD_EXPIRATION = TEMP_PASSWORD_EXPIRATION;

  for (const [key, value] of Object.entries(overrides)) {
    // Set to '' rather than deleting: config/env.ts treats an empty string as "unset" for
    // these optional vars, but *deleting* the key would let the next `dotenv/config` import
    // (triggered by resetModules below) refill it from the real .env file — which, now that
    // EMAIL_LAMBDA_URL holds a real value there, would silently defeat this override.
    process.env[key] = value === undefined ? '' : value;
  }

  return require('../../src/services/email.service');
}

/** The real Lambda's response also carries an `info` field, which callers ignore. */
function lambdaResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  };
}

describe('sendTemporaryPassword', () => {
  it('posts the TEMPORARY_PASSWORD type and recipient to the Lambda with the API key', async () => {
    fetchMock.mockResolvedValue(lambdaResponse({ info: 'sent', temp_pass: TEMPORARY_PASSWORD }));
    const { sendTemporaryPassword } = loadEmailService();

    await sendTemporaryPassword(RECIPIENT_EMAIL);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(LAMBDA_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Origin: FRONTEND_URL,
      'x-api-key': API_KEY,
    });
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'TEMPORARY_PASSWORD',
      to: RECIPIENT_EMAIL,
      resetPasswordUrl: EXPECTED_RESET_URL,
      expiresIn: EXPECTED_EXPIRES_IN_MINUTES,
    });
  });

  it('sends an Origin header, since the Lambda allow-lists origins and rejects anything else', async () => {
    fetchMock.mockResolvedValue(lambdaResponse({ temp_pass: TEMPORARY_PASSWORD }));
    const { sendTemporaryPassword } = loadEmailService();

    await sendTemporaryPassword(RECIPIENT_EMAIL);

    // Server-side fetch never sends this on its own the way a browser does — it must be
    // set explicitly, and to the same origin the Lambda's allow-list actually contains.
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Origin).toBe(FRONTEND_URL);
  });

  it('builds the reset URL from FRONTEND_URL with the email URL-encoded', async () => {
    fetchMock.mockResolvedValue(lambdaResponse({ temp_pass: TEMPORARY_PASSWORD }));
    const { sendTemporaryPassword } = loadEmailService();
    const emailWithSpecialChars = 'ada+test@example.com';

    await sendTemporaryPassword(emailWithSpecialChars);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const { resetPasswordUrl } = JSON.parse(init.body as string) as { resetPasswordUrl: string };
    expect(resetPasswordUrl).toBe(
      `${FRONTEND_URL}/reset-password/?email=${encodeURIComponent(emailWithSpecialChars)}`,
    );
  });

  it('derives expiresIn (minutes) from TEMP_PASSWORD_EXPIRATION, in whatever unit that is', async () => {
    fetchMock.mockResolvedValue(lambdaResponse({ temp_pass: TEMPORARY_PASSWORD }));
    const { sendTemporaryPassword } = loadEmailService({ TEMP_PASSWORD_EXPIRATION: '90s' });

    await sendTemporaryPassword(RECIPIENT_EMAIL);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const { expiresIn } = JSON.parse(init.body as string) as { expiresIn: number };
    expect(expiresIn).toBe(2); // 90s rounds to 2 minutes, not truncates to 1.
  });

  it('returns the temp_pass field from the Lambda response', async () => {
    fetchMock.mockResolvedValue(lambdaResponse({ info: 'sent', temp_pass: TEMPORARY_PASSWORD }));
    const { sendTemporaryPassword } = loadEmailService();

    await expect(sendTemporaryPassword(RECIPIENT_EMAIL)).resolves.toBe(TEMPORARY_PASSWORD);
  });

  it('sends no API key header when none is configured', async () => {
    fetchMock.mockResolvedValue(lambdaResponse({ temp_pass: TEMPORARY_PASSWORD }));
    const { sendTemporaryPassword } = loadEmailService({ EMAIL_LAMBDA_API_KEY: undefined });

    await sendTemporaryPassword(RECIPIENT_EMAIL);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('x-api-key');
  });

  it('fails clearly when the Lambda URL is not configured', async () => {
    const { sendTemporaryPassword } = loadEmailService({ EMAIL_LAMBDA_URL: undefined });

    await expect(sendTemporaryPassword(RECIPIENT_EMAIL)).rejects.toThrow('EMAIL_LAMBDA_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the status of a failed call without echoing the Lambda body', async () => {
    fetchMock.mockResolvedValue(
      lambdaResponse(
        { error: `could not email ${RECIPIENT_EMAIL}` },
        { ok: false, status: 502 },
      ),
    );
    const { sendTemporaryPassword } = loadEmailService();

    await expect(sendTemporaryPassword(RECIPIENT_EMAIL)).rejects.toThrow('status 502');

    // The Lambda's own body may quote the address or the password, so it is not echoed.
    const error = (await sendTemporaryPassword(RECIPIENT_EMAIL).catch(
      (cause: unknown) => cause,
    )) as Error;
    expect(error.message).not.toContain(RECIPIENT_EMAIL);
  });

  it('rejects a response that carries no temp_pass', async () => {
    fetchMock.mockResolvedValue(lambdaResponse({ info: 'delivered' }));
    const { sendTemporaryPassword } = loadEmailService();

    await expect(sendTemporaryPassword(RECIPIENT_EMAIL)).rejects.toThrow(
      'did not return a temporary password',
    );
  });

  it('ignores the temporaryPassword field name — the real Lambda uses temp_pass', async () => {
    fetchMock.mockResolvedValue(lambdaResponse({ temporaryPassword: TEMPORARY_PASSWORD }));
    const { sendTemporaryPassword } = loadEmailService();

    await expect(sendTemporaryPassword(RECIPIENT_EMAIL)).rejects.toThrow();
  });

  it('rejects a temp_pass that is not a non-empty string', async () => {
    const { sendTemporaryPassword } = loadEmailService();

    for (const value of [null, 42, '', { nested: 'value' }]) {
      fetchMock.mockResolvedValue(lambdaResponse({ temp_pass: value }));
      await expect(sendTemporaryPassword(RECIPIENT_EMAIL)).rejects.toThrow();
    }
  });

  it('gives up rather than hanging when the Lambda does not answer', async () => {
    fetchMock.mockResolvedValue(lambdaResponse({ temp_pass: TEMPORARY_PASSWORD }));
    const { sendTemporaryPassword } = loadEmailService();

    await sendTemporaryPassword(RECIPIENT_EMAIL);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
