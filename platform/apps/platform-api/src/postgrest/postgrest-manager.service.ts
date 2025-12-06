/**
 * PostgREST Manager Service
 * Client for Sonnet B's PostgREST management API (port 9000)
 * Handles per-project container lifecycle
 */

import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface SpawnResponse {
  containerId: string;
  port: number;
  status: string;
}

export interface DestroyResponse {
  status: string;
}

@Injectable()
export class PostgRestManagerService {
  private readonly logger = new Logger(PostgRestManagerService.name);
  private readonly managerUrl: string;
  private readonly internalApiKey: string;

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    this.managerUrl = this.configService.get<string>('postgrestManagerUrl') || 'http://postgrest-manager:9000';
    this.internalApiKey = this.configService.get<string>('internalApiKey');

    if (!this.internalApiKey) {
      throw new Error('internalApiKey configuration is required');
    }
  }

  /**
   * Spawn per-project PostgREST container
   * POST /internal/postgrest/spawn
   * Manager will add PgBouncer database/user entries using authenticatorPassword
   */
  async spawnContainer(projectId: string, authenticatorPassword: string): Promise<SpawnResponse> {
    this.logger.log(`Spawning PostgREST container for project ${projectId}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post<SpawnResponse>(
          `${this.managerUrl}/internal/postgrest/spawn`,
          {
            projectId,
            authenticatorPassword, // Manager uses this to configure PgBouncer
          },
          {
            headers: {
              'X-Internal-Key': this.internalApiKey,
              'Content-Type': 'application/json',
            },
            timeout: 30000, // 30 seconds
          },
        ),
      );

      this.logger.log(
        `PostgREST container spawned: ${response.data.containerId} (port ${response.data.port})`,
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to spawn PostgREST container for ${projectId}: ${error.message}`,
      );
      throw new Error(`PostgREST spawn failed: ${error.message}`);
    }
  }

  /**
   * Destroy per-project PostgREST container
   * DELETE /internal/postgrest/{projectId}
   */
  async destroyContainer(projectId: string): Promise<void> {
    this.logger.log(`Destroying PostgREST container for project ${projectId}`);

    try {
      const response = await firstValueFrom(
        this.httpService.delete<DestroyResponse>(
          `${this.managerUrl}/internal/postgrest/${projectId}`,
          {
            headers: {
              'X-Internal-Key': this.internalApiKey,
            },
            timeout: 30000, // 30 seconds
          },
        ),
      );

      this.logger.log(
        `PostgREST container destroyed for ${projectId}: ${response.data.status}`,
      );
    } catch (error) {
      // Treat 404 as non-fatal (container already gone)
      if (error.response?.status === 404) {
        this.logger.warn(
          `PostgREST container not found for ${projectId} (already destroyed)`,
        );
        return;
      }

      this.logger.error(
        `Failed to destroy PostgREST container for ${projectId}: ${error.message}`,
      );
      throw new Error(`PostgREST destroy failed: ${error.message}`);
    }
  }
}
