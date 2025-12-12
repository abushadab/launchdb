import { ErrorCode } from './error-codes';
import { LaunchDbError } from './launchdb-error';

export const ERRORS = {
  // Auth errors
  InvalidCredentials: (e?: Error) =>
    new LaunchDbError({
      code: ErrorCode.InvalidCredentials,
      message: 'Invalid email or password',
      httpStatusCode: 401,
      originalError: e,
    }),

  UserNotFound: (userId: string, e?: Error) =>
    new LaunchDbError({
      code: ErrorCode.UserNotFound,
      message: 'User not found',
      httpStatusCode: 404,
      resource: userId,
      originalError: e,
    }),

  UserAlreadyExists: (email: string, e?: Error) =>
    new LaunchDbError({
      code: ErrorCode.UserAlreadyExists,
      message: 'User with this email already exists',
      httpStatusCode: 409,
      resource: email,
      originalError: e,
    }),

  TokenExpired: (e?: Error) =>
    new LaunchDbError({
      code: ErrorCode.TokenExpired,
      message: 'Token has expired',
      httpStatusCode: 401,
      originalError: e,
    }),

  TokenInvalid: (e?: Error) =>
    new LaunchDbError({
      code: ErrorCode.TokenInvalid,
      message: 'Invalid token',
      httpStatusCode: 401,
      originalError: e,
    }),

  // Storage errors
  BucketNotFound: (bucket: string, e?: Error) =>
    new LaunchDbError({
      code: ErrorCode.BucketNotFound,
      message: `Bucket '${bucket}' not found`,
      httpStatusCode: 404,
      resource: bucket,
      originalError: e,
    }),

  ObjectNotFound: (path: string, e?: Error) =>
    new LaunchDbError({
      code: ErrorCode.ObjectNotFound,
      message: `Object not found at path: ${path}`,
      httpStatusCode: 404,
      resource: path,
      originalError: e,
    }),

  PathTraversalBlocked: (path: string) =>
    new LaunchDbError({
      code: ErrorCode.PathTraversalBlocked,
      message: 'Path traversal attempt blocked',
      httpStatusCode: 400,
      resource: path,
    }),

  // Database errors
  DatabaseTimeout: (operation: string, e?: Error) =>
    new LaunchDbError({
      code: ErrorCode.DatabaseTimeout,
      message: `Database operation timed out: ${operation}`,
      httpStatusCode: 504,
      resource: operation,
      originalError: e,
    }),

  RlsViolation: (table: string, e?: Error) =>
    new LaunchDbError({
      code: ErrorCode.RlsViolation,
      message: `Row-level security policy violation on ${table}`,
      httpStatusCode: 403,
      resource: table,
      originalError: e,
    }),

  // Project errors
  ProjectNotFound: (projectId: string, e?: Error) =>
    new LaunchDbError({
      code: ErrorCode.ProjectNotFound,
      message: 'Project not found',
      httpStatusCode: 404,
      resource: projectId,
      originalError: e,
    }),

  // General
  ValidationError: (message: string, field?: string) =>
    new LaunchDbError({
      code: ErrorCode.ValidationError,
      message,
      httpStatusCode: 400,
      resource: field,
    }),

  InternalError: (message: string, e?: Error) =>
    new LaunchDbError({
      code: ErrorCode.InternalError,
      message: message || 'Internal server error',
      httpStatusCode: 500,
      originalError: e,
    }),
};
