/**
 * JWT Auth Guard for Storage Service
 * Multi-tenant JWT validation for storage endpoints
 * Allows both JWT auth and signed URL access
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService as CustomJwtService } from '@launchdb/common/jwt';
import { DatabaseService } from '@launchdb/common/database';
import { CryptoService } from '@launchdb/common/crypto';

interface ProjectConfig {
  jwtSecret: string;
  status: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly configCache = new Map<string, { config: ProjectConfig; timestamp: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    private jwtService: CustomJwtService,
    private databaseService: DatabaseService,
    private cryptoService: CryptoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const projectId = request.params.projectId;

    if (!projectId) {
      this.logger.error('Missing projectId in request');
      throw new UnauthorizedException('Missing project identifier');
    }

    // Check if this is a signed URL request (has token query param)
    const signedUrlToken = request.query.token;
    if (signedUrlToken) {
      // Signed URL auth is handled by the service layer, not the guard
      // Allow request to proceed - service will validate the signed URL token
      return true;
    }

    // Extract JWT token from Authorization header
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    try {
      // Get project config (with caching)
      const config = await this.getProjectConfig(projectId);

      // Verify project is active
      if (config.status !== 'active') {
        throw new UnauthorizedException('Project not active');
      }

      // Decode and verify JWT with project-specific secret
      const payload = this.jwtService.decode(token, config.jwtSecret);

      // Validate payload structure
      if (
        !payload ||
        typeof payload !== 'object' ||
        typeof payload.sub !== 'string' ||
        typeof payload.project_id !== 'string' ||
        typeof payload.role !== 'string' ||
        !payload.sub ||
        !payload.project_id ||
        !payload.role
      ) {
        this.logger.error('JWT payload validation failed: invalid structure');
        throw new UnauthorizedException('Invalid token payload');
      }

      // Verify project_id in JWT matches request path
      if (payload.project_id !== projectId) {
        this.logger.warn(
          `JWT project_id mismatch: token=${payload.project_id}, path=${projectId}`,
        );
        throw new UnauthorizedException('Invalid token for this project');
      }

      // Attach user payload to request
      request.user = payload;

      return true;
    } catch (error) {
      // Fail-closed: deny access on any error
      this.logger.error(
        `JWT validation failed for project ${projectId}: ${error.message}`,
      );

      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Get project configuration with caching
   */
  private async getProjectConfig(projectId: string): Promise<ProjectConfig> {
    // Check cache
    const cached = this.configCache.get(projectId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.config;
    }

    // Fetch from database
    const project = await this.databaseService.queryOne(
      'SELECT status FROM platform.projects WHERE id = $1',
      [projectId],
    );

    if (!project) {
      throw new UnauthorizedException('Project not found');
    }

    const secret = await this.databaseService.queryOne(
      `SELECT encrypted_value FROM platform.secrets
       WHERE project_id = $1 AND secret_type = 'jwt_secret'`,
      [projectId],
    );

    if (!secret) {
      throw new UnauthorizedException('Project JWT secret not found');
    }

    const jwtSecret = this.cryptoService.decrypt(secret.encrypted_value);

    const config: ProjectConfig = {
      jwtSecret,
      status: project.status,
    };

    // Update cache
    this.configCache.set(projectId, { config, timestamp: Date.now() });

    return config;
  }

  /**
   * Extract Bearer token from Authorization header
   */
  private extractTokenFromHeader(request: any): string | null {
    const authHeader = request.headers.authorization;

    if (!authHeader || typeof authHeader !== 'string') {
      return null;
    }

    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer' || !token) {
      return null;
    }

    return token;
  }
}
