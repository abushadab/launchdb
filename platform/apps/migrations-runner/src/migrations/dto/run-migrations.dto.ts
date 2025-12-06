/**
 * Run Migrations DTOs
 * Per interfaces.md §5 (internal endpoint)
 */

import { IsString } from 'class-validator';

export class RunMigrationsDto {
  @IsString()
  project_id: string;
}

export class MigrationResult {
  name: string;
  checksum: string;
  executed: boolean;
  duration_ms?: number;
  error?: string;
}

export class RunMigrationsResponseDto {
  project_id: string;
  migrations_applied: number;
  migrations_skipped: number;
  total_duration_ms: number;
  results: MigrationResult[];
  status: 'success' | 'partial' | 'failed';
}
