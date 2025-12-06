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
import { ProjectConfigService } from './project-config.service';
import { SignupDto, SignupResponseDto } from './dto/signup.dto';
import { LoginDto, LoginResponseDto } from './dto/login.dto';
import { RefreshDto, RefreshResponseDto } from './dto/refresh.dto';
import { UserResponseDto } from './dto/user.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly projectPools = new Map<string, Pool>();

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

    // Insert user
    try {
      await pool.query(
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

    // Create session
    const { accessToken, refreshToken } = await this.createSession(
      pool,
      userId,
      projectId,
      config.jwtSecret,
    );

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

    // Get user
    const user = await pool.query(
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

    // Create session
    const { accessToken, refreshToken } = await this.createSession(
      pool,
      userData.id,
      projectId,
      config.jwtSecret,
    );

    return {
      user_id: userData.id,
      email: userData.email,
      access_token: accessToken,
      refresh_token: refreshToken,
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

    // Hash refresh token for lookup
    const tokenHash = this.tokenHashService.hash(dto.refresh_token);

    // Get refresh token
    const result = await pool.query(
      `SELECT rt.id, rt.user_id, rt.expires_at, s.id as session_id
       FROM auth.refresh_tokens rt
       JOIN auth.sessions s ON s.id = rt.session_id
       WHERE rt.token_hash = $1
         AND rt.revoked = false
         AND rt.expires_at > now()`,
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

    // Revoke old refresh token
    await pool.query(
      `UPDATE auth.refresh_tokens
       SET revoked = true, updated_at = now()
       WHERE id = $1`,
      [tokenData.id],
    );

    // Create new refresh token
    const expiresAt = new Date(Date.now() + this.REFRESH_TOKEN_TTL * 1000);
    await pool.query(
      `INSERT INTO auth.refresh_tokens (session_id, user_id, token_hash, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [tokenData.session_id, tokenData.user_id, newTokenHash, expiresAt],
    );

    // Update session last_active
    await pool.query(
      `UPDATE auth.sessions
       SET last_active = now()
       WHERE id = $1`,
      [tokenData.session_id],
    );

    return {
      access_token: accessToken,
      refresh_token: newRefreshToken,
      expires_in: this.ACCESS_TOKEN_TTL,
    };
  }

  /**
   * Logout (revoke refresh token)
   */
  async logout(projectId: string, refreshToken: string): Promise<void> {
    this.logger.log(`Logout attempt for project ${projectId}`);

    const config = await this.projectConfigService.getProjectConfig(projectId);
    const pool = this.getProjectPool(projectId, config);

    const tokenHash = this.tokenHashService.hash(refreshToken);

    await pool.query(
      `UPDATE auth.refresh_tokens
       SET revoked = true, updated_at = now()
       WHERE token_hash = $1`,
      [tokenHash],
    );
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

    const result = await pool.query(
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

    // Create session
    const sessionId = this.generateSessionId();
    await pool.query(
      `INSERT INTO auth.sessions (id, user_id, created_at, last_active)
       VALUES ($1, $2, now(), now())`,
      [sessionId, userId],
    );

    // Create refresh token
    const expiresAt = new Date(Date.now() + this.REFRESH_TOKEN_TTL * 1000);
    await pool.query(
      `INSERT INTO auth.refresh_tokens (session_id, user_id, token_hash, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [sessionId, userId, tokenHash, expiresAt],
    );

    return { accessToken, refreshToken };
  }

  /**
   * Get or create pool for project database
   */
  private getProjectPool(projectId: string, config: any): Pool {
    if (!this.projectPools.has(projectId)) {
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
