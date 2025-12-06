/**
 * Project Configuration Cache Service
 * Per interfaces.md §4 and v1-decisions.md §14
 * - 5-minute TTL cache
 * - Fail-closed design (deny on error)
 */

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { DatabaseService } from '@launchdb/common/database';
import { CryptoService } from '@launchdb/common/crypto';

export interface ProjectConfig {
  projectId: string;
  dbName: string;
  jwtSecret: string;
  dbPassword: string;
  status: string;
  cachedAt: number;
}

@Injectable()
export class ProjectConfigService {
  private readonly logger = new Logger(ProjectConfigService.name);
  private readonly cache = new Map<string, ProjectConfig>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private databaseService: DatabaseService,
    private cryptoService: CryptoService,
  ) {}

  /**
   * Get project configuration (cached)
   * Fail-closed: throws UnauthorizedException on any error
   */
  async getProjectConfig(projectId: string): Promise<ProjectConfig> {
    // Check cache
    const cached = this.cache.get(projectId);
    if (cached && this.isCacheValid(cached)) {
      this.logger.debug(`Cache hit for project ${projectId}`);
      return cached;
    }

    // Cache miss or expired - fetch from database
    this.logger.debug(`Cache miss for project ${projectId}, fetching from DB`);

    try {
      const config = await this.fetchProjectConfig(projectId);

      // Store in cache
      this.cache.set(projectId, {
        ...config,
        cachedAt: Date.now(),
      });

      return config;
    } catch (error) {
      this.logger.error(`Failed to fetch config for project ${projectId}`, error.stack);
      // Fail-closed: deny access if config unavailable
      throw new UnauthorizedException('Project configuration unavailable');
    }
  }

  /**
   * Invalidate cache for a project (called on project updates/deletion)
   */
  invalidateProject(projectId: string): void {
    this.cache.delete(projectId);
    this.logger.log(`Cache invalidated for project ${projectId}`);
  }

  /**
   * Clear all cache (for testing or maintenance)
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.log('All project config cache cleared');
  }

  /**
   * Fetch project configuration from platform database
   */
  private async fetchProjectConfig(projectId: string): Promise<ProjectConfig> {
    // Validate project ID format (prevent SQL injection)
    if (!/^proj_[a-z0-9]{16}$/.test(projectId)) {
      throw new Error('Invalid project ID format');
    }

    // Get project details
    const project = await this.databaseService.queryOne(
      `SELECT id, db_name, status
       FROM platform.projects
       WHERE id = $1`,
      [projectId],
    );

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // Only allow active projects
    if (project.status !== 'active') {
      throw new Error(`Project not active: ${projectId} (status: ${project.status})`);
    }

    // Get encrypted secrets
    const secrets = await this.databaseService.queryMany(
      `SELECT secret_type, encrypted_value
       FROM platform.secrets
       WHERE project_id = $1`,
      [projectId],
    );

    if (secrets.length === 0) {
      throw new Error(`No secrets found for project ${projectId}`);
    }

    // Decrypt secrets
    const secretsMap = new Map<string, string>();
    for (const secret of secrets) {
      try {
        // secret.encrypted_value is already a Buffer (bytea from Postgres)
        const decrypted = this.cryptoService.decrypt(secret.encrypted_value);
        secretsMap.set(secret.secret_type, decrypted);
      } catch (error) {
        throw new Error(`Failed to decrypt ${secret.secret_type} for ${projectId}`);
      }
    }

    // Ensure required secrets exist
    const jwtSecret = secretsMap.get('jwt_secret');
    const dbPassword = secretsMap.get('db_password');

    if (!jwtSecret || !dbPassword) {
      throw new Error(`Missing required secrets for project ${projectId}`);
    }

    return {
      projectId: project.id,
      dbName: project.db_name,
      jwtSecret,
      dbPassword,
      status: project.status,
      cachedAt: Date.now(),
    };
  }

  /**
   * Check if cached config is still valid (within TTL)
   */
  private isCacheValid(config: ProjectConfig): boolean {
    const age = Date.now() - config.cachedAt;
    return age < this.CACHE_TTL_MS;
  }
}
