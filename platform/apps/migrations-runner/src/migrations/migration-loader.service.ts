/**
 * Migration Loader Service
 * Loads SQL migration files from libs/sql/project_migrations/
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export interface Migration {
  name: string;
  filename: string;
  sql: string;
  checksum: string;
  order: number;
}

@Injectable()
export class MigrationLoaderService implements OnModuleInit {
  private readonly logger = new Logger(MigrationLoaderService.name);
  private migrations: Migration[] = [];
  private readonly migrationsPath: string;

  constructor() {
    // Path to migrations directory (relative to project root)
    // __dirname in container is /app/dist/apps/migrations-runner
    // Go up 3 levels to reach /app
    this.migrationsPath = path.join(
      __dirname,
      '../../..',
      'libs/sql/project_migrations',
    );
  }

  async onModuleInit() {
    await this.loadMigrations();
  }

  /**
   * Load all migration files
   */
  async loadMigrations(): Promise<void> {
    try {
      const files = await fs.readdir(this.migrationsPath);
      const sqlFiles = files
        .filter((f) => f.endsWith('.sql'))
        .sort(); // Lexicographic sort (001_, 002_, 003_)

      this.migrations = [];

      for (let i = 0; i < sqlFiles.length; i++) {
        const filename = sqlFiles[i];
        const filePath = path.join(this.migrationsPath, filename);
        const sql = await fs.readFile(filePath, 'utf8');
        const checksum = this.calculateChecksum(sql);

        this.migrations.push({
          name: filename.replace('.sql', ''),
          filename,
          sql,
          checksum,
          order: i + 1,
        });

        this.logger.log(
          `Loaded migration: ${filename} (checksum: ${checksum.substring(0, 8)}...)`,
        );
      }

      this.logger.log(`Loaded ${this.migrations.length} migrations`);
    } catch (error) {
      this.logger.error(`Failed to load migrations: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all migrations in order
   */
  getMigrations(): Migration[] {
    return [...this.migrations];
  }

  /**
   * Get migration by name
   */
  getMigration(name: string): Migration | undefined {
    return this.migrations.find((m) => m.name === name);
  }

  /**
   * Calculate SHA-256 checksum of migration content
   */
  private calculateChecksum(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}
