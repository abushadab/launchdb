/**
 * Signed URL DTOs
 * Per interfaces.md §6
 */

import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class CreateSignedUrlDto {
  @IsString()
  path: string;

  @IsString()
  @IsOptional()
  bucket?: string; // Default: 'default'

  @IsNumber()
  @IsOptional()
  @Min(60)
  @Max(3600)
  expires_in?: number; // seconds, default: 300 (5 minutes)
}

export class SignedUrlResponseDto {
  url: string;
  expires_at: Date;
}

export class DeleteResponseDto {
  message: string;
}
