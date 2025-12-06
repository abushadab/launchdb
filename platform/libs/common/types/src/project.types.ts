/**
 * LaunchDB Project Types
 * Common types for project management
 */

export enum ProjectStatus {
  PROVISIONING = 'provisioning',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DELETED = 'deleted',
}

export interface Project {
  id: string;
  owner_id: string;
  name: string;
  display_name: string;
  db_name: string;
  status: ProjectStatus;
  created_at: Date;
  updated_at: Date;
}

export interface ProjectSecret {
  project_id: string;
  secret_type: string;
  encrypted_value: Buffer;
  created_at: Date;
}

export interface ConnectionInfo {
  project_id: string;
  db_uri: string;
  db_uri_pooler?: string;
  anon_key: string;
  service_role_key: string;
}
