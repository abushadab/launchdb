export enum ErrorCode {
  // Auth errors
  InvalidCredentials = 'InvalidCredentials',
  UserNotFound = 'UserNotFound',
  UserAlreadyExists = 'UserAlreadyExists',
  TokenExpired = 'TokenExpired',
  TokenInvalid = 'TokenInvalid',
  SessionNotFound = 'SessionNotFound',

  // Storage errors
  BucketNotFound = 'BucketNotFound',
  ObjectNotFound = 'ObjectNotFound',
  InvalidPath = 'InvalidPath',
  PathTraversalBlocked = 'PathTraversalBlocked',
  FileTooLarge = 'FileTooLarge',
  InvalidMimeType = 'InvalidMimeType',
  SignedUrlExpired = 'SignedUrlExpired',

  // Database errors
  DatabaseTimeout = 'DatabaseTimeout',
  ConnectionFailed = 'ConnectionFailed',
  TransactionFailed = 'TransactionFailed',
  RlsViolation = 'RlsViolation',

  // Project errors
  ProjectNotFound = 'ProjectNotFound',
  ProjectAlreadyExists = 'ProjectAlreadyExists',
  ProjectProvisioningFailed = 'ProjectProvisioningFailed',

  // Owner errors
  OwnerNotFound = 'OwnerNotFound',
  OwnerAlreadyExists = 'OwnerAlreadyExists',

  // Access errors
  AccessDenied = 'AccessDenied',

  // General errors
  ValidationError = 'ValidationError',
  InternalError = 'InternalError',
  NotImplemented = 'NotImplemented',
}
