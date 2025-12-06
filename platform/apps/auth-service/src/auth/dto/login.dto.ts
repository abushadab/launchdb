/**
 * Login DTO
 * Per interfaces.md §3
 */

import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}

export class LoginResponseDto {
  user_id: string;
  email: string;
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
}
