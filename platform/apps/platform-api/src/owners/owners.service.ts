/**
 * LaunchDB Owners Service
 * Handles owner authentication (signup/login)
 */

import {
  Injectable,
  Logger,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '@launchdb/common/database';
import { PasswordService } from '@launchdb/common/crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  SignupOwnerDto,
  SignupOwnerResponseDto,
} from './dto/signup-owner.dto';
import { LoginOwnerDto, LoginOwnerResponseDto } from './dto/login-owner.dto';

@Injectable()
export class OwnersService {
  private readonly logger = new Logger(OwnersService.name);
  private readonly platformJwtSecret: string;

  constructor(
    private databaseService: DatabaseService,
    private passwordService: PasswordService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    this.platformJwtSecret = this.configService.get<string>(
      'platformJwtSecret',
    );

    if (!this.platformJwtSecret) {
      throw new Error('platformJwtSecret configuration is required');
    }
  }

  /**
   * Owner signup
   * Creates new owner account with hashed password
   */
  async signup(dto: SignupOwnerDto): Promise<SignupOwnerResponseDto> {
    // Hash password
    const passwordHash = await this.passwordService.hash(dto.password);

    // Generate owner ID
    const ownerId = uuidv4();

    // Insert owner - unique constraint will prevent duplicates
    let result;
    try {
      result = await this.databaseService.queryOne(
        `INSERT INTO platform.owners (id, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, email, created_at`,
        [ownerId, dto.email, passwordHash],
      );
    } catch (error) {
      if (error.code === '23505') {
        // Unique constraint violation
        throw new ConflictException('Email already registered');
      }
      throw error;
    }

    this.logger.log(`Owner created: ${result.id}`);

    return {
      owner_id: result.id,
      email: result.email,
      created_at: result.created_at,
    };
  }

  /**
   * Owner login
   * Verifies credentials and issues JWT
   */
  async login(dto: LoginOwnerDto): Promise<LoginOwnerResponseDto> {
    // Find owner
    const owner = await this.databaseService.queryOne(
      'SELECT id, email, password_hash FROM platform.owners WHERE email = $1',
      [dto.email],
    );

    if (!owner) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isValid = await this.passwordService.verify(
      owner.password_hash,
      dto.password,
    );

    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate JWT
    const payload = {
      sub: owner.id,
      email: owner.email,
      type: 'platform',
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.platformJwtSecret,
      expiresIn: '7d', // 7 days for platform tokens
    });

    this.logger.log(`Owner logged in: ${owner.id}`);

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 604800, // 7 days
    };
  }

  /**
   * Verify owner JWT and return owner ID
   */
  async verifyToken(token: string): Promise<string> {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.platformJwtSecret,
      });
      return payload.sub;
    } catch (error) {
      // Log the underlying verification issue to aid debugging
      this.logger.warn(
        `JWT verification failed: ${error?.name || 'Error'} - ${
          error?.message || 'unknown reason'
        }`,
      );
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
