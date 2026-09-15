import type { ErrorCode } from './types';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus: number = 500,
  ) {
    super(message);
  }
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  MODERATION_FLAGGED: 451,
  RATE_LIMITED: 429,
  CONTEXT_TOO_LONG: 413,
  MODEL_UNAVAILABLE: 503,
  UPSTREAM_ERROR: 502,
  NOT_FOUND: 404,
  INTERNAL: 500,
};

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error && err.name === 'ZodError') {
    return new AppError('INVALID_INPUT', 'request validation failed', 400);
  }
  return new AppError('INTERNAL', err instanceof Error ? err.message : 'unexpected error');
}
