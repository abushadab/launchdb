/**
 * LaunchDB Platform API - Health Controller
 * Health check endpoint
 */

import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return {
      status: 'healthy',
      service: 'platform-api',
      timestamp: new Date().toISOString(),
    };
  }
}
