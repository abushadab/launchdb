/**
 * Signup DTO
 * Per interfaces.md §3
 */

import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class SignupDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  password: string;
}

export class SignupResponseDto {
  user_id: string;
  email: string;
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
}
