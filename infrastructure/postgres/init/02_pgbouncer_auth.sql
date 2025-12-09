-- PgBouncer Authentication Setup
-- Creates pgbouncer_auth user and auth_query function for SCRAM-SHA-256

-- Create pgbouncer_auth user if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'pgbouncer_auth') THEN
        CREATE USER pgbouncer_auth WITH PASSWORD 'changeme_in_production';
    END IF;
END
$$;

-- Create pgbouncer schema
CREATE SCHEMA IF NOT EXISTS pgbouncer;

-- Create auth_query function
-- This function is called by PgBouncer to retrieve SCRAM-SHA-256 hashes
CREATE OR REPLACE FUNCTION pgbouncer.get_auth(p_usename TEXT)
RETURNS TABLE(usename TEXT, passwd TEXT) AS
$$
BEGIN
    RETURN QUERY SELECT s.usename::TEXT, s.passwd::TEXT
    FROM pg_catalog.pg_shadow s WHERE s.usename = p_usename;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT USAGE ON SCHEMA pgbouncer TO pgbouncer_auth;
GRANT EXECUTE ON FUNCTION pgbouncer.get_auth(TEXT) TO pgbouncer_auth;

-- Log completion
DO $$ BEGIN RAISE NOTICE 'PgBouncer auth setup complete'; END $$;
