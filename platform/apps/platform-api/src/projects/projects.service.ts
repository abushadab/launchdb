/**
 * LaunchDB Projects Service
 * Project CRUD operations and orchestration
 */

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@launchdb/common/database';
import { CryptoService } from '@launchdb/common/crypto';
import { ERRORS } from '@launchdb/common/errors';
import { ProjectCreatorService } from './project-creator.service';
import { PostgRestService } from '../postgrest/postgrest.service';
import { PostgRestManagerService } from '../postgrest/postgrest-manager.service';
import { CreateProjectDto, CreateProjectResponseDto } from './dto/create-project.dto';
import { ConnectionInfoDto } from './dto/connection-info.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private databaseService: DatabaseService,
    private cryptoService: CryptoService,
    private projectCreatorService: ProjectCreatorService,
    private postgrestService: PostgRestService,
    private postgrestManagerService: PostgRestManagerService,
    private configService: ConfigService,
  ) {}

  /**
   * Create a new project
   * Orchestrates 8-step creation flow
   */
  async createProject(
    ownerId: string,
    dto: CreateProjectDto,
  ): Promise<CreateProjectResponseDto> {
    this.logger.log(`Creating project for owner ${ownerId}`);

    // Execute 8-step creation (includes PostgREST config generation in step 7)
    const result = await this.projectCreatorService.createProject(
      ownerId,
      dto.name,
      dto.display_name || dto.name,
    );

    // Fetch final project data
    const project = await this.databaseService.queryOne(
      `SELECT id, name, display_name, db_name, status, created_at
       FROM platform.projects
       WHERE id = $1`,
      [result.projectId],
    );

    return {
      project_id: project.id,
      name: project.name,
      display_name: project.display_name,
      status: project.status,
      db_name: project.db_name,
      created_at: project.created_at,
    };
  }

  /**
   * Get project by ID
   * Verify owner access
   */
  async getProject(projectId: string, ownerId: string) {
    const project = await this.databaseService.queryOne(
      `SELECT id, owner_id, name, display_name, db_name, status, created_at, updated_at
       FROM platform.projects
       WHERE id = $1`,
      [projectId],
    );

    if (!project) {
      throw ERRORS.ProjectNotFound(projectId);
    }

    if (project.owner_id !== ownerId) {
      throw ERRORS.AccessDenied(projectId);
    }

    return project;
  }

  /**
   * List projects for owner
   */
  async listProjects(ownerId: string) {
    const projects = await this.databaseService.queryMany(
      `SELECT id, name, display_name, db_name, status, created_at, updated_at
       FROM platform.projects
       WHERE owner_id = $1
       ORDER BY created_at DESC`,
      [ownerId],
    );

    return { projects };
  }

  /**
   * Get project connection info
   * Per interfaces.md §5 step 8
   */
  async getConnectionInfo(projectId: string, ownerId: string): Promise<ConnectionInfoDto> {
    // Verify ownership
    await this.getProject(projectId, ownerId);

    // Get project details
    const project = await this.databaseService.queryOne(
      'SELECT db_name FROM platform.projects WHERE id = $1',
      [projectId],
    );

    // Get decrypted secrets
    const anonKey = await this.getDecryptedSecret(projectId, 'anon_key');
    const serviceRoleKey = await this.getDecryptedSecret(projectId, 'service_role_key');
    const dbPassword = await this.getDecryptedSecret(projectId, 'db_password');

    // Build connection URIs
    const dbHost = this.configService.get<string>('projectsDbHost');
    const dbPort = this.configService.get<number>('projectsDbPort');
    const authenticatorRole = `${projectId}_authenticator`;

    // URL-encode password to handle special characters (+/=) from base64
    const encodedPassword = encodeURIComponent(dbPassword);
    const dbUri = `postgresql://${authenticatorRole}:${encodedPassword}@${dbHost}:${dbPort}/${project.db_name}`;

    // Get service base URLs from config
    const postgrestUrl = this.configService.get<string>('postgrestUrl');
    const authServiceUrl = this.configService.get<string>('authServiceUrl');
    const storageServiceUrl = this.configService.get<string>('storageServiceUrl');

    return {
      project_id: projectId,
      db_uri: dbUri,
      db_uri_pooler: dbUri, // Same for now (PgBouncer)
      anon_key: anonKey,
      service_role_key: serviceRoleKey,
      postgrest_url: postgrestUrl,
      auth_url: `${authServiceUrl}/auth/${projectId}`,
      storage_url: `${storageServiceUrl}/storage/${projectId}`,
    };
  }

  /**
   * Delete project
   * Per nestjs-plan.md Section 9
   */
  async deleteProject(projectId: string, ownerId: string): Promise<void> {
    // Verify ownership
    await this.getProject(projectId, ownerId);

    this.logger.log(`Deleting project ${projectId}`);

    // Per nestjs-plan.md Section 9: 8-step project deletion flow

    // 1. Mark as deleted (soft delete)
    await this.databaseService.query(
      'UPDATE platform.projects SET status = $1, updated_at = now() WHERE id = $2',
      ['deleted', projectId],
    );
    this.logger.log(`Step 1: Project ${projectId} marked as deleted`);

    // 2. Revoke API keys
    // TODO: v1.1 - Implement when api_keys table is added
    // await this.databaseService.query('DELETE FROM platform.api_keys WHERE project_id = $1', [projectId]);
    this.logger.log(`Step 2: API key revocation (deferred to v1.1)`);

    // 3. Invalidate caches (auth/storage services)
    // TODO: v1.1 - Call cache invalidation endpoint on auth/storage services
    // await axios.post(`${authServiceUrl}/internal/cache/invalidate/${projectId}`, ...);
    // await axios.post(`${storageServiceUrl}/internal/cache/invalidate/${projectId}`, ...);
    this.logger.log(`Step 3: Cache invalidation (deferred to v1.1)`);

    // 4. Delete storage files
    // TODO: v1.1 - Implement when storage service is complete
    // await axios.delete(`${storageServiceUrl}/internal/projects/${projectId}/files`, ...);
    this.logger.log(`Step 4: Storage file deletion (deferred to v1.1)`);

    // 5. Destroy PostgREST container
    try {
      await this.postgrestManagerService.destroyContainer(projectId);
      this.logger.log(`Step 5: PostgREST container destroyed`);
    } catch (error) {
      // Non-fatal error (per Codex guidance - 404 is handled in manager service)
      this.logger.warn(`Step 5: PostgREST container destroy warning: ${error.message}`);
    }

    // 6. Delete PostgREST config
    await this.postgrestService.deleteConfig(projectId);
    this.logger.log(`Step 6: PostgREST config deleted`);

    // 7. Drop database + roles
    // TODO: v1.1 - Async job or immediate deletion decision needed
    // For now, database is left in place (can be cleaned up manually or via cron)
    // await this.projectDatabaseService.dropProjectDatabase(projectId);
    this.logger.log(`Step 7: Database/role cleanup (deferred to v1.1 - manual cleanup required)`);

    // 8. Delete secrets
    await this.databaseService.query(
      'DELETE FROM platform.secrets WHERE project_id = $1',
      [projectId],
    );
    this.logger.log(`Step 8: Secrets deleted`);

    this.logger.log(`Project deletion complete (soft delete): ${projectId}`);
  }

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
      throw ERRORS.InternalError(`Secret not found: ${secretType}`);
    }

    return this.cryptoService.decrypt(row.encrypted_value);
  }
}
