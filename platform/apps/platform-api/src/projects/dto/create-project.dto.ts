/**
 * Create Project DTO
 */

import { IsString, MinLength, MaxLength, IsOptional, Matches } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[a-z0-9-_]+$/, {
    message: 'Project name must contain only lowercase letters, numbers, hyphens, and underscores',
  })
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(128)
  display_name?: string;
}

export class CreateProjectResponseDto {
  project_id: string;
  name: string;
  display_name: string;
  status: string;
  db_name: string;
  created_at: Date;
}
