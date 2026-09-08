import { z } from 'zod';

/**
 * Messages intentionally match frontend/src/schemas/auth.schema.ts word for word, so a
 * rule enforced on both sides reads identically wherever it happens to be caught.
 *
 * The frontend's copy is a convenience for the user; this one is the guarantee.
 */

const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required.')
  .pipe(z.email('Please enter a valid email address.'))
  // Stored and looked up lowercased, so Ada@Example.com and ada@example.com are one account.
  .transform((value) => value.toLowerCase());

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .regex(/[0-9]/, 'Password must contain at least one number.')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one symbol.');

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Please enter your full name.'),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  // Deliberately not the full policy: an existing account may predate a stricter rule,
  // and a rejected format here would leak that the password could never have been valid.
  password: z.string().min(1, 'Password is required.'),
  rememberMe: z.boolean().default(false),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

/**
 * Public by design: the user has just received a temporary password by email and cannot
 * sign in yet, so the temporary password itself is the credential that authorises the
 * change. `confirmPassword` is optional — the spec asks for a confirmation "where
 * applicable", and no client currently sends one — but it is checked when present.
 */
export const changePasswordSchema = z
  .object({
    email: emailSchema,
    tempPassword: z.string().min(1, 'Temporary password is required.'),
    newPassword: passwordSchema,
    confirmPassword: z.string().optional(),
  })
  .refine(
    (data) => data.confirmPassword === undefined || data.confirmPassword === data.newPassword,
    { message: 'Passwords do not match.', path: ['confirmPassword'] },
  );

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
