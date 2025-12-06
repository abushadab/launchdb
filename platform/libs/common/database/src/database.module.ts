/**
 * LaunchDB Database Module
 * Provides database connection pooling and project database management
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseService } from './database.service';
import { ProjectDatabaseService } from './project-database.service';

@Module({
  imports: [ConfigModule],
  providers: [DatabaseService, ProjectDatabaseService],
  exports: [DatabaseService, ProjectDatabaseService],
})
export class DatabaseModule {}
