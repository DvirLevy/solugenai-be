import 'dotenv/config';
import { z } from 'zod';

/** Accepts the `15m` / `7d` style durations used by both jsonwebtoken and cookie maxAge. */
const duration = z
  .string()
  .regex(/^\d+(ms|s|m|h|d)$/, 'must be a duration such as 30s, 15m, 24h or 7d');

/** Treats an unset variable and an empty one identically, so a blank line in .env stays optional. */
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: optionalString,

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  FRONTEND_URL: z.url('FRONTEND_URL must be a valid URL'),

  ACCESS_TOKEN_EXPIRATION: duration.default('15m'),
  REFRESH_TOKEN_SHORT_EXPIRATION: duration.default('1d'),
  REFRESH_TOKEN_REMEMBER_ME_EXPIRATION: duration.default('30d'),
  TEMP_PASSWORD_EXPIRATION: duration.default('10m'),

  EMAIL_LAMBDA_URL: optionalString,
  EMAIL_LAMBDA_API_KEY: optionalString,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(`Invalid environment configuration:\n${details}`);
  process.exit(1);
}

const env = parsed.data;
const isTest = env.NODE_ENV === 'test';
const isProduction = env.NODE_ENV === 'production';

const UNITS_IN_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** `15m` -> 900000. The regex above guarantees the shape, so this cannot fail here. */
export function durationToMs(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) throw new Error(`Unsupported duration: ${value}`);
  const [, amount, unit] = match as unknown as [string, string, keyof typeof UNITS_IN_MS];
  return Number(amount) * UNITS_IN_MS[unit];
}

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction,
  isTest,
  port: env.PORT,

  databaseUrl: isTest && env.TEST_DATABASE_URL ? env.TEST_DATABASE_URL : env.DATABASE_URL,

  frontendUrl: env.FRONTEND_URL,

  accessToken: {
    secret: env.JWT_SECRET,
    expiresIn: env.ACCESS_TOKEN_EXPIRATION,
    expiresInMs: durationToMs(env.ACCESS_TOKEN_EXPIRATION),
  },

  refreshToken: {
    shortExpiresInMs: durationToMs(env.REFRESH_TOKEN_SHORT_EXPIRATION),
    rememberMeExpiresInMs: durationToMs(env.REFRESH_TOKEN_REMEMBER_ME_EXPIRATION),
  },

  tempPassword: {
    expiresInMs: durationToMs(env.TEMP_PASSWORD_EXPIRATION),
  },

  bcryptSaltRounds: isTest ? 4 : 12,

  emailLambda: {
    url: env.EMAIL_LAMBDA_URL,
    apiKey: env.EMAIL_LAMBDA_API_KEY,
  },
} as const;
