/**
 * Auth Module
 * Multi-tenant authentication module
 */

import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ProjectConfigService } from './project-config.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CryptoModule } from '@launchdb/common/crypto';
import { DatabaseModule } from '@launchdb/common/database';
import { JwtModule } from '@launchdb/common/jwt';

@Module({
  imports: [CryptoModule, DatabaseModule, JwtModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    ProjectConfigService,
    JwtAuthGuard,
  ],
  exports: [AuthService, ProjectConfigService],
})
export class AuthModule {}
