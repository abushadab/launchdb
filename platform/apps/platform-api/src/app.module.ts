/**
 * LaunchDB Platform API - App Module
 * Root module for Platform API service
 */

import { Module } from '@nestjs/common';
import { LaunchDBConfigModule } from '@launchdb/common/config';
import { DatabaseModule } from '@launchdb/common/database';
import { CryptoModule } from '@launchdb/common/crypto';
import { JwtModule } from '@launchdb/common/jwt';
import { OwnersModule } from './owners/owners.module';
import { ProjectsModule } from './projects/projects.module';
import { PostgrestModule } from './postgrest/postgrest.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    LaunchDBConfigModule,
    DatabaseModule,
    CryptoModule,
    JwtModule,
    OwnersModule,
    ProjectsModule,
    PostgrestModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
