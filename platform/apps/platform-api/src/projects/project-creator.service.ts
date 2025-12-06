/**
 * LaunchDB Project Creator Service
 * 8-step project creation orchestration per interfaces.md §5
 */

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService, ProjectDatabaseService } from '@launchdb/common/database';
import { CryptoService } from '@launchdb/common/crypto';
import { JwtService, JwtRole } from '@launchdb/common/jwt';
import { ProjectStatus } from '@launchdb/common/types';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import axios from 'axios';
import { PostgRestService } from '../postgrest/postgrest.service';
import { PostgRestManagerService } from '../postgrest/postgrest-manager.service';

export interface ProjectCreationResult {
  projectId: string;
  dbName: string;
  status: ProjectStatus;
}

@Injectable()
export class ProjectCreatorService {
  private readonly logger = new Logger(ProjectCreatorService.name);
  private readonly migrationsRunnerUrl: string;
  private readonly internalApiKey: string;

  constructor(
    private databaseService: DatabaseService,
    private projectDatabaseService: ProjectDatabaseService,
    private cryptoService: CryptoService,
    private jwtService: JwtService,
    private configService: ConfigService,
    @Inject(forwardRef(() => PostgRestService))
    private postgrestService: PostgRestService,
    private postgrestManagerService: PostgRestManagerService,
  ) {
    this.migrationsRunnerUrl = this.configService.get<string>('migrationsRunnerUrl');
    this.internalApiKey = this.configService.get<string>('internalApiKey');

    if (!this.migrationsRunnerUrl) {
      throw new Error('migrationsRunnerUrl configuration is required');
    }
    if (!this.internalApiKey) {
      throw new Error('internalApiKey configuration is required');
    }
  }

  /**
   * Create a new project with full 8-step flow
   * Per interfaces.md §5
   */
  async createProject(
    ownerId: string,
    name: string,
    displayName: string,
  ): Promise<ProjectCreationResult> {
    const projectId = this.generateProjectId();
    this.logger.log(`Starting project creation: ${projectId}`);

    try {
      // Step 1: Create platform.projects row (status='provisioning')
      await this.step1CreateProjectRow(projectId, ownerId, name, displayName);

      // Step 2: Create project database + roles
      const dbInfo = await this.step2CreateProjectDatabase(projectId);

      // Step 3: Generate secrets (JWT secret, DB password, API keys)
      const secrets = await this.step3GenerateSecrets(projectId, dbInfo.dbPassword);

      // Step 4: Store encrypted secrets
      await this.step4StoreSecrets(projectId, secrets);

      // Step 5: Trigger migrations (auth.*, storage.* schemas)
      await this.step5TriggerMigrations(projectId);

      // Step 6: Update status to 'active'
      await this.step6UpdateStatus(projectId, ProjectStatus.ACTIVE);

      // Step 7: Generate PostgREST config + SIGHUP
      await this.step7GeneratePostgRESTConfig(projectId, secrets, dbInfo);

      // Step 8: Return project info (lazy auth/storage service pickup)
      this.logger.log(`Project created successfully: ${projectId}`);

      return {
        projectId,
        dbName: dbInfo.dbName,
        status: ProjectStatus.ACTIVE,
      };
    } catch (error) {
      this.logger.error(`Project creation failed: ${error.message}`, error.stack);

      // Mark project as failed
      await this.databaseService.query(
        'UPDATE platform.projects SET status = $1 WHERE id = $2',
        ['failed', projectId],
      );

      throw error;
    }
  }

