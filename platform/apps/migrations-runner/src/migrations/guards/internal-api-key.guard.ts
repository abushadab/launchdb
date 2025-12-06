/**
 * Internal API Key Guard
 * Validates INTERNAL_API_KEY for service-to-service communication
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(InternalApiKeyGuard.name);
  private readonly internalApiKey: string;

  constructor(private configService: ConfigService) {
    this.internalApiKey = this.configService.get<string>('internalApiKey');

    if (!this.internalApiKey || this.internalApiKey === 'change-me-in-production') {
      this.logger.warn(
        'INTERNAL_API_KEY not configured or using default value - internal endpoints are not secure!',
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-internal-api-key'];

    if (!apiKey) {
      this.logger.warn('Missing X-Internal-API-Key header');
      throw new UnauthorizedException('Missing internal API key');
    }

    const apiKeyBuffer = Buffer.from(apiKey);
    const expectedKeyBuffer = Buffer.from(this.internalApiKey);

    if (
      apiKeyBuffer.length !== expectedKeyBuffer.length ||
      !crypto.timingSafeEqual(apiKeyBuffer, expectedKeyBuffer)
    ) {
      this.logger.warn('Invalid X-Internal-API-Key provided');
      throw new UnauthorizedException('Invalid internal API key');
    }

    return true;
  }
}
