/**
 * Create Project DTO
 */

import { IsString, MinLength, MaxLength, IsOptional } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
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
