/**
 * Owner Login DTO
 */

import { IsEmail, IsString } from 'class-validator';

export class LoginOwnerDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}

export class LoginOwnerResponseDto {
  access_token: string;
  token_type: string;
  expires_in: number;
}
