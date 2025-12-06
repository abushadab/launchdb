/**
 * User DTO
 * Per interfaces.md §3
 */

export class UserResponseDto {
  user_id: string;
  email: string;
  created_at: Date;
}

export class LogoutResponseDto {
  message: string;
}
