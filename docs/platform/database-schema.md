# Database Schema Documentation

LaunchDB uses a two-database architecture: one platform database for managing all projects, and per-project databases for application data isolation.

## Architecture Overview

```
┌─────────────────────────────────────┐
│      Platform Database              │
│  (Shared across all projects)       │
│                                     │
│  - platform.owners                  │
│  - platform.projects                │
│  - platform.secrets                 │
│  - platform.api_keys                │
│  - platform.audit_log               │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│   Project Database: proj_xxx        │
│  (Isolated per project)             │
│                                     │
│  - auth.users                       │
│  - auth.sessions                    │
│  - auth.refresh_tokens              │
│  - storage.buckets                  │
│  - storage.objects                  │
│  - public.* (app tables)            │
└─────────────────────────────────────┘
```

---

## Platform Database

The platform database manages owners, projects, and their metadata.

### platform.owners

Owner accounts (dashboard users who create projects).

```sql
CREATE TABLE platform.owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,  -- Argon2id hash
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deleted'))
);
```

**Indexes:**
- `idx_owners_email` on `email`
- `idx_owners_status` on `status`

**Status Values:**
- `active`: Normal account
- `suspended`: Temporarily disabled
- `deleted`: Soft-deleted

---

### platform.projects

Registry of all projects and their databases.

```sql
CREATE TABLE platform.projects (
  id TEXT PRIMARY KEY,  -- Format: 'proj_{16_hex_chars}'
  name TEXT NOT NULL,
  display_name TEXT,  -- User-friendly display name for the project
  owner_id UUID NOT NULL REFERENCES platform.owners(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning', 'active', 'suspended', 'failed', 'deleted')),
  region TEXT NOT NULL DEFAULT 'default',
  db_name TEXT NOT NULL UNIQUE,  -- Matches project database name
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);
```

**Indexes:**
- `idx_projects_owner_id` on `owner_id`
- `idx_projects_status` on `status`
- `idx_projects_created_at` on `created_at DESC`

**Status Values:**
- `provisioning`: Being created, migrations running
- `active`: Ready for use
- `suspended`: Temporarily disabled
- `failed`: Creation failed
- `deleted`: Soft-deleted, pending cleanup

**Relationships:**
- Belongs to one owner (CASCADE delete)
- Has many secrets
- Has many API keys

---

### platform.secrets

Encrypted storage for sensitive values (JWT secrets, passwords, API keys).

```sql
CREATE TABLE platform.secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES platform.projects(id) ON DELETE CASCADE,
  secret_type TEXT NOT NULL,  -- 'jwt_secret', 'db_password', 'anon_key', 'service_role_key'
  encrypted_value BYTEA NOT NULL,  -- AES-256-GCM encrypted
  key_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  UNIQUE(project_id, secret_type, key_version)
);
```

**Indexes:**
- `idx_secrets_project_id` on `project_id`
- `idx_secrets_lookup` on `(project_id, secret_type, key_version DESC)`

**Secret Types:**
- `jwt_secret`: Used for signing project JWT tokens
- `db_password`: Database authenticator role password
- `anon_key`: Client-side JWT token (anon role)
- `service_role_key`: Server-side JWT token (admin access)

**Encryption:** AES-256-GCM with platform master key

**Key Versioning:** Supports key rotation by incrementing `key_version`

---

### platform.api_keys

API key management (references secrets table).

```sql
CREATE TABLE platform.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES platform.projects(id) ON DELETE CASCADE,
  key_type TEXT NOT NULL CHECK (key_type IN ('anon', 'service_role')),
  public_key TEXT NOT NULL UNIQUE,  -- e.g., 'pk_proj_xxx_anon_yyy'
  secret_id UUID NOT NULL REFERENCES platform.secrets(id),
  scopes JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  UNIQUE(project_id, key_type)
);
```

**Indexes:**
- `idx_api_keys_project_id` on `project_id`
- `idx_api_keys_public_key` on `public_key`
- `idx_api_keys_active_type` on `(project_id, key_type) WHERE revoked_at IS NULL` (partial unique index for active keys)

**Key Types:**
- `anon`: Client-side key (limited permissions)
- `service_role`: Server-side key (full access)

**Scopes:** Reserved for future granular permissions

---

### platform.migration_state

Tracks applied migrations per project (v1: unused, for future custom migrations).

```sql
CREATE TABLE platform.migration_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES platform.projects(id) ON DELETE CASCADE,
  migration_name TEXT NOT NULL,  -- e.g., '001_auth_schema'
  schema_name TEXT NOT NULL,  -- 'auth', 'storage', 'public'
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum TEXT NOT NULL,  -- SHA-256 of migration SQL
  execution_time_ms INT,
  UNIQUE(project_id, migration_name)
);
```

**Indexes:**
- `idx_migration_state_project_id` on `project_id`
- `idx_migration_state_applied_at` on `applied_at DESC`

