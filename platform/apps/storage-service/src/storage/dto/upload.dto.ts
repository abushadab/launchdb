/**
 * Upload DTOs
 * Per interfaces.md §6
 */

import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UploadQueryDto {
  @IsString()
  @IsOptional()
  bucket?: string; // Default: 'default'
}

export class UploadResponseDto {
  object_id: string;
  bucket: string;
  path: string;
  size: number;
  content_type: string;
  uploaded_at: Date;
  url: string; // Public access URL
}
