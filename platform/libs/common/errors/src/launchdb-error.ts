import { ErrorCode } from './error-codes';

export interface LaunchDbErrorOptions {
  code: ErrorCode;
  message: string;
  httpStatusCode: number;
  resource?: string;
  originalError?: Error;
  metadata?: Record<string, unknown>;
}

export class LaunchDbError extends Error {
  readonly code: ErrorCode;
  readonly httpStatusCode: number;
  readonly resource?: string;
  readonly originalError?: Error;
  readonly metadata?: Record<string, unknown>;

  constructor(options: LaunchDbErrorOptions) {
    super(options.message);
    this.name = 'LaunchDbError';
    this.code = options.code;
    this.httpStatusCode = options.httpStatusCode;
    this.resource = options.resource;
    this.originalError = options.originalError;
    this.metadata = options.metadata;

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      statusCode: this.httpStatusCode,
      ...(this.resource && { resource: this.resource }),
    };
  }
}
