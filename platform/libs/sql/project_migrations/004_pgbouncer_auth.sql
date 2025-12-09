-- Migration: Add pgbouncer.get_auth() function for SCRAM authentication
-- This replaces the broken pgbouncer.user_lookup() function
-- Source: Supavisor (Supabase) connection pooler authentication approach
-- Purpose: Allow PgBouncer to authenticate against pg_shadow directly (SCRAM-SHA-256)

-- 1. Create pgbouncer schema if not exists
CREATE SCHEMA IF NOT EXISTS pgbouncer;

-- 2. Create auth user if not exists (may already exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pgbouncer_auth') THEN
        CREATE ROLE pgbouncer_auth WITH LOGIN PASSWORD 'YmOgt3B1I4yLkMc2br0AsEwQyRJHKSa';
    END IF;
END
$$;

-- 3. Grant schema ownership
ALTER SCHEMA pgbouncer OWNER TO pgbouncer_auth;

-- 4. Create get_auth function
-- SECURITY DEFINER allows pgbouncer_auth to query pg_shadow without superuser
CREATE OR REPLACE FUNCTION pgbouncer.get_auth(p_usename TEXT)
RETURNS TABLE(usename TEXT, passwd TEXT) AS
$$
BEGIN
    RETURN QUERY
    SELECT s.usename::TEXT, s.passwd::TEXT
    FROM pg_catalog.pg_shadow s
    WHERE s.usename = p_usename;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Security: Revoke from public, grant only to pgbouncer_auth
REVOKE ALL ON FUNCTION pgbouncer.get_auth(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pgbouncer.get_auth(TEXT) TO pgbouncer_auth;
GRANT USAGE ON SCHEMA pgbouncer TO pgbouncer_auth;

-- 6. Drop the old broken function if it exists
DROP FUNCTION IF EXISTS pgbouncer.user_lookup(TEXT);
