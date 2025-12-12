/**
 * Auth Service
 * Multi-tenant authentication logic
 * Per interfaces.md §3
 */

import {
  Injectable,
  Logger,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { randomBytes } from 'crypto';
import { PasswordService, TokenHashService } from '@launchdb/common/crypto';
import { JwtService as CustomJwtService, JwtRole } from '@launchdb/common/jwt';
import { withJwtClaimsTx } from '@launchdb/common/database';
import { ProjectConfigService } from './project-config.service';
import { SignupDto, SignupResponseDto } from './dto/signup.dto';
import { LoginDto, LoginResponseDto } from './dto/login.dto';
import { RefreshDto, RefreshResponseDto } from './dto/refresh.dto';
import { UserResponseDto } from './dto/user.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly projectPools = new Map<string, Pool>();
  private readonly poolAccessTimes = new Map<string, number>();
  private readonly MAX_POOLS = 100; // LRU eviction limit to prevent unbounded growth

  // Token TTLs per interfaces.md §1
  private readonly ACCESS_TOKEN_TTL = 15 * 60; // 15 minutes
  private readonly REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days

  constructor(
    private configService: ConfigService,
    private passwordService: PasswordService,
    private tokenHashService: TokenHashService,
    private jwtService: CustomJwtService,
    private projectConfigService: ProjectConfigService,
  ) {}

  /**
   * User signup
   */
  async signup(
    projectId: string,
    dto: SignupDto,
  ): Promise<SignupResponseDto> {
    this.logger.log(`Signup attempt in project ${projectId}`);

    const config = await this.projectConfigService.getProjectConfig(projectId);
    const pool = this.getProjectPool(projectId, config);

    // Hash password
    const passwordHash = await this.passwordService.hash(dto.password);

    // Generate user ID
    const userId = this.generateUserId();

    // Wrap user creation and session creation in transaction
    const { accessToken, refreshToken } = await withJwtClaimsTx(pool, null, async (client) => {
      // Insert user
      try {
        await client.query(
          `INSERT INTO auth.users (id, email, password_hash, created_at, updated_at)
           VALUES ($1, $2, $3, now(), now())`,
          [userId, dto.email, passwordHash],
        );
      } catch (error) {
        if (error.code === '23505') {
          // Unique violation
          throw new ConflictException('Email already registered');
        }
        throw error;
      }

      // Create session within the same transaction
      return this.createSessionWithClient(
        client,
        userId,
        projectId,
        config.jwtSecret,
      );
    });

    return {
      user_id: userId,
      email: dto.email,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: this.ACCESS_TOKEN_TTL,
    };
  }

  /**
   * User login
   */
  async login(
    projectId: string,
    dto: LoginDto,
  ): Promise<LoginResponseDto> {
    this.logger.log(`Login attempt in project ${projectId}`);

    const config = await this.projectConfigService.getProjectConfig(projectId);
    const pool = this.getProjectPool(projectId, config);

    // Get user and create session (use service_role for RLS bypass)
    const result = await withJwtClaimsTx(pool, null, async (client) => {
      const user = await client.query(
        `SELECT id, email, password_hash
         FROM auth.users
         WHERE email = $1`,
        [dto.email],
      );

      if (user.rows.length === 0) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const userData = user.rows[0];

      // Verify password
      const isValid = await this.passwordService.verify(
        userData.password_hash,
        dto.password,
      );

      if (!isValid) {
        throw new UnauthorizedException('Invalid credentials');
      }

      // Create session (within same client for consistency)
      const { accessToken, refreshToken } = await this.createSessionWithClient(
        client,
        userData.id,
        projectId,
        config.jwtSecret,
      );

      return {
        user_id: userData.id,
        email: userData.email,
        access_token: accessToken,
        refresh_token: refreshToken,
      };
    });

    return {
      ...result,
      expires_in: this.ACCESS_TOKEN_TTL,
    };
  }

  /**
   * Refresh access token
   */
  async refresh(
    projectId: string,
    dto: RefreshDto,
  ): Promise<RefreshResponseDto> {
    this.logger.log(`Refresh token attempt for project ${projectId}`);

    const config = await this.projectConfigService.getProjectConfig(projectId);
    const pool = this.getProjectPool(projectId, config);

    // Wrap token rotation in transaction to prevent race conditions
    return withJwtClaimsTx(pool, null, async (client) => {
      // Hash refresh token for lookup
      const tokenHash = this.tokenHashService.hash(dto.refresh_token);

      // Get and lock refresh token to prevent concurrent reuse (TOCTOU protection)
      const result = await client.query(
        `SELECT rt.id, rt.user_id, rt.expires_at, s.id as session_id
         FROM auth.refresh_tokens rt
         JOIN auth.sessions s ON s.id = rt.session_id
         WHERE rt.token_hash = $1
           AND rt.revoked_at IS NULL
           AND rt.expires_at > now()
         FOR UPDATE OF rt`,
        [tokenHash],
      );

      if (result.rows.length === 0) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      const tokenData = result.rows[0];

      // Generate new tokens
      const accessToken = this.jwtService.createAccessToken(
        tokenData.user_id,
        projectId,
        JwtRole.AUTHENTICATED,
        config.jwtSecret,
        this.ACCESS_TOKEN_TTL,
      );

      const newRefreshToken = this.generateRefreshToken();
      const newTokenHash = this.tokenHashService.hash(newRefreshToken);

      // Revoke old refresh token (revoked_at not revoked)
      await client.query(
        `UPDATE auth.refresh_tokens
         SET revoked_at = now()
         WHERE id = $1`,
        [tokenData.id],
      );

      // Create new refresh token (no updated_at column)
      const expiresAt = new Date(Date.now() + this.REFRESH_TOKEN_TTL * 1000);
      await client.query(
        `INSERT INTO auth.refresh_tokens (session_id, user_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, now())`,
        [tokenData.session_id, tokenData.user_id, newTokenHash, expiresAt],
      );

      // Update session last_activity_at (not last_active)
      await client.query(
        `UPDATE auth.sessions
         SET last_activity_at = now()
         WHERE id = $1`,
        [tokenData.session_id],
      );

      return {
        access_token: accessToken,
        refresh_token: newRefreshToken,
        expires_in: this.ACCESS_TOKEN_TTL,
      };
    });
  }

  /**
   * Logout (revoke refresh token)
   */
  async logout(projectId: string, refreshToken: string): Promise<void> {
    this.logger.log(`Logout attempt for project ${projectId}`);

    const config = await this.projectConfigService.getProjectConfig(projectId);
    const pool = this.getProjectPool(projectId, config);

    const tokenHash = this.tokenHashService.hash(refreshToken);

    await withJwtClaimsTx(pool, null, async (client) => {
      await client.query(
        `UPDATE auth.refresh_tokens
         SET revoked_at = now()
         WHERE token_hash = $1`,
        [tokenHash],
      );
    });
  }

  /**
   * Get user info
   */
  async getUser(
    projectId: string,
    userId: string,
  ): Promise<UserResponseDto> {
    const config = await this.projectConfigService.getProjectConfig(projectId);
    const pool = this.getProjectPool(projectId, config);

    return withJwtClaimsTx(pool, null, async (client) => {
      const result = await client.query(
        `SELECT id, email, created_at
         FROM auth.users
         WHERE id = $1`,
        [userId],
      );

      if (result.rows.length === 0) {
        throw new NotFoundException('User not found');
      }

      const user = result.rows[0];

      return {
        user_id: user.id,
        email: user.email,
        created_at: user.created_at,
      };
    });
  }

  /**
   * Create session and tokens
   */
  private async createSession(
    pool: Pool,
    userId: string,
    projectId: string,
    jwtSecret: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // Generate tokens
    const accessToken = this.jwtService.createAccessToken(
      userId,
      projectId,
      JwtRole.AUTHENTICATED,
      jwtSecret,
      this.ACCESS_TOKEN_TTL,
    );

    const refreshToken = this.generateRefreshToken();
    const tokenHash = this.tokenHashService.hash(refreshToken);

    // Create session and refresh token atomically
    const sessionId = this.generateSessionId();
    const expiresAt = new Date(Date.now() + this.REFRESH_TOKEN_TTL * 1000);

    await withJwtClaimsTx(pool, null, async (client) => {
      // Create session (expires_at = refresh token TTL, last_activity_at = now)
      const sessionExpiresAt = new Date(Date.now() + this.REFRESH_TOKEN_TTL * 1000);
      await client.query(
        `INSERT INTO auth.sessions (id, user_id, expires_at, created_at, updated_at, last_activity_at)
         VALUES ($1, $2, $3, now(), now(), now())`,
        [sessionId, userId, sessionExpiresAt],
      );

      // Create refresh token
      await client.query(
        `INSERT INTO auth.refresh_tokens (session_id, user_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, now())`,
        [sessionId, userId, tokenHash, expiresAt],
      );
    });

    return { accessToken, refreshToken };
  }

  /**
   * Create session and tokens using existing client (for use within transaction)
   */
  private async createSessionWithClient(
    client: any,
    userId: string,
    projectId: string,
    jwtSecret: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // Generate tokens
    const accessToken = this.jwtService.createAccessToken(
      userId,
      projectId,
      JwtRole.AUTHENTICATED,
      jwtSecret,
      this.ACCESS_TOKEN_TTL,
    );

    const refreshToken = this.generateRefreshToken();
    const tokenHash = this.tokenHashService.hash(refreshToken);

    // Create session and refresh token (no transaction - already within one)
    const sessionId = this.generateSessionId();
    const expiresAt = new Date(Date.now() + this.REFRESH_TOKEN_TTL * 1000);
    const sessionExpiresAt = expiresAt; // Session expires with refresh token

    // Create session (expires_at required, last_activity_at not last_active)
    await client.query(
      `INSERT INTO auth.sessions (id, user_id, expires_at, created_at, updated_at, last_activity_at)
       VALUES ($1, $2, $3, now(), now(), now())`,
      [sessionId, userId, sessionExpiresAt],
    );

    // Create refresh token (no updated_at column in this table)
    await client.query(
      `INSERT INTO auth.refresh_tokens (session_id, user_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, now())`,
      [sessionId, userId, tokenHash, expiresAt],
    );

    return { accessToken, refreshToken };
  }

  /**
   * Get or create pool for project database
   */
  private getProjectPool(projectId: string, config: any): Pool {
    // Update access time for LRU tracking
    this.poolAccessTimes.set(projectId, Date.now());

    if (!this.projectPools.has(projectId)) {
      // Evict LRU pool if at capacity
      if (this.projectPools.size >= this.MAX_POOLS) {
        this.evictLruPool();
      }

      const host = this.configService.get<string>('projectsDbHost');
      const port = this.configService.get<number>('projectsDbPort');
      const authenticatorRole = `${projectId}_authenticator`;

      // URL-encode password to handle special characters (+/=) from base64
      const encodedPassword = encodeURIComponent(config.dbPassword);
      const dsn = `postgresql://${authenticatorRole}:${encodedPassword}@${host}:${port}/${config.dbName}`;

      this.projectPools.set(
        projectId,
        new Pool({
          connectionString: dsn,
          min: 2,
          max: 10,
          connectionTimeoutMillis: 10000,
        }),
      );

      this.logger.log(`Created connection pool for project ${projectId}`);
    }

    return this.projectPools.get(projectId)!;
  }

  /**
   * Evict least recently used pool to prevent unbounded growth
   */
  private evictLruPool(): void {
    let lruProjectId: string | null = null;
    let oldestAccessTime = Infinity;

    // Find the least recently used pool
    for (const [projectId, accessTime] of this.poolAccessTimes.entries()) {
      if (accessTime < oldestAccessTime) {
        oldestAccessTime = accessTime;
        lruProjectId = projectId;
      }
    }

    if (lruProjectId) {
      const pool = this.projectPools.get(lruProjectId);
      if (pool) {
        // Close pool gracefully (async, but don't block)
        pool.end().catch((err) => {
          this.logger.error(
            `Error closing pool for project ${lruProjectId}: ${err.message}`,
          );
        });
      }

      this.projectPools.delete(lruProjectId);
      this.poolAccessTimes.delete(lruProjectId);
      this.logger.log(`Evicted LRU pool for project ${lruProjectId}`);
    }
  }

  /**
   * Generate secure user ID (UUID format)
   */
  private generateUserId(): string {
    const bytes = randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10

    return [
      bytes.slice(0, 4).toString('hex'),
      bytes.slice(4, 6).toString('hex'),
      bytes.slice(6, 8).toString('hex'),
      bytes.slice(8, 10).toString('hex'),
      bytes.slice(10, 16).toString('hex'),
    ].join('-');
  }

  /**
   * Generate secure session ID
   */
  private generateSessionId(): string {
    return this.generateUserId(); // Same format as user ID
  }

  /**
   * Generate refresh token (32 bytes, base64)
   */
  private generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }
}
