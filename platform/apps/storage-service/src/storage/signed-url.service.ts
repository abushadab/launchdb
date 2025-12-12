/**
 * Signed URL Service
 * Generate and validate time-limited signed URLs
 * Per interfaces.md §6
 */

import { Injectable, Logger, UnauthorizedException, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenHashService, CryptoService } from '@launchdb/common/crypto';
import { DatabaseService } from '@launchdb/common/database';
import { Pool } from 'pg';

export interface SignedUrlParams {
  projectId: string;
  bucket: string;
  path: string;
  expiresIn: number; // seconds
}

export interface SignedUrlValidation {
  projectId: string;
  bucket: string;
  path: string;
  valid: boolean;
}

@Injectable()
export class SignedUrlService implements OnModuleDestroy {
  private readonly logger = new Logger(SignedUrlService.name);
  private readonly projectPools = new Map<string, Pool>();
  private readonly poolAccessTimes = new Map<string, number>();
  private readonly MAX_POOLS = 100; // LRU eviction limit to prevent unbounded growth

  constructor(
    private configService: ConfigService,
    private tokenHashService: TokenHashService,
    private cryptoService: CryptoService,
    private databaseService: DatabaseService,
  ) {}

  /**
   * Generate signed URL
   */
  async generateSignedUrl(params: SignedUrlParams): Promise<string> {
    const { projectId, bucket, path: filePath, expiresIn } = params;

    // Validate baseUrl before persisting token (fail-fast)
    const baseUrl = this.configService.get<string>('baseUrl');
    if (!baseUrl) {
      throw new Error('baseUrl configuration is required for signed URLs');
    }

    // Generate random token
    const token = this.tokenHashService.generateToken();
    const tokenHash = this.tokenHashService.hash(token);

    // Calculate expiry
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Store token in database
    const pool = await this.getProjectPool(projectId);
    await pool.query(
      `INSERT INTO storage.signed_urls (token_hash, bucket, path, expires_at, created_at)
       VALUES ($1, $2, $3, $4, now())`,
      [tokenHash, bucket, filePath, expiresAt],
    );

    // Build signed URL
    const signedUrl = `${baseUrl}/storage/${projectId}/${bucket}/${filePath}?token=${token}`;

    this.logger.debug(
      `Generated signed URL for ${projectId}/${bucket}/${filePath}, expires at ${expiresAt.toISOString()}`,
    );

    return signedUrl;
  }

  /**
   * Validate signed URL token
   */
  async validateSignedUrl(
    projectId: string,
    bucket: string,
    path: string,
    token: string,
  ): Promise<SignedUrlValidation> {
    const tokenHash = this.tokenHashService.hash(token);

    try {
      const pool = await this.getProjectPool(projectId);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const result = await client.query(
          `SELECT id, bucket, path, expires_at, used
           FROM storage.signed_urls
           WHERE token_hash = $1
             AND bucket = $2
             AND path = $3
             AND expires_at > now()
             AND used = false
           FOR UPDATE`,
          [tokenHash, bucket, path],
        );

        if (result.rows.length === 0) {
          await client.query('ROLLBACK');
          this.logger.warn(
            `Invalid or expired signed URL token for ${projectId}/${bucket}/${path}`,
          );
          return { projectId, bucket, path, valid: false };
        }

        // Mark token as used (one-time use)
        await client.query(
          `UPDATE storage.signed_urls
           SET used = true, used_at = now()
           WHERE id = $1`,
          [result.rows[0].id],
        );

        await client.query('COMMIT');
        return { projectId, bucket, path, valid: true };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      this.logger.error(
        `Failed to validate signed URL for ${projectId}: ${error.message}`,
      );
      return { projectId, bucket, path, valid: false };
    }
  }

  /**
   * Cleanup expired signed URLs (periodic maintenance)
   */
  async cleanupExpiredUrls(projectId: string): Promise<number> {
    const pool = await this.getProjectPool(projectId);

    const result = await pool.query(
      `DELETE FROM storage.signed_urls
       WHERE expires_at < now() - interval '1 day'
       RETURNING id`,
    );

    const deletedCount = result.rowCount;
    this.logger.log(
      `Cleaned up ${deletedCount} expired signed URLs for project ${projectId}`,
    );

    return deletedCount;
  }

  /**
   * Get or create pool for project database
   */
  private async getProjectPool(projectId: string): Promise<Pool> {
    // Update access time for LRU tracking
    this.poolAccessTimes.set(projectId, Date.now());

    if (!this.projectPools.has(projectId)) {
      // Evict LRU pool if at capacity
      if (this.projectPools.size >= this.MAX_POOLS) {
        this.evictLruPool();
      }

      // Get project database info from platform
      const project = await this.databaseService.queryOne(
        'SELECT db_name, status FROM platform.projects WHERE id = $1',
        [projectId],
      );

      if (!project || project.status !== 'active') {
        throw new UnauthorizedException('Project not active');
      }

      // Get db_password from secrets
      const secret = await this.databaseService.queryOne(
        `SELECT encrypted_value FROM platform.secrets
         WHERE project_id = $1 AND secret_type = 'db_password'`,
        [projectId],
      );

      if (!secret) {
        throw new UnauthorizedException('Project configuration unavailable');
      }

      // Decrypt db_password (secret.encrypted_value is already a Buffer)
      const dbPassword = this.cryptoService.decrypt(secret.encrypted_value);

      const host = this.configService.get<string>('projectsDbHost');
      const port = this.configService.get<number>('projectsDbPort');
      const authenticatorRole = `${projectId}_authenticator`;

      // URL-encode password to handle special characters (+/=) from base64
      const encodedPassword = encodeURIComponent(dbPassword);
      const dsn = `postgresql://${authenticatorRole}:${encodedPassword}@${host}:${port}/${project.db_name}`;

      this.projectPools.set(
        projectId,
        new Pool({
          connectionString: dsn,
          min: 2,
          max: 10,
        }),
      );

      this.logger.log(`Created connection pool for project ${projectId}`);
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
    this.projectPools.clear();
    this.poolAccessTimes.clear();
  }

  /**
   * Evict least recently used pool to prevent unbounded growth
   */
  private evictLruPool(): void {
    let lruProjectId: string | null = null;
    let oldestAccessTime = Infinity;

    // Find the least recently used pool
    for (const [projectId, accessTime] of this.poolAccessTimes.entries()) {
      if (accessTime < oldestAccessTime) {
        oldestAccessTime = accessTime;
        lruProjectId = projectId;
      }
    }

    if (lruProjectId) {
      const pool = this.projectPools.get(lruProjectId);
      if (pool) {
        // Close pool gracefully (async, but don't block)
        pool.end().catch((err) => {
          this.logger.error(
            `Error closing pool for project ${lruProjectId}: ${err.message}`,
          );
        });
      }

      this.projectPools.delete(lruProjectId);
      this.poolAccessTimes.delete(lruProjectId);
      this.logger.log(`Evicted LRU pool for project ${lruProjectId}`);
    }
  }
}
