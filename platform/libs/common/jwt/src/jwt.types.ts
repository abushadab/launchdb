/**
 * LaunchDB JWT Types
 * Per interfaces.md §1
 */

export enum JwtRole {
  ANON = 'anon',
  AUTHENTICATED = 'authenticated',
  SERVICE_ROLE = 'service_role',
}

export interface JwtClaims {
  sub: string; // user UUID
  role: JwtRole;
  project_id: string;
  aud: string; // 'authenticated'
  exp: number; // expiration timestamp
  iat: number; // issued at timestamp
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}