**Note:** v1 uses per-project `migration_state` table. This platform table is for future centralized tracking.

---

### platform.audit_log

Audit trail for platform operations.

```sql
CREATE TABLE platform.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('owner', 'system', 'service')),
  actor_id TEXT,  -- Owner UUID or service name
  action TEXT NOT NULL,  -- 'project.create', 'project.delete', etc.
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
  metadata JSONB DEFAULT '{}'::jsonb,
  error_message TEXT
);
```

**Indexes:**
- `idx_audit_log_timestamp` on `timestamp DESC`
- `idx_audit_log_resource` on `(resource_type, resource_id)`
- `idx_audit_log_actor` on `(actor_type, actor_id)`

**Actor Types:**
- `owner`: Dashboard user action
- `system`: Automated system action
- `service`: Service-to-service action

**Common Actions:**
- `project.create`, `project.delete`, `project.suspend`
- `secret.rotate`, `secret.access`
- `owner.login`, `owner.signup`

---

## Per-Project Database

Each project has its own isolated PostgreSQL database with three schemas: `auth`, `storage`, and `public`.

### auth.users

User accounts for the project.

```sql
CREATE TABLE auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,  -- Argon2id hash
  email_verified BOOLEAN NOT NULL DEFAULT false,
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sign_in_at TIMESTAMPTZ,
  raw_app_meta_data JSONB DEFAULT '{}'::jsonb,  -- System metadata
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,  -- User profile data
  is_suspended BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ
);
```

**Indexes:**
- `idx_users_email` on `email WHERE deleted_at IS NULL`
- `idx_users_created_at` on `created_at DESC`

**RLS Policies:**
- Users can read/update their own data
- Service role has full access

**Metadata Fields:**
- `raw_app_meta_data`: System-managed (roles, permissions)
- `raw_user_meta_data`: User-provided (profile, preferences)

---

### auth.sessions

Active user sessions.

```sql
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
```

**Indexes:**
- `idx_sessions_user_id` on `user_id`
- `idx_sessions_expires_at` on `expires_at`

**RLS Policies:**
- Users can view their own sessions
- Service role has full access

---

### auth.refresh_tokens

Long-lived tokens for obtaining new access tokens.

```sql
CREATE TABLE auth.refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT UNIQUE NOT NULL,  -- SHA-256 hash
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES auth.sessions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  parent_token_id UUID REFERENCES auth.refresh_tokens(id) ON DELETE SET NULL
);
```

**Indexes:**
- `idx_refresh_tokens_token_hash` on `token_hash WHERE revoked_at IS NULL`
- `idx_refresh_tokens_user_id` on `user_id`
- `idx_refresh_tokens_expires_at` on `expires_at`

**RLS Policies:**
- Service role only

**Token Rotation:** `parent_token_id` links to previous token for audit trail

---

### auth.password_reset_tokens

Password reset tokens (v1.1 - table exists, feature not implemented).

```sql
CREATE TABLE auth.password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,  -- SHA-256 hash
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
```

---

### auth.email_verification_tokens

Email verification tokens (v1.1 - table exists, feature not implemented).

```sql
CREATE TABLE auth.email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,  -- SHA-256 hash
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
```

---

### storage.buckets

Storage buckets (like AWS S3 buckets).

```sql
CREATE TABLE storage.buckets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  public BOOLEAN NOT NULL DEFAULT false,
  file_size_limit BIGINT,  -- Bytes, NULL = no limit
  allowed_mime_types TEXT[],  -- NULL = all types allowed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  owner_id UUID,  -- Optional: reference to auth.users(id)
  metadata JSONB DEFAULT '{}'::jsonb
);
```

**Indexes:**
- `idx_buckets_name` on `name`
- `idx_buckets_public` on `public`

**RLS Policies:**
- Anyone can read bucket info
- Service role can manage buckets

---

### storage.objects

File metadata.

```sql
CREATE TABLE storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket TEXT NOT NULL,  -- Bucket name (denormalized)
  path TEXT NOT NULL,  -- File path within bucket
  owner_id UUID,  -- Reference to auth.users(id)
  size BIGINT NOT NULL,  -- Bytes
  content_type TEXT NOT NULL,  -- MIME type
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at TIMESTAMPTZ,
  version TEXT NOT NULL DEFAULT 'v1',
  UNIQUE(bucket, path)
);
```

**Indexes:**
- `idx_objects_bucket` on `bucket`
- `idx_objects_owner_id` on `owner_id`
- `idx_objects_path` on `(bucket, path)`
- `idx_objects_created_at` on `created_at DESC`

**RLS Policies:**
- Public bucket objects readable by all
- Users can read/update/delete their own objects
- Service role has full access

---

### storage.signed_urls

Temporary access tokens for files.

```sql
CREATE TABLE storage.signed_urls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT UNIQUE NOT NULL,  -- SHA-256 hash
  bucket TEXT NOT NULL,  -- Bucket name
  path TEXT NOT NULL,  -- File path
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  used_at TIMESTAMPTZ
);
```

