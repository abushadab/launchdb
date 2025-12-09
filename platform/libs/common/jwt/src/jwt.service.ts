/**
 * LaunchDB JWT Service
 * JWT encoding/decoding with HS256 algorithm
 * Per interfaces.md §1
 */

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService as NestJwtService } from '@nestjs/jwt';
import { JwtClaims, JwtRole, AuthTokens } from './jwt.types';

@Injectable()
export class JwtService {
  private readonly logger = new Logger(JwtService.name);

  constructor(private nestJwtService: NestJwtService) {}

  /**
   * Encode JWT claims
   * Uses HS256 algorithm with per-project secret
   */
  encode(claims: JwtClaims, secret: string): string {
    try {
      return this.nestJwtService.sign(claims as any, {
        secret,
        algorithm: 'HS256',
      });
    } catch (error) {
      this.logger.error(`JWT encoding failed: ${error.message}`);
      throw new Error('JWT encoding failed');
    }
  }

  /**
   * Decode and verify JWT
   * Throws UnauthorizedException if invalid
   */
  decode(token: string, secret: string): JwtClaims {
    try {
      return this.nestJwtService.verify(token, {
        secret,
        algorithms: ['HS256'],
      });
    } catch (error) {
      this.logger.error(`JWT verification failed: ${error.message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Create access token (15 minutes TTL per interfaces.md §1)
   */
  createAccessToken(
    userId: string,
    projectId: string,
    role: JwtRole,
    secret: string,
    ttlSeconds: number = 900, // 15 minutes
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const claims: JwtClaims = {
      sub: userId,
      role,
      project_id: projectId,
      aud: 'authenticated',
      iat: now,
      exp: now + ttlSeconds,
    };

    return this.encode(claims, secret);
  }

  /**
   * Create refresh token (7 days TTL per interfaces.md §1)
   */
  createRefreshToken(
    userId: string,
    projectId: string,
    secret: string,
    ttlSeconds: number = 604800, // 7 days
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const claims: JwtClaims = {
      sub: userId,
      role: JwtRole.AUTHENTICATED,
      project_id: projectId,
      aud: 'authenticated',
      iat: now,
      exp: now + ttlSeconds,
    };

    return this.encode(claims, secret);
  }

  /**
   * Create auth token pair (access + refresh)
   */
  createAuthTokens(
    userId: string,
    projectId: string,
    role: JwtRole,
    secret: string,
  ): AuthTokens {
    const accessToken = this.createAccessToken(userId, projectId, role, secret);
    const refreshToken = this.createRefreshToken(userId, projectId, secret);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 900, // 15 minutes
      token_type: 'Bearer',
    };
  }

  /**
   * Decode JWT without verification (for inspection)
   */
  decodeWithoutVerification(token: string): JwtClaims | null {
    try {
      return this.nestJwtService.decode(token) as JwtClaims;
    } catch (error) {
      return null;
    }
  }
}
