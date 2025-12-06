/**
 * Migrations Module
 * Database schema migration module
 */

import { Module } from '@nestjs/common';
import { MigrationsController } from './migrations.controller';
import { MigrationsService } from './migrations.service';
import { MigrationLoaderService } from './migration-loader.service';
import { InternalApiKeyGuard } from './guards/internal-api-key.guard';
import { DatabaseModule } from '@launchdb/common/database';
import { CryptoModule } from '@launchdb/common/crypto';

@Module({
  imports: [DatabaseModule, CryptoModule],
  controllers: [MigrationsController],
  providers: [
    MigrationsService,
    MigrationLoaderService,
    InternalApiKeyGuard,
  ],
  exports: [MigrationsService],
})
export class MigrationsModule {}
