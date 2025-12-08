/**
 * Platform API Auth Guard
 * Verifies platform JWT tokens
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { OwnersService } from '../owners/owners.service';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private ownersService: OwnersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    // Debug logging: raw header
    this.logger.debug('Auth header raw:', JSON.stringify(authHeader));

    // Extract and trim token to remove any stray whitespace
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    // Debug logging: token details
    this.logger.debug(
      `Auth header length: ${authHeader.length}, Token length: ${token.length}`,
    );
    this.logger.debug(`Token preview: ${token.substring(0, 50)}...`);

    try {
      const ownerId = await this.ownersService.verifyToken(token);
      request.ownerId = ownerId;
      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