  /**
   * Step 1: Create platform.projects row
   */
  private async step1CreateProjectRow(
    projectId: string,
    ownerId: string,
    name: string,
    displayName: string,
  ): Promise<void> {
    this.logger.log(`Step 1: Creating project row for ${projectId}`);

    await this.databaseService.query(
      `INSERT INTO platform.projects (id, owner_id, name, display_name, db_name, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [projectId, ownerId, name, displayName || name, projectId, ProjectStatus.PROVISIONING],
    );
  }

  /**
   * Step 2: Create project database + roles
   */
  private async step2CreateProjectDatabase(projectId: string) {
    this.logger.log(`Step 2: Creating project database for ${projectId}`);

    const dbPassword = this.generateSecurePassword();
    const dbInfo = await this.projectDatabaseService.createProjectDatabase(
      projectId,
      dbPassword,
    );

    return { ...dbInfo, dbPassword };
  }

  /**
   * Step 3: Generate secrets
   */
  private async step3GenerateSecrets(projectId: string, dbPassword: string) {
    this.logger.log(`Step 3: Generating secrets for ${projectId}`);

    const jwtSecret = this.generateSecureSecret();
    const anonKey = this.generateAPIKey(projectId, JwtRole.ANON, jwtSecret);
    const serviceRoleKey = this.generateAPIKey(projectId, JwtRole.SERVICE_ROLE, jwtSecret);

    return {
      jwtSecret,
      anonKey,
      serviceRoleKey,
      dbPassword, // Include db_password for storage
    };
  }

  /**
   * Step 4: Store encrypted secrets
   */
  private async step4StoreSecrets(
    projectId: string,
    secrets: { jwtSecret: string; anonKey: string; serviceRoleKey: string; dbPassword: string },
  ): Promise<void> {
    this.logger.log(`Step 4: Storing encrypted secrets for ${projectId}`);

    const secretsToStore = [
      { type: 'jwt_secret', value: secrets.jwtSecret },
      { type: 'anon_key', value: secrets.anonKey },
      { type: 'service_role_key', value: secrets.serviceRoleKey },
      { type: 'db_password', value: secrets.dbPassword },
    ];

    for (const secret of secretsToStore) {
      const encrypted = this.cryptoService.encrypt(secret.value);

      await this.databaseService.query(
        `INSERT INTO platform.secrets (project_id, secret_type, encrypted_value)
         VALUES ($1, $2, $3)`,
        [projectId, secret.type, encrypted],
      );
    }
  }

  /**
   * Step 5: Trigger migrations via migrations-runner
   */
  private async step5TriggerMigrations(projectId: string): Promise<void> {
    this.logger.log(`Step 5: Triggering migrations for ${projectId}`);

    try {
      const response = await axios.post(
        `${this.migrationsRunnerUrl}/internal/migrations/run`,
        { project_id: projectId },
        { headers: { 'x-internal-api-key': this.internalApiKey } },
      );

      this.logger.log(`Migrations completed: ${JSON.stringify(response.data.summary)}`);
    } catch (error) {
      this.logger.error(`Migrations failed: ${error.message}`);
      throw new Error(`Migrations failed: ${error.response?.data?.detail || error.message}`);
    }
  }

  /**
   * Step 6: Update project status to active
   */
  private async step6UpdateStatus(
    projectId: string,
    status: ProjectStatus,
  ): Promise<void> {
    this.logger.log(`Step 6: Updating project status to ${status}`);

    await this.databaseService.query(
      'UPDATE platform.projects SET status = $1, updated_at = now() WHERE id = $2',
      [status, projectId],
    );
  }

  /**
   * Step 7: Generate PostgREST config + spawn container
   */
  private async step7GeneratePostgRESTConfig(
    projectId: string,
    secrets: any,
    dbInfo: any,
  ): Promise<void> {
    this.logger.log(`Step 7: PostgREST config generation and container spawn for ${projectId}`);

    // Generate PostgREST config file
    await this.postgrestService.generateConfig(projectId);

    // Spawn per-project PostgREST container
    // Manager will add PgBouncer database/user entries using dbPassword
    try {
      await this.postgrestManagerService.spawnContainer(projectId, secrets.dbPassword);
      this.logger.log(`Step 7 complete: PostgREST container spawned for ${projectId}`);
    } catch (error) {
      // Mark project as 'failed' (no rollback per Codex guidance)
      await this.databaseService.query(
        `UPDATE platform.projects SET status = $1, updated_at = now() WHERE id = $2`,
        ['failed', projectId],
      );

      this.logger.error(
        `PostgREST spawn failed for ${projectId}: ${error.message}`,
      );

      throw new Error(`Failed to spawn PostgREST container: ${error.message}`);
    }
  }

  /**
   * Generate project ID (proj_<16 hex chars>)
   */
  private generateProjectId(): string {
    return `proj_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Generate secure password (32 bytes, base64)
   */
  private generateSecurePassword(): string {
    return crypto.randomBytes(32).toString('base64');
  }

  /**
   * Generate secure secret (64 bytes, base64)
   */
  private generateSecureSecret(): string {
    return crypto.randomBytes(64).toString('base64');
  }

  /**
   * Generate API key (JWT with very long expiry)
   * Per interfaces.md §1
   */
  private generateAPIKey(
    projectId: string,
    role: JwtRole,
    jwtSecret: string,
  ): string {
    // API keys are JWTs with 10-year expiry
    const claims = {
      sub: 'api-key',
      role,
      project_id: projectId,
      aud: 'authenticated',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 315360000, // 10 years
    };

    return this.jwtService.encode(claims, jwtSecret);
  }
}
