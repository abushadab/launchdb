/**
 * LaunchDB PostgREST Service
 * PostgREST config generation and SIGHUP reload
 * Per interfaces.md §2
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '@launchdb/common/database';
import { CryptoService } from '@launchdb/common/crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class PostgRestService {
  private readonly logger = new Logger(PostgRestService.name);
  private readonly postgrestConfigDir: string;
  private readonly projectsDbHost: string;
  private readonly projectsDbPort: number;

  constructor(
    private databaseService: DatabaseService,
    private cryptoService: CryptoService,
    private configService: ConfigService,
  ) {
    this.postgrestConfigDir = this.configService.get<string>('postgrestConfigDir');
    this.projectsDbHost = this.configService.get<string>('projectsDbHost');
    this.projectsDbPort = this.configService.get<number>('projectsDbPort');
  }

  /**
   * Generate PostgREST config file for a project
   * Per interfaces.md §2 and nestjs-plan.md Section 5
   */
  async generateConfig(projectId: string): Promise<void> {
    this.logger.log(`Generating PostgREST config for ${projectId}`);

    // Fetch project info
    const project = await this.databaseService.queryOne(
      'SELECT id, db_name, status FROM platform.projects WHERE id = $1',
      [projectId],
    );

    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // Fetch and decrypt secrets
    const jwtSecret = await this.getDecryptedSecret(projectId, 'jwt_secret');
    const dbPassword = await this.getDecryptedSecret(projectId, 'db_password');

    // Build config content
    const configContent = this.buildConfigFile({
      projectId,
      dbName: project.db_name,
      authenticatorRole: `${projectId}_authenticator`,
      dbPassword,
      jwtSecret,
      host: this.projectsDbHost,
      port: this.projectsDbPort,
    });

    // Write config file with restrictive permissions (owner read/write only)
    const configPath = path.join(this.postgrestConfigDir, `${projectId}.conf`);
    await fs.writeFile(configPath, configContent, { encoding: 'utf8', mode: 0o600 });

    this.logger.log(`PostgREST config written: ${configPath}`);
  }

  // Note: reloadPostgRest() removed - per-project containers managed by PostgREST Manager API
  // Use PostgRestManagerService.spawnContainer() / .destroyContainer() instead

  /**
   * Get decrypted secret from platform.secrets
   */
  private async getDecryptedSecret(
    projectId: string,
    secretType: string,
  ): Promise<string> {
    const row = await this.databaseService.queryOne(
      'SELECT encrypted_value FROM platform.secrets WHERE project_id = $1 AND secret_type = $2',
      [projectId, secretType],
    );

    if (!row) {
      throw new Error(`Secret not found: ${secretType} for project ${projectId}`);
    }

    return this.cryptoService.decrypt(row.encrypted_value);
  }

  /**
   * Build PostgREST config file content
   * Per interfaces.md §2
   */
  private buildConfigFile(config: {
    projectId: string;
    dbName: string;
    authenticatorRole: string;
    dbPassword: string;
    jwtSecret: string;
    host: string;
    port: number;
  }): string {
    // URL-encode password to handle special characters (+/=) from base64
    const encodedPassword = encodeURIComponent(config.dbPassword);

    // Escape quotes in JWT secret to prevent config corruption
    const escapedJwtSecret = config.jwtSecret.replace(/"/g, '\\"');

    return `# PostgREST config for ${config.projectId}
db-uri = "postgres://${config.authenticatorRole}:${encodedPassword}@${config.host}:${config.port}/${config.dbName}"
db-schemas = "public,storage"
db-anon-role = "anon"
db-pool = 10
db-pool-timeout = 10

# Disable prepared statements for PgBouncer transaction pooling compatibility
# PgBouncer in transaction mode reuses connections across transactions
# Prepared statements would persist and cause "already exists" errors (42P05)
db-prepared-statements = false

jwt-secret = "${escapedJwtSecret}"
jwt-aud = "authenticated"

max-rows = 1000
db-tx-end = "commit"
`;
  }

  /**
   * Delete PostgREST config for a project
   * Per nestjs-plan.md Section 9 (Project Deletion)
   */
  async deleteConfig(projectId: string): Promise<void> {
    const configPath = path.join(this.postgrestConfigDir, `${projectId}.conf`);

    try {
      await fs.unlink(configPath);
      this.logger.log(`Deleted PostgREST config: ${configPath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error(`Failed to delete config: ${error.message}`);
        throw error;
      }
    }
  }
}
