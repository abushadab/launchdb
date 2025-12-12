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

  FileTooLarge: (sizeBytes: number, maxBytes: number) =>
    new LaunchDbError({
      code: ErrorCode.FileTooLarge,
      message: `File size (${sizeBytes} bytes) exceeds maximum allowed (${maxBytes} bytes)`,
      httpStatusCode: 413,
      metadata: { sizeBytes, maxBytes },
    }),

  InvalidMimeType: (mimeType: string) =>
    new LaunchDbError({
      code: ErrorCode.InvalidMimeType,
      message: `Invalid or disallowed MIME type: ${mimeType}`,
      httpStatusCode: 400,
      resource: mimeType,
    }),

  SignedUrlExpired: () =>
    new LaunchDbError({
      code: ErrorCode.SignedUrlExpired,
      message: 'Signed URL has expired or is invalid',
      httpStatusCode: 401,
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

  ProjectAlreadyExists: (name: string, e?: Error) =>
    new LaunchDbError({
      code: ErrorCode.ProjectAlreadyExists,
      message: `Project with name '${name}' already exists`,
      httpStatusCode: 409,
      resource: name,
      originalError: e,
    }),

  // Owner errors
  OwnerNotFound: (ownerId: string, e?: Error) =>
    new LaunchDbError({
      code: ErrorCode.OwnerNotFound,
      message: 'Owner not found',
      httpStatusCode: 404,
      resource: ownerId,
      originalError: e,
    }),

  OwnerAlreadyExists: (email: string, e?: Error) =>
    new LaunchDbError({
      code: ErrorCode.OwnerAlreadyExists,
      message: 'Email already registered',
      httpStatusCode: 409,
      resource: email,
      originalError: e,
    }),

  // Access errors
  AccessDenied: (resource?: string) =>
    new LaunchDbError({
      code: ErrorCode.AccessDenied,
      message: 'Access denied',
      httpStatusCode: 403,
      resource,
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
