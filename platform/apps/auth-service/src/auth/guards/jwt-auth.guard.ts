/**
 * JWT Auth Guard
 * Per interfaces.md §3 and v1-decisions.md §14
 * - Fail-closed design (deny on error)
 * - Multi-tenant: uses per-project JWT secret from cache
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService as CustomJwtService } from '@launchdb/common/jwt';
import { ProjectConfigService } from '../project-config.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private jwtService: CustomJwtService,
    private projectConfigService: ProjectConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const projectId = request.params.projectId;

    if (!projectId) {
      this.logger.error('Missing projectId in request');
      throw new UnauthorizedException('Missing project identifier');
    }

    // Extract token from Authorization header
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    try {
      // Get project config (cached, with JWT secret)
      const config = await this.projectConfigService.getProjectConfig(projectId);

      // Decode and verify JWT with project-specific secret
      const payload = this.jwtService.decode(token, config.jwtSecret);

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
