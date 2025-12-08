import { IsString, IsUrl, IsOptional } from 'class-validator';

/**
 * Connection Info DTO
 * Per interfaces.md §5 step 8
 */

export class ConnectionInfoDto {
  @IsString()
  readonly project_id: string;

  @IsString()
  readonly db_uri: string;

  @IsOptional()
  @IsString()
  readonly db_uri_pooler?: string;

  @IsString()
  readonly anon_key: string;

  @IsString()
  readonly service_role_key: string;

  // Base URLs for client consumption (per v1 spec)
  @IsUrl()
  readonly postgrest_url: string;

  @IsUrl()
  readonly auth_url: string;

  @IsUrl()
  readonly storage_url: string;
}
