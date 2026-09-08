const LAMBDA_URL = 'https://lambda.example.test/send-temporary-password';
const API_KEY = 'test-api-key';
const TEMPORARY_PASSWORD = 'Tmp-9f3a!zQ2';

const RECIPIENT = { to: 'ada@example.com', fullName: 'Ada Lovelace' };

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

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return require('../../src/services/email.service');
}

function lambdaResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  };
}

describe('sendTemporaryPassword', () => {
  it('posts the recipient to the Lambda with the configured API key', async () => {
    fetchMock.mockResolvedValue(lambdaResponse({ temporaryPassword: TEMPORARY_PASSWORD }));
    const { sendTemporaryPassword } = loadEmailService();

    await sendTemporaryPassword(RECIPIENT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(LAMBDA_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    });
    expect(JSON.parse(init.body as string)).toEqual(RECIPIENT);
  });

  it('returns the temporary password the Lambda generated', async () => {
    fetchMock.mockResolvedValue(lambdaResponse({ temporaryPassword: TEMPORARY_PASSWORD }));
    const { sendTemporaryPassword } = loadEmailService();

    await expect(sendTemporaryPassword(RECIPIENT)).resolves.toBe(TEMPORARY_PASSWORD);
  });

  it('sends no API key header when none is configured', async () => {
    fetchMock.mockResolvedValue(lambdaResponse({ temporaryPassword: TEMPORARY_PASSWORD }));
    const { sendTemporaryPassword } = loadEmailService({ EMAIL_LAMBDA_API_KEY: undefined });

    await sendTemporaryPassword(RECIPIENT);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('x-api-key');
  });

  it('fails clearly when the Lambda URL is not configured', async () => {
    const { sendTemporaryPassword } = loadEmailService({ EMAIL_LAMBDA_URL: undefined });

    await expect(sendTemporaryPassword(RECIPIENT)).rejects.toThrow('EMAIL_LAMBDA_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the status of a failed call without echoing the Lambda body', async () => {
    fetchMock.mockResolvedValue(
      lambdaResponse({ error: `could not email ${RECIPIENT.to}` }, { ok: false, status: 502 }),
    );
    const { sendTemporaryPassword } = loadEmailService();

    await expect(sendTemporaryPassword(RECIPIENT)).rejects.toThrow('status 502');

    // The Lambda's own body may quote the address or the password, so it is not echoed.
    const error = (await sendTemporaryPassword(RECIPIENT).catch((cause: unknown) => cause)) as Error;
    expect(error.message).not.toContain(RECIPIENT.to);
  });

  it('rejects a response that carries no temporary password', async () => {
    fetchMock.mockResolvedValue(lambdaResponse({ delivered: true }));
    const { sendTemporaryPassword } = loadEmailService();

    await expect(sendTemporaryPassword(RECIPIENT)).rejects.toThrow(
      'did not return a temporary password',
    );
  });

  it('rejects a temporary password that is not a non-empty string', async () => {
    const { sendTemporaryPassword } = loadEmailService();

    for (const value of [null, 42, '', { nested: 'value' }]) {
      fetchMock.mockResolvedValue(lambdaResponse({ temporaryPassword: value }));
      await expect(sendTemporaryPassword(RECIPIENT)).rejects.toThrow();
    }
  });

  it('gives up rather than hanging when the Lambda does not answer', async () => {
    fetchMock.mockResolvedValue(lambdaResponse({ temporaryPassword: TEMPORARY_PASSWORD }));
    const { sendTemporaryPassword } = loadEmailService();

    await sendTemporaryPassword(RECIPIENT);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
