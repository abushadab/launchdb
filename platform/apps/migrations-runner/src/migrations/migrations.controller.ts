/**
 * Migrations Controller
 * Internal endpoint for triggering migrations
 * Per interfaces.md §5
 */

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { MigrationsService } from './migrations.service';
import {
  RunMigrationsDto,
  RunMigrationsResponseDto,
} from './dto/run-migrations.dto';
import { InternalApiKeyGuard } from './guards/internal-api-key.guard';

@Controller('internal/migrations')
@UseGuards(InternalApiKeyGuard)
export class MigrationsController {
  constructor(private migrationsService: MigrationsService) {}

  /**
   * POST /internal/migrations/run
   * Execute migrations for a project
   * Requires INTERNAL_API_KEY header
   */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  async runMigrations(
    @Body() dto: RunMigrationsDto,
  ): Promise<RunMigrationsResponseDto> {
    return this.migrationsService.runMigrations(dto.project_id);
  }
}
