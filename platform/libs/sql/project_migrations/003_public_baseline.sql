-- Public Schema Baseline for Project Database
-- Sets up RLS and helper functions in the public schema

-- Enable RLS by default for new tables (developers can adjust)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO authenticated;

-- Helper functions for app developers to use in their RLS policies
-- Fixed: Handle empty/null jwt.claims gracefully (returns NULL instead of erroring)
CREATE OR REPLACE FUNCTION public.auth_uid() RETURNS UUID AS $$
DECLARE
    claims text := current_setting('request.jwt.claims', true);
BEGIN
    IF claims IS NULL OR claims = '' THEN
        RETURN NULL;
    END IF;
    RETURN NULLIF(claims::json->>'sub', '')::uuid;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION public.auth_role() RETURNS TEXT AS $$
DECLARE
    claims text := current_setting('request.jwt.claims', true);
BEGIN
    IF claims IS NULL OR claims = '' THEN
        RETURN NULL;
    END IF;
    RETURN NULLIF(claims::json->>'role', '');
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION public.auth_email() RETURNS TEXT AS $$
DECLARE
    claims text := current_setting('request.jwt.claims', true);
BEGIN
    IF claims IS NULL OR claims = '' THEN
        RETURN NULL;
    END IF;
    RETURN NULLIF(claims::json->>'email', '');
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant basic permissions to project roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO service_role;

-- Example table (optional, can be removed)
-- This shows developers the pattern for RLS-enabled tables
CREATE TABLE IF NOT EXISTS public.example_todos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,  -- Should reference auth.users(id)
    title TEXT NOT NULL,
    completed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.example_todos ENABLE ROW LEVEL SECURITY;

-- Users can only see their own todos
CREATE POLICY todos_select_own ON public.example_todos
    FOR SELECT
    USING (user_id = public.auth_uid());

-- Users can only insert their own todos
CREATE POLICY todos_insert_own ON public.example_todos
    FOR INSERT
    WITH CHECK (user_id = public.auth_uid());

-- Users can only update their own todos
CREATE POLICY todos_update_own ON public.example_todos
    FOR UPDATE
    USING (user_id = public.auth_uid())
    WITH CHECK (user_id = public.auth_uid());

-- Users can only delete their own todos
CREATE POLICY todos_delete_own ON public.example_todos
    FOR DELETE
    USING (user_id = public.auth_uid());

-- Service role has full access
CREATE POLICY todos_service_role_all ON public.example_todos
    FOR ALL
    USING (public.auth_role() = 'service_role');

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.example_todos TO authenticated;
GRANT ALL ON public.example_todos TO service_role;

COMMENT ON TABLE public.example_todos IS 'Example table showing RLS pattern. Developers can drop this and create their own tables.';
