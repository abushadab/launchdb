-- Auth Schema for Project Database
-- Applied to each project_X database during provisioning

-- Create auth schema
CREATE SCHEMA IF NOT EXISTS auth;

-- Users table
CREATE TABLE auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,  -- argon2id hash
    email_verified BOOLEAN NOT NULL DEFAULT false,
    email_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_sign_in_at TIMESTAMPTZ,
    raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
    raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
    is_suspended BOOLEAN NOT NULL DEFAULT false,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON auth.users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_created_at ON auth.users(created_at DESC);

-- Sessions table (for tracking active sessions)
CREATE TABLE auth.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    user_agent TEXT,
    ip_address INET,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user_id ON auth.sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON auth.sessions(expires_at);

-- Refresh tokens table
CREATE TABLE auth.refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT UNIQUE NOT NULL,  -- SHA-256 hash of the token
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES auth.sessions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    parent_token_id UUID REFERENCES auth.refresh_tokens(id) ON DELETE SET NULL
);

CREATE INDEX idx_refresh_tokens_token_hash ON auth.refresh_tokens(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_refresh_tokens_user_id ON auth.refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON auth.refresh_tokens(expires_at);

-- Password reset tokens
CREATE TABLE auth.password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,  -- SHA-256 hash
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
);

CREATE INDEX idx_password_reset_tokens_token_hash ON auth.password_reset_tokens(token_hash)
    WHERE used_at IS NULL;
CREATE INDEX idx_password_reset_tokens_user_id ON auth.password_reset_tokens(user_id);

-- Email verification tokens
CREATE TABLE auth.email_verification_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,  -- SHA-256 hash
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
);

CREATE INDEX idx_email_verification_tokens_token_hash ON auth.email_verification_tokens(token_hash)
    WHERE used_at IS NULL;

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION auth.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION auth.update_updated_at_column();

CREATE TRIGGER update_sessions_updated_at
    BEFORE UPDATE ON auth.sessions
    FOR EACH ROW
    EXECUTE FUNCTION auth.update_updated_at_column();

-- Helper functions for RLS
-- Handle empty/null jwt.claims gracefully (returns NULL instead of erroring)
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
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

CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
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

-- RLS policies (strict by default)
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.email_verification_tokens ENABLE ROW LEVEL SECURITY;

-- Users can only read their own data
CREATE POLICY users_select_own ON auth.users
    FOR SELECT
    USING (auth.uid() = id);

-- Users can update their own metadata
CREATE POLICY users_update_own ON auth.users
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Service role has full access
CREATE POLICY users_service_role_all ON auth.users
    FOR ALL
    USING (auth.role() = 'service_role');

-- Similar policies for sessions (users can see their own)
CREATE POLICY sessions_select_own ON auth.sessions
    FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY sessions_service_role_all ON auth.sessions
    FOR ALL
    USING (auth.role() = 'service_role');

-- Refresh tokens: service role only
CREATE POLICY refresh_tokens_service_role_all ON auth.refresh_tokens
    FOR ALL
    USING (auth.role() = 'service_role');

-- Password reset: service role only
CREATE POLICY password_reset_tokens_service_role_all ON auth.password_reset_tokens
    FOR ALL
    USING (auth.role() = 'service_role');

-- Email verification: service role only
CREATE POLICY email_verification_tokens_service_role_all ON auth.email_verification_tokens
    FOR ALL
    USING (auth.role() = 'service_role');

-- Grant permissions to project roles
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Anon can't access auth tables directly (auth service handles signup/login)
-- Authenticated users can read/update their own data via RLS policies
GRANT SELECT, UPDATE ON auth.users TO authenticated;
GRANT SELECT ON auth.sessions TO authenticated;

-- Service role has full access
GRANT ALL ON ALL TABLES IN SCHEMA auth TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO service_role;
