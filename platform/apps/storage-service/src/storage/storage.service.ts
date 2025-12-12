/**
 * Storage Service
 * Multi-tenant file storage orchestration
 * Per interfaces.md §6
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService, withJwtClaimsTx } from '@launchdb/common/database';
import { CryptoService } from '@launchdb/common/crypto';
import { ERRORS } from '@launchdb/common/errors';
import { DiskStorageService } from './disk-storage.service';
import { SignedUrlService } from './signed-url.service';
import { UploadResponseDto } from './dto/upload.dto';
import { SignedUrlResponseDto } from './dto/signed-url.dto';
import { Readable } from 'stream';
import { Pool } from 'pg';
import { randomBytes } from 'crypto';

@Injectable()
export class StorageService implements OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly projectPools = new Map<string, Pool>();
  private readonly poolAccessTimes = new Map<string, number>();
  private readonly MAX_POOLS = 100; // LRU eviction limit to prevent unbounded growth

  constructor(
    private configService: ConfigService,
    private databaseService: DatabaseService,
    private cryptoService: CryptoService,
    private diskStorageService: DiskStorageService,
    private signedUrlService: SignedUrlService,
  ) {}

  async onModuleDestroy() {
    for (const [projectId, pool] of this.projectPools.entries()) {
      await pool.end();
      this.logger.log(`Closed connection pool for project ${projectId}`);
    }
    this.projectPools.clear();
    this.poolAccessTimes.clear();
  }

  /**
   * Upload file
   */
  async uploadFile(
    projectId: string,
    bucket: string,
    path: string,
    stream: Readable,
    contentType: string,
  ): Promise<UploadResponseDto> {
    this.logger.log(`Upload: ${projectId}/${bucket}/${path}`);

    // Verify project is active
    await this.verifyProjectActive(projectId);

    // Write file to disk
    const metadata = await this.diskStorageService.writeFile(
      projectId,
      bucket,
      path,
      stream,
      contentType,
    );

    // Generate object ID
    const objectId = this.generateObjectId();

    // Store metadata in database (with service_role for RLS bypass)
    const pool = await this.getProjectPool(projectId);
    const actualObjectId = await withJwtClaimsTx(pool, null, async (client) => {
      const result = await client.query(
        `INSERT INTO storage.objects (id, bucket, path, size, content_type, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())
         ON CONFLICT (bucket, path) DO UPDATE
         SET size = EXCLUDED.size,
             content_type = EXCLUDED.content_type,
             updated_at = now()
         RETURNING id`,
        [objectId, bucket, path, metadata.size, metadata.contentType],
      );
      return result.rows[0].id;
    });

    // Build public URL
    const baseUrl = this.configService.get<string>('baseUrl');
    const url = `${baseUrl}/storage/${projectId}/${bucket}/${path}`;

    return {
      object_id: actualObjectId,
      bucket,
      path,
      size: metadata.size,
      content_type: metadata.contentType,
      uploaded_at: new Date(),
      url,
    };
  }

  /**
   * Download file
   */
  async downloadFile(
    projectId: string,
    bucket: string,
    path: string,
  ): Promise<{ stream: Readable; contentType: string; size: number }> {
    this.logger.log(`Download: ${projectId}/${bucket}/${path}`);

    // Verify project is active
    await this.verifyProjectActive(projectId);

    // Check if file exists in database (with service_role for RLS bypass)
    const pool = await this.getProjectPool(projectId);
    const dbMetadata = await withJwtClaimsTx(pool, null, async (client) => {
      const result = await client.query(
        `SELECT id, size, content_type FROM storage.objects
         WHERE bucket = $1 AND path = $2`,
        [bucket, path],
      );

      if (result.rows.length === 0) {
        throw ERRORS.ObjectNotFound(path);
      }
      return result.rows[0];
    });

    // Read file from disk
    const { stream, metadata } = await this.diskStorageService.readFile(
      projectId,
      bucket,
      path,
    );

    return {
      stream,
      contentType: dbMetadata.content_type || metadata.contentType,
      size: dbMetadata.size,
    };
  }

  /**
   * Delete file
   */
  async deleteFile(
    projectId: string,
    bucket: string,
    path: string,
  ): Promise<void> {
    this.logger.log(`Delete: ${projectId}/${bucket}/${path}`);

    // Verify project is active
    await this.verifyProjectActive(projectId);

    // Delete from disk
    await this.diskStorageService.deleteFile(projectId, bucket, path);

    // Delete from database (with service_role for RLS bypass)
    const pool = await this.getProjectPool(projectId);
    await withJwtClaimsTx(pool, null, async (client) => {
      await client.query(
        `DELETE FROM storage.objects WHERE bucket = $1 AND path = $2`,
        [bucket, path],
      );
    });
  }

  /**
   * Create signed URL
   */
  async createSignedUrl(
    projectId: string,
    bucket: string,
    path: string,
    expiresIn: number,
  ): Promise<SignedUrlResponseDto> {
    this.logger.log(`Create signed URL: ${projectId}/${bucket}/${path}`);

    // Verify project is active
    await this.verifyProjectActive(projectId);

    // Check if file exists
    const exists = await this.diskStorageService.fileExists(projectId, bucket, path);
    if (!exists) {
      throw ERRORS.ObjectNotFound(path);
    }

    // Generate signed URL
    const url = await this.signedUrlService.generateSignedUrl({
      projectId,
      bucket,
      path,
      expiresIn,
    });

    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    return { url, expires_at: expiresAt };
  }

  /**
   * Validate and download file with signed URL
   */
  async downloadWithSignedUrl(
    projectId: string,
    bucket: string,
    path: string,
    token: string,
  ): Promise<{ stream: Readable; contentType: string; size: number }> {
    // Validate token
    const validation = await this.signedUrlService.validateSignedUrl(
      projectId,
      bucket,
      path,
      token,
    );

    if (!validation.valid) {
      throw ERRORS.SignedUrlExpired();
    }

    // Download file (no project active check needed - token is already validated)
    const { stream, metadata } = await this.diskStorageService.readFile(
      projectId,
      bucket,
      path,
    );

    return {
      stream,
      contentType: metadata.contentType,
      size: metadata.size,
    };
  }

  /**
   * Verify project is active
   */
  private async verifyProjectActive(projectId: string): Promise<void> {
    const project = await this.databaseService.queryOne(
      'SELECT status FROM platform.projects WHERE id = $1',
      [projectId],
    );

    if (!project) {
      throw ERRORS.ProjectNotFound(projectId);
    }

    if (project.status !== 'active') {
      throw ERRORS.ValidationError('Project not active', projectId);
    }
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

      const project = await this.databaseService.queryOne(
        'SELECT db_name FROM platform.projects WHERE id = $1',
        [projectId],
      );

      if (!project) {
        throw ERRORS.ProjectNotFound(projectId);
      }

      // Get encrypted db_password
      const secret = await this.databaseService.queryOne(
        `SELECT encrypted_value FROM platform.secrets
         WHERE project_id = $1 AND secret_type = 'db_password'`,
        [projectId],
      );

      if (!secret) {
        throw ERRORS.InternalError('Project database password not found');
      }

      // secret.encrypted_value is already a Buffer (bytea from Postgres)
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
   * Generate object ID (UUID format)
   */
  private generateObjectId(): string {
    const bytes = randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10

    return [
      bytes.slice(0, 4).toString('hex'),
      bytes.slice(4, 6).toString('hex'),
      bytes.slice(6, 8).toString('hex'),
      bytes.slice(8, 10).toString('hex'),
      bytes.slice(10, 16).toString('hex'),
    ].join('-');
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
