/**
 * Connection Info DTO
 * Per interfaces.md §5 step 8
 */

export class ConnectionInfoDto {
  project_id: string;
  db_uri: string;
  db_uri_pooler?: string;
  anon_key: string;
  service_role_key: string;
  // Base URLs for client consumption (per v1 spec)
  postgrest_url: string;
  auth_url: string;
  storage_url: string;
}
