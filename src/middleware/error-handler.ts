import { Prisma } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { ZodError } from 'zod';
import { config } from '../config/env';
import { ApiError } from '../utils/api-error';
import { toFieldErrors } from '../utils/field-errors';

interface ErrorResponse {
  message: string;
  errors?: Record<string, string>;
}

/** Prisma error codes worth translating into a meaningful client response. */
const UNIQUE_CONSTRAINT = 'P2002';
const RECORD_NOT_FOUND = 'P2025';

function translate(error: unknown): { status: number; body: ErrorResponse; expected: boolean } {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: error.errors ? { message: error.message, errors: error.errors } : { message: error.message },
      expected: true,
    };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      body: { message: 'Validation failed.', errors: toFieldErrors(error) },
      expected: true,
    };
  }

  if (error instanceof TokenExpiredError || error instanceof JsonWebTokenError) {
    return { status: 401, body: { message: 'Unauthorized.' }, expected: true };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === UNIQUE_CONSTRAINT) {
      return {
        status: 409,
        body: { message: 'That value is already in use.' },
        expected: true,
      };
    }
    if (error.code === RECORD_NOT_FOUND) {
      return { status: 404, body: { message: 'Resource not found.' }, expected: true };
    }
  }

  return {
    status: 500,
    body: { message: 'Something went wrong. Please try again later.' },
    expected: false,
  };
}

/**
 * Centralised error handler. It is the only place that writes an error response, so
 * every failure leaves the API in the same `{ message, errors? }` shape the frontend
 * parses. Stack traces, Prisma internals, tokens and hashes never cross this boundary.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const { status, body, expected } = translate(error);

  if (!expected) {
    console.error(`[error] ${req.method} ${req.originalUrl} ->`, error);
  } else if (!config.isTest) {
    const reason = error instanceof Error ? error.message : 'unknown';
    console.warn(`[warn] ${req.method} ${req.originalUrl} -> ${status}: ${reason}`);
  }

  res.status(status).json(body);
}
