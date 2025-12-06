/**
 * LaunchDB Database Service
 * PostgreSQL connection pooling and query utilities
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult } from 'pg';

export interface ProjectDbConfig {
  projectId: string;
  dbName: string;
  authenticatorRole: string;
  password: string;
  host: string;
  port: number;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private platformPool: Pool;
  private projectPools: Map<string, Pool> = new Map();

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    // Initialize platform DB pool
    const platformDsn = this.configService.get<string>('platformDbDsn');
    if (!platformDsn) {
      throw new Error('platformDbDsn is required');
    }

    this.platformPool = new Pool({
      connectionString: platformDsn,
      min: 5,
      max: 20,
      connectionTimeoutMillis: 60000,
      idleTimeoutMillis: 30000,
    });

    this.logger.log('Platform database pool initialized');
  }

  async onModuleDestroy() {
    // Close all pools
    await this.platformPool?.end();
    for (const [projectId, pool] of this.projectPools.entries()) {
      await pool.end();
      this.logger.log(`Closed pool for project ${projectId}`);
    }
  }

  /**
   * Get platform database pool
   */
  getPlatformPool(): Pool {
    return this.platformPool;
  }

  /**
   * Execute query on platform database
   */
  async query(sql: string, params?: any[]): Promise<QueryResult> {
    return this.platformPool.query(sql, params);
  }

  /**
   * Execute query and return single row
   */
  async queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
    const result = await this.platformPool.query(sql, params);
    return result.rows[0] || null;
  }

  /**
   * Execute query and return all rows
   */
  async queryMany<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const result = await this.platformPool.query(sql, params);
    return result.rows;
  }

  /**
   * Get or create connection pool for a project database
   */
  getProjectPool(config: ProjectDbConfig): Pool {
    if (!this.projectPools.has(config.projectId)) {
      // URL-encode password to handle special characters (+/=) from base64
      const encodedPassword = encodeURIComponent(config.password);
      const dsn = `postgresql://${config.authenticatorRole}:${encodedPassword}@${config.host}:${config.port}/${config.dbName}`;
      const pool = new Pool({
        connectionString: dsn,
        min: 2,
        max: 10,
        connectionTimeoutMillis: 60000,
        idleTimeoutMillis: 30000,
      });

      this.projectPools.set(config.projectId, pool);
      this.logger.log(`Created pool for project ${config.projectId}`);
    }

    return this.projectPools.get(config.projectId)!;
  }

  /**
   * Close project database pool
   */
  async closeProjectPool(projectId: string): Promise<void> {
    const pool = this.projectPools.get(projectId);
    if (pool) {
      await pool.end();
      this.projectPools.delete(projectId);
      this.logger.log(`Closed pool for project ${projectId}`);
    }
  }

  /**
   * Acquire a client from platform pool for transaction
   */
  async acquireClient(): Promise<PoolClient> {
    return this.platformPool.connect();
  }
}
