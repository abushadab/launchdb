/**
 * Refresh Token DTO
 * Per interfaces.md §3
 */

import { IsString } from 'class-validator';

export class RefreshDto {
  @IsString()
  refresh_token: string;
}

export class RefreshResponseDto {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
}
