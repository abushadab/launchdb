/**
 * Migrations Service
 * Execute database schema migrations
 * Per interfaces.md §5 and v1-decisions.md §17
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@launchdb/common/database';
import { CryptoService } from '@launchdb/common/crypto';
import { Pool } from 'pg';
import { MigrationLoaderService, Migration } from './migration-loader.service';
import { RunMigrationsResponseDto, MigrationResult } from './dto/run-migrations.dto';

@Injectable()
export class MigrationsService {
  private readonly logger = new Logger(MigrationsService.name);
  private readonly projectPools = new Map<string, Pool>();

  constructor(
    private configService: ConfigService,
    private databaseService: DatabaseService,
    private cryptoService: CryptoService,
    private migrationLoader: MigrationLoaderService,
  ) {}

  /**
   * Run migrations for a project
   * Uses admin DSN for sufficient privileges
   */
  async runMigrations(projectId: string): Promise<RunMigrationsResponseDto> {
    this.logger.log(`Running migrations for project ${projectId}`);

    const startTime = Date.now();

    // Validate project exists and is active
    const project = await this.databaseService.queryOne(
      'SELECT id, db_name, status FROM platform.projects WHERE id = $1',
      [projectId],
    );

    if (!project) {
      throw new NotFoundException(`Project not found: ${projectId}`);
    }

    if (project.status !== 'provisioning' && project.status !== 'active') {
      throw new BadRequestException(
        `Cannot run migrations on project with status: ${project.status}`,
      );
    }

    // Get all migrations
    const migrations = this.migrationLoader.getMigrations();
    if (migrations.length === 0) {
      throw new BadRequestException('No migrations found');
    }

    // Get project database pool (with admin privileges)
    const pool = await this.getProjectPool(projectId, project.db_name);

    // Ensure migration_state table exists
    await this.ensureMigrationStateTable(pool);

    // Get already-applied migrations
    const appliedMigrations = await this.getAppliedMigrations(pool, projectId);
    const appliedMap = new Map(
      appliedMigrations.map((m) => [m.name, m.checksum]),
    );

    const results: MigrationResult[] = [];
    let appliedCount = 0;
    let skippedCount = 0;

    // Execute migrations in order
    for (const migration of migrations) {
      const result = await this.executeMigration(
        pool,
        projectId,
        migration,
        appliedMap,
      );

      results.push(result);

      if (result.executed) {
        appliedCount++;
      } else {
        skippedCount++;
      }

      // Stop on first error
      if (result.error) {
        this.logger.error(
          `Migration ${migration.name} failed: ${result.error}`,
        );
        break;
      }
    }

    const totalDuration = Date.now() - startTime;
    const hasErrors = results.some((r) => r.error);

    const status = hasErrors
      ? 'failed'
      : appliedCount > 0
      ? 'success'
      : 'no_changes';

    this.logger.log(
      `Migrations complete for ${projectId}: ${appliedCount} applied, ${skippedCount} skipped, ${totalDuration}ms`,
    );

    return {
      project_id: projectId,
      migrations_applied: appliedCount,
      migrations_skipped: skippedCount,
      total_duration_ms: totalDuration,
      results,
      status,
    };
  }

  /**
   * Execute a single migration
   */
  private async executeMigration(
    pool: Pool,
    projectId: string,
    migration: Migration,
    appliedMap: Map<string, string>,
  ): Promise<MigrationResult> {
    const existingChecksum = appliedMap.get(migration.name);

    // Migration already applied
    if (existingChecksum) {
      // Checksum mismatch
      if (existingChecksum !== migration.checksum) {
        return {
          name: migration.name,
          checksum: migration.checksum,
          executed: false,
          error: `Checksum mismatch: expected ${existingChecksum}, got ${migration.checksum}`,
        };
      }

      // Already applied, skip
      this.logger.debug(`Migration ${migration.name} already applied, skipping`);
      return {
        name: migration.name,
        checksum: migration.checksum,
        executed: false,
      };
    }

    // Execute migration
    const startTime = Date.now();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Set statement timeout to prevent indefinite hanging (5 minutes)
      await client.query('SET LOCAL statement_timeout = 300000');

      // Execute SQL
      await client.query(migration.sql);

      // Record in migration_state
      await client.query(
        `INSERT INTO platform.migration_state (project_id, migration_name, checksum, executed_at)
         VALUES ($1, $2, $3, now())`,
        [projectId, migration.name, migration.checksum],
      );

      await client.query('COMMIT');

      const duration = Date.now() - startTime;
      this.logger.log(
        `Migration ${migration.name} applied successfully (${duration}ms)`,
      );

      return {
        name: migration.name,
        checksum: migration.checksum,
        executed: true,
        duration_ms: duration,
      };
    } catch (error) {
      await client.query('ROLLBACK');

      this.logger.error(
        `Migration ${migration.name} failed: ${error.message}`,
      );

      return {
        name: migration.name,
        checksum: migration.checksum,
        executed: false,
        error: error.message,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Ensure platform.migration_state table exists
   */
  private async ensureMigrationStateTable(pool: Pool): Promise<void> {
    // Create platform schema if it doesn't exist
    await pool.query('CREATE SCHEMA IF NOT EXISTS platform');

    // Create migration_state table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS platform.migration_state (
        id SERIAL PRIMARY KEY,
        project_id TEXT NOT NULL,
        migration_name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        executed_at TIMESTAMP NOT NULL DEFAULT now(),
        UNIQUE (project_id, migration_name)
      )
    `);
  }

  /**
   * Get already-applied migrations for a project
   */
  private async getAppliedMigrations(
    pool: Pool,
    projectId: string,
  ): Promise<Array<{ name: string; checksum: string }>> {
    try {
      const result = await pool.query(
        `SELECT migration_name as name, checksum
         FROM platform.migration_state
         WHERE project_id = $1
         ORDER BY executed_at`,
        [projectId],
      );
      return result.rows;
    } catch (error) {
      // Table doesn't exist yet
      if (error.code === '42P01') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get or create pool for project database (with admin privileges)
   * Uses admin DSN per v1-decisions.md §17
   */
  private async getProjectPool(
    projectId: string,
    dbName: string,
  ): Promise<Pool> {
    if (!this.projectPools.has(projectId)) {
      // Use admin DSN with elevated privileges
      const adminDsn = this.configService.get<string>('adminDbDsn');

      if (!adminDsn) {
        throw new Error('ADMIN_DB_DSN not configured');
      }

      // Parse admin DSN and replace database name
      let url: URL;
      try {
        url = new URL(adminDsn);
      } catch (error) {
        throw new Error(`Invalid ADMIN_DB_DSN format: ${error.message}`);
      }
      url.pathname = `/${dbName}`;

      const projectDsn = url.toString();

      this.projectPools.set(
        projectId,
        new Pool({
          connectionString: projectDsn,
          min: 1,
          max: 5,
          connectionTimeoutMillis: 30000,
        }),
      );

      this.logger.log(
        `Created admin connection pool for project ${projectId} (db: ${dbName})`,
      );
    }

    return this.projectPools.get(projectId)!;
  }

  /**
   * Cleanup connection pools (for graceful shutdown)
   */
  async onModuleDestroy() {
    for (const [projectId, pool] of this.projectPools.entries()) {
      await pool.end();
      this.logger.log(`Closed connection pool for project ${projectId}`);
    }
  }
}
