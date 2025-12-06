/**
 * Owner Signup DTO
 */

import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class SignupOwnerDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}

export class SignupOwnerResponseDto {
  owner_id: string;
  email: string;
  created_at: Date;
}
