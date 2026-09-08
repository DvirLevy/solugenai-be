import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { ApiError } from '../utils/api-error';
import { toFieldErrors } from '../utils/field-errors';

/**
 * Validates and replaces `req.body` with the parsed result, so controllers receive
 * data that is already trimmed, normalised and correctly typed.
 *
 * Backend validation is enforced independently of the frontend's — the client's
 * checks are a convenience, not a guarantee.
 */
export function validate<T>(schema: ZodType<T>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      next(ApiError.badRequest('Validation failed.', toFieldErrors(result.error)));
      return;
    }

    req.body = result.data;
    next();
  };
}
