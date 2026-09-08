import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/api-error';

/** Turns an unmatched route into the same JSON error shape as every other failure. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound(`Cannot ${req.method} ${req.path}`));
}
