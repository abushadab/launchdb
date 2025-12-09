-- LaunchDB Platform Schema Init Script
-- This runs automatically when PostgreSQL container is first initialized
-- File is executed from /docker-entrypoint-initdb.d/

-- Note: Database 'platform' is created via POSTGRES_DB environment variable
-- This script runs after the database is created

-- Create platform schema
CREATE SCHEMA IF NOT EXISTS platform;

-- Create pgbouncer schema for auth_query
CREATE SCHEMA IF NOT EXISTS pgbouncer;

-- Owners table (dashboard admins/builders)
CREATE TABLE platform.owners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,  -- argon2id hash
    name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted'))
);

CREATE INDEX idx_owners_email ON platform.owners(email);
CREATE INDEX idx_owners_status ON platform.owners(status);

-- Projects table (registry of all project databases)
CREATE TABLE platform.projects (
    id TEXT PRIMARY KEY,  -- e.g., 'proj_abc123'
    name TEXT NOT NULL,
    display_name TEXT,  -- User-friendly display name for the project
    owner_id UUID NOT NULL REFERENCES platform.owners(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'provisioning'
        CHECK (status IN ('provisioning', 'active', 'suspended', 'failed', 'deleted')),
    region TEXT NOT NULL DEFAULT 'default',
    db_name TEXT NOT NULL UNIQUE,  -- matches project database name
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_projects_owner_id ON platform.projects(owner_id);
CREATE INDEX idx_projects_status ON platform.projects(status);
CREATE INDEX idx_projects_created_at ON platform.projects(created_at DESC);

-- Secrets table (encrypted storage for JWT secrets, DB passwords, API keys)
CREATE TABLE platform.secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL REFERENCES platform.projects(id) ON DELETE CASCADE,
    secret_type TEXT NOT NULL,  -- 'jwt_secret', 'db_password', 'api_key_public', 'api_key_secret'
    encrypted_value BYTEA NOT NULL,
    key_version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    UNIQUE(project_id, secret_type, key_version)
);

CREATE INDEX idx_secrets_project_id ON platform.secrets(project_id);
CREATE INDEX idx_secrets_lookup ON platform.secrets(project_id, secret_type, key_version DESC);

-- Migration state tracking (per project)
CREATE TABLE platform.migration_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL REFERENCES platform.projects(id) ON DELETE CASCADE,
    migration_name TEXT NOT NULL,  -- e.g., '001_auth_schema', '002_storage_schema'
    schema_name TEXT NOT NULL,  -- 'auth' or 'storage'
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    checksum TEXT NOT NULL,  -- SHA-256 of migration SQL
    execution_time_ms INT,
    UNIQUE(project_id, migration_name)
);

CREATE INDEX idx_migration_state_project_id ON platform.migration_state(project_id);
CREATE INDEX idx_migration_state_applied_at ON platform.migration_state(applied_at DESC);

-- API keys tracking (separate from secrets for better management)
CREATE TABLE platform.api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL REFERENCES platform.projects(id) ON DELETE CASCADE,
    key_type TEXT NOT NULL CHECK (key_type IN ('anon', 'service_role')),
    public_key TEXT NOT NULL UNIQUE,  -- e.g., 'pk_proj_abc123_anon_xxx'
    secret_id UUID NOT NULL REFERENCES platform.secrets(id),  -- points to encrypted secret
    scopes JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    UNIQUE(project_id, key_type)
);

CREATE INDEX idx_api_keys_project_id ON platform.api_keys(project_id);
CREATE INDEX idx_api_keys_public_key ON platform.api_keys(public_key);

-- Audit log for important platform operations
CREATE TABLE platform.audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_type TEXT NOT NULL CHECK (actor_type IN ('owner', 'system', 'service')),
    actor_id TEXT,  -- owner UUID or service name
    action TEXT NOT NULL,  -- 'project.create', 'project.delete', 'secret.rotate', etc.
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
    metadata JSONB DEFAULT '{}'::jsonb,
    error_message TEXT
);

CREATE INDEX idx_audit_log_timestamp ON platform.audit_log(timestamp DESC);
CREATE INDEX idx_audit_log_resource ON platform.audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_log_actor ON platform.audit_log(actor_type, actor_id);

-- Update timestamp triggers
CREATE OR REPLACE FUNCTION platform.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_owners_updated_at
    BEFORE UPDATE ON platform.owners
    FOR EACH ROW
    EXECUTE FUNCTION platform.update_updated_at_column();

CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON platform.projects
    FOR EACH ROW
    EXECUTE FUNCTION platform.update_updated_at_column();

-- Grant permissions (adjust as needed for your platform service user)
-- Example: GRANT USAGE ON SCHEMA platform TO platform_service;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO platform_service;
