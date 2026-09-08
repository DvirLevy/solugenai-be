/**
 * An error that is safe to surface to the client. Anything thrown that is *not* an
 * ApiError is treated as unexpected by the error handler and reported generically,
 * so internal details can never leak by accident.
 *
 * `errors` maps a field name to a message and matches the frontend's `ApiErrorBody`,
 * which feeds those entries straight into its form fields.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly errors: Record<string, string> | undefined;

  constructor(status: number, message: string, errors?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message: string, errors?: Record<string, string>): ApiError {
    return new ApiError(400, message, errors);
  }

  static unauthorized(message = 'Unauthorized.'): ApiError {
    return new ApiError(401, message);
  }

  static notFound(message = 'Resource not found.'): ApiError {
    return new ApiError(404, message);
  }

  static conflict(message: string, errors?: Record<string, string>): ApiError {
    return new ApiError(409, message, errors);
  }
}
