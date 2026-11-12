export class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR', details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message, details = undefined) {
    super(message, 422, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = '资源不存在') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message, details = undefined) {
    super(message, 409, 'CONFLICT', details);
    this.name = 'ConflictError';
  }
}

export function asAppError(error) {
  if (error instanceof AppError) return error;
  return new AppError(
    error instanceof Error ? error.message : String(error),
    500,
    'INTERNAL_ERROR'
  );
}
