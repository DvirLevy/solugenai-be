import type { ZodError } from 'zod';

/**
 * Flattens a ZodError into the `{ field: message }` map the frontend expects in
 * `ApiErrorBody.errors`. Only the first issue per field is kept — the client renders
 * one message under each input.
 */
export function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : '_';
    if (!(field in fieldErrors)) {
      fieldErrors[field] = issue.message;
    }
  }

  return fieldErrors;
}