**Indexes:**
- `idx_signed_urls_token_hash` on `token_hash`
- `idx_signed_urls_bucket_path` on `(bucket, path)`
- `idx_signed_urls_expires_at` on `expires_at`

**RLS Policies:**
- Service role only

---

### public.* (Application Tables)

The `public` schema is where developers create their application tables.

**Default Setup:**
- RLS enabled by default
- Helper functions available (`auth_uid()`, `auth_role()`, `auth_email()`)
- Example table provided: `public.example_todos`

**Example Table:**

```sql
CREATE TABLE public.example_todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS policies ensure users only see their own todos
ALTER TABLE public.example_todos ENABLE ROW LEVEL SECURITY;

CREATE POLICY todos_select_own ON public.example_todos
  FOR SELECT USING (user_id = public.auth_uid());
```

---

## Database Roles

Each project database has three PostgreSQL roles:

### 1. `anon` Role

**Purpose:** Unauthenticated requests

**Permissions:**
- Read-only on public data
- No access to `auth.*` or `storage.*` tables directly
- RLS policies enforced

**Used by:** PostgREST for anonymous requests

---

### 2. `authenticated` Role

**Purpose:** Authenticated user requests

**Permissions:**
- Read own data via RLS policies
- Insert/update/delete own data via RLS policies
- Read `auth.users` (own record only)
- Read/write `storage.objects` (own files only)

**Used by:** PostgREST for JWT-authenticated requests

---

### 3. `service_role` Role

**Purpose:** Server-side operations, admin access

**Permissions:**
- Full access to all schemas and tables
- Bypasses RLS policies
- Can impersonate other roles

**Used by:** Auth service, Storage service, admin operations

**Security:** Never expose `service_role_key` to clients!

---

## Helper Functions

### Auth Helper Functions

Available in all schemas for RLS policies:

```sql
-- Get current user ID from JWT
auth.uid() RETURNS UUID

-- Get current user role ('anon', 'authenticated', 'service_role')
auth.role() RETURNS TEXT
```

**Note:** These functions safely handle empty/null JWT claims by returning NULL instead of erroring.

**Usage in RLS:**

```sql
CREATE POLICY posts_select_own ON public.posts
  FOR SELECT
  USING (user_id = auth.uid());
```

---

## Migration State Tracking

Each project database has a `migration_state` table (created automatically):

```sql
CREATE TABLE migration_state (
  name TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER NOT NULL
);
```

**Purpose:** Track applied migrations with checksum validation

---

## Connection Strings

### Platform Database

```
postgresql://platform_user:password@localhost:5432/platform
```

### Project Database (via PgBouncer)

```
postgresql://proj_xxx_authenticator:password@localhost:6432/proj_xxx
```

### Project Database (Direct)

```
postgresql://proj_xxx_authenticator:password@localhost:5432/proj_xxx
```

---

## Data Isolation

**Platform Level:**
- Each project has its own database
- Projects cannot access other projects' data
- Platform database manages all projects

**User Level:**
- RLS policies enforce user data isolation
- Users can only see/modify their own data
- Service role bypasses RLS for admin operations

**Schema Level:**
- `auth.*`: Authentication data
- `storage.*`: File metadata
- `public.*`: Application data

---

## Backup & Recovery

### Platform Database

**Critical:** Contains all project metadata, secrets, owner accounts

**Backup Strategy:**
- Daily full backups
- Transaction log archiving for point-in-time recovery
- Store encrypted secrets backup separately

### Project Databases

**Important:** Contains user data, auth records, file metadata

**Backup Strategy:**
- Per-project backup schedule
- Point-in-time recovery capability
- Separate backup for auth/storage schemas

---

## Performance Considerations

### Indexes

- All foreign keys indexed
- Lookup columns indexed (email, status, project_id)
- Timestamp columns indexed for time-series queries

### Partitioning (Future)

Consider partitioning for large tables:
- `platform.audit_log` by timestamp
- `auth.sessions` by created_at
- `storage.objects` by bucket_id

### Connection Pooling

- PgBouncer in transaction mode
- Pool size: 5-20 per project (default: 5)
- Platform database: Larger pool (50-100)

---

## Schema Versioning

LaunchDB uses migration-based schema versioning:

**Platform Schema:** `001_platform_schema.sql`

**Project Schemas:**
- `001_auth_schema.sql` - Auth tables and RLS
- `002_storage_schema.sql` - Storage tables and RLS
- `003_public_baseline.sql` - Public schema helpers

**Future Migrations:** Numbered sequentially (004_, 005_, ...)

---

## See Also

- [Platform API Documentation](./platform-api.md) - API endpoints
- [Migrations Service Documentation](./migrations-service.md) - Schema management
- [Auth Service Documentation](./auth-service.md) - Authentication implementation
- [Storage Service Documentation](./storage-service.md) - File storage implementation
- [Environment Variables](./platform-env-vars.md) - Configuration reference
