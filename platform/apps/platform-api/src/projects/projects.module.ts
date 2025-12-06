/**
 * LaunchDB Projects Module
 */

import { Module } from '@nestjs/common';
import { DatabaseModule } from '@launchdb/common/database';
import { CryptoModule } from '@launchdb/common/crypto';
import { JwtModule } from '@launchdb/common/jwt';
import { OwnersModule } from '../owners/owners.module';
import { PostgrestModule } from '../postgrest/postgrest.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectCreatorService } from './project-creator.service';
import { AuthGuard } from '../guards/auth.guard';

@Module({
  imports: [DatabaseModule, CryptoModule, JwtModule, OwnersModule, PostgrestModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectCreatorService, AuthGuard],
  exports: [ProjectsService],
})
export class ProjectsModule {}
