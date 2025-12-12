-- Storage Schema for Project Database
-- Applied to each project_X database during provisioning

-- Create storage schema
CREATE SCHEMA IF NOT EXISTS storage;

-- Buckets table
CREATE TABLE storage.buckets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    public BOOLEAN NOT NULL DEFAULT false,
    file_size_limit BIGINT,  -- bytes, NULL = no limit
    allowed_mime_types TEXT[],  -- NULL = all types allowed
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    owner_id UUID,  -- Optional: reference to auth.users(id)
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_buckets_name ON storage.buckets(name);
CREATE INDEX idx_buckets_public ON storage.buckets(public);

-- Objects table
CREATE TABLE storage.objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket TEXT NOT NULL,  -- bucket name
    path TEXT NOT NULL,  -- file path within bucket
    owner_id UUID,  -- Reference to auth.users(id), NULL for public uploads
    size BIGINT NOT NULL,  -- bytes
    content_type TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_accessed_at TIMESTAMPTZ,
    version TEXT NOT NULL DEFAULT 'v1',
    UNIQUE(bucket, path)
);

CREATE INDEX idx_objects_bucket ON storage.objects(bucket);
CREATE INDEX idx_objects_owner_id ON storage.objects(owner_id);
CREATE INDEX idx_objects_path ON storage.objects(bucket, path);
CREATE INDEX idx_objects_created_at ON storage.objects(created_at DESC);

-- Signed URLs / temporary access tokens
CREATE TABLE storage.signed_urls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT UNIQUE NOT NULL,  -- SHA-256 hash
    bucket TEXT NOT NULL,  -- bucket name
    path TEXT NOT NULL,  -- file path
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT false,
    used_at TIMESTAMPTZ
);

CREATE INDEX idx_signed_urls_token_hash ON storage.signed_urls(token_hash);
CREATE INDEX idx_signed_urls_bucket_path ON storage.signed_urls(bucket, path);
CREATE INDEX idx_signed_urls_expires_at ON storage.signed_urls(expires_at);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION storage.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_buckets_updated_at
    BEFORE UPDATE ON storage.buckets
    FOR EACH ROW
    EXECUTE FUNCTION storage.update_updated_at_column();

CREATE TRIGGER update_objects_updated_at
    BEFORE UPDATE ON storage.objects
    FOR EACH ROW
    EXECUTE FUNCTION storage.update_updated_at_column();

-- RLS policies
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.signed_urls ENABLE ROW LEVEL SECURITY;

-- Buckets: anyone can read bucket info
CREATE POLICY buckets_select_all ON storage.buckets
    FOR SELECT
    USING (true);

-- Buckets: service role can manage
CREATE POLICY buckets_service_role_all ON storage.buckets
    FOR ALL
    USING (auth.role() = 'service_role');

-- Objects: public bucket objects are readable by all
CREATE POLICY objects_select_public ON storage.objects
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM storage.buckets
            WHERE buckets.name = objects.bucket
            AND buckets.public = true
        )
    );

-- Objects: owners can read their own objects in private buckets
CREATE POLICY objects_select_own ON storage.objects
    FOR SELECT
    USING (owner_id = auth.uid());

-- Objects: authenticated users can insert into buckets
CREATE POLICY objects_insert_authenticated ON storage.objects
    FOR INSERT
    WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- Objects: owners can update/delete their own objects
CREATE POLICY objects_update_own ON storage.objects
    FOR UPDATE
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

CREATE POLICY objects_delete_own ON storage.objects
    FOR DELETE
    USING (owner_id = auth.uid() OR auth.role() = 'service_role');

-- Objects: service role has full access
CREATE POLICY objects_service_role_all ON storage.objects
    FOR ALL
    USING (auth.role() = 'service_role');

-- Signed URLs: service role only
CREATE POLICY signed_urls_service_role_all ON storage.signed_urls
    FOR ALL
    USING (auth.role() = 'service_role');

-- Helper function (reuse from auth schema)
-- Fixed: Handle empty/null jwt.claims gracefully
CREATE OR REPLACE FUNCTION storage.auth_uid() RETURNS UUID AS $$
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

CREATE OR REPLACE FUNCTION storage.auth_role() RETURNS TEXT AS $$
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

-- Use auth schema functions if they exist
-- Fixed: Handle empty/null jwt.claims gracefully (returns NULL instead of erroring)
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

-- Grant permissions to project roles
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

-- Anon can read public bucket info and public objects
GRANT SELECT ON storage.buckets TO anon;
GRANT SELECT ON storage.objects TO anon;

-- Authenticated users can do more via RLS policies
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.buckets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

-- Service role has full access
GRANT ALL ON ALL TABLES IN SCHEMA storage TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO service_role;

-- Default buckets (optional, can be created via storage service)
-- INSERT INTO storage.buckets (name, public) VALUES ('avatars', true);
-- INSERT INTO storage.buckets (name, public) VALUES ('private', false);
