-- PostgREST Manager Read-Only Role
-- Creates least-privileged role for postgrest-manager service
-- Only needs SELECT access to platform.projects and platform.secrets

-- Create postgrest_manager_ro role if not exists
-- NOTE: Role created WITHOUT password. Password must be set after deployment via:
--   ALTER ROLE postgrest_manager_ro WITH PASSWORD '<value_from_POSTGREST_MANAGER_PASSWORD>';
-- This prevents hardcoded password mismatch with docker-compose.yml env var.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'postgrest_manager_ro') THEN
        CREATE ROLE postgrest_manager_ro WITH LOGIN;
    END IF;
END
$$;

-- Grant schema access
GRANT USAGE ON SCHEMA platform TO postgrest_manager_ro;

-- Grant SELECT on projects table
GRANT SELECT ON platform.projects TO postgrest_manager_ro;

-- Grant SELECT on specific columns of secrets table
-- Manager only needs: project_id, secret_type, encrypted_value, key_version
GRANT SELECT (project_id, secret_type, encrypted_value, key_version) ON platform.secrets TO postgrest_manager_ro;

-- Log completion
DO $$ BEGIN RAISE NOTICE 'PostgREST Manager read-only role created'; END $$;
