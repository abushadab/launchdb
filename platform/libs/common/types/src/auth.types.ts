/**
 * LaunchDB Auth Types
 * Common types for authentication
 */

export interface User {
  id: string;
  email: string;
  password_hash: string;
  email_verified: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Session {
  id: string;
  user_id: string;
  created_at: Date;
  expires_at: Date;
}

export interface RefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  created_at: Date;
}

export interface ProjectConfig {
  projectId: string;
  dbName: string;
  authenticatorRole: string;
  dbPassword: string;
  jwtSecret: string;
  status: string;
  host: string;
  port: number;
}
