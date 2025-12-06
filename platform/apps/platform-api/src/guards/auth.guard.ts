/**
 * Platform API Auth Guard
 * Verifies platform JWT tokens
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { OwnersService } from '../owners/owners.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private ownersService: OwnersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const token = authHeader.substring(7);

    try {
      const ownerId = await this.ownersService.verifyToken(token);
      request.ownerId = ownerId;
      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
