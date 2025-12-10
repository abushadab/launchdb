/**
 * Refresh Token DTO
 * Per interfaces.md §3
 */

import { IsString, IsNotEmpty } from 'class-validator';

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refresh_token: string;
}

export class RefreshResponseDto {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
}
