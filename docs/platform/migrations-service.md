# Migrations Service Documentation

The Migrations Service manages database schema migrations for per-project databases. It applies default schemas (auth, storage) and provides a foundation for application development with Row Level Security (RLS) enabled.

## Base URL

```
http://localhost:8002
```

## Architecture

- **Automated Execution:** Migrations run automatically during project creation
- **Idempotent:** Migrations track applied changes via checksum validation
- **Ordered Execution:** Migrations execute in lexicographic order (001_, 002_, 003_)
- **Rollback Protection:** Failed migrations stop execution, no automatic rollback
- **Internal API:** Protected by INTERNAL_API_KEY for Platform API use only

---

## Migration Flow

```
Project Creation (Platform API)
  ↓
Call Migrations Runner
  ↓
Load Migration Files from libs/sql/project_migrations/
  ↓
Check Applied Migrations (migration_state table)
  ↓
Execute Pending Migrations in Order
  ↓
Record Success/Failure with Checksum
  ↓
Return Migration Results to Platform API
```

---

## Endpoints

### Health Check

#### `GET /health`

Health check endpoint for monitoring.

**Authentication:** None required

**Response:**

```json
{
  "status": "ok",
  "service": "migrations-runner"
}
```

---

### Run Migrations

#### `POST /internal/migrations/run`

Execute all pending migrations for a project. This is an internal endpoint called by the Platform API during project creation.

**Authentication:** Required (INTERNAL_API_KEY in X-Internal-API-Key header)

**Headers:**
```
X-Internal-API-Key: <INTERNAL_API_KEY>
Content-Type: application/json
```

**Request Body:**

```json
{
  "project_id": "proj_802682481788fe51"
}
```

**Response:** `200 OK`

```json
{
  "project_id": "proj_802682481788fe51",
  "migrations_applied": 3,
  "migrations_skipped": 0,
  "total_duration_ms": 1245,
  "status": "success",
  "results": [
    {
      "name": "001_auth_schema",
      "checksum": "a3f2e8...",
      "executed": true,
      "duration_ms": 432
    },
    {
      "name": "002_storage_schema",
      "checksum": "b4d9f1...",
      "executed": true,
      "duration_ms": 387
    },
    {
      "name": "003_public_baseline",
      "checksum": "c5e0g2...",
      "executed": true,
      "duration_ms": 426
    }
  ]
}
```

**Response Fields:**
- `migrations_applied`: Number of new migrations executed
- `migrations_skipped`: Number of already-applied migrations (based on checksum)
- `total_duration_ms`: Total time for all migrations
- `status`: "success" (all passed), "no_changes" (already applied), "failed" (migration failed)
- `results`: Array of per-migration results

**Status Values:**
- `success`: All migrations applied successfully
- `no_changes`: No new migrations to apply (all already applied)
- `failed`: Migration failed, execution stopped

**Error Responses:**

```json
// 401 Unauthorized - Missing or invalid internal API key
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}

// 404 Not Found - Project doesn't exist
{
  "statusCode": 404,
  "message": "Project not found: proj_xxx",
  "error": "Not Found"
}

// 400 Bad Request - Project not in valid state
{
  "statusCode": 400,
  "message": "Cannot run migrations on project with status: deleted",
  "error": "Bad Request"
}
```

---

## Default Migrations

LaunchDB applies three default migrations to every new project:

### 001_auth_schema.sql

Creates the authentication schema with full user management capabilities.

**Schema:** `auth`

**Tables:**
- `auth.users` - User accounts with email/password
- `auth.sessions` - Active user sessions
- `auth.refresh_tokens` - Long-lived tokens for token refresh
- `auth.password_reset_tokens` - Password reset tokens
- `auth.email_verification_tokens` - Email verification tokens

**Helper Functions:**
- `auth.uid()` - Returns current authenticated user ID from JWT (NULL-safe)
- `auth.role()` - Returns current user role ('anon', 'authenticated', 'service_role', NULL-safe)

**RLS Policies:**
- Users can read/update their own data
- Service role has full access
- Strict isolation between users

**Example Query:**
```sql
-- Get current authenticated user
SELECT * FROM auth.users WHERE id = auth.uid();

-- List user sessions
SELECT * FROM auth.sessions WHERE user_id = auth.uid();
```

---

### 002_storage_schema.sql

Creates the storage schema for file management.

**Schema:** `storage`

**Tables:**
- `storage.buckets` - Storage buckets (like S3 buckets)
- `storage.objects` - File metadata
- `storage.signed_urls` - Temporary access tokens

**Features:**
- Public and private buckets
- Per-file owner tracking
- MIME type validation
- File size limits
- Signed URL support

**RLS Policies:**
- Public bucket files readable by all
- Users can only access their own files in private buckets
- Service role has full access

**Example Query:**
```sql
-- List user's uploaded files
SELECT * FROM storage.objects WHERE owner_id = auth.uid();

-- List public files in avatars bucket
SELECT * FROM storage.objects o
JOIN storage.buckets b ON o.bucket = b.name
WHERE b.name = 'avatars' AND b.public = true;
```

---

### 003_public_baseline.sql

Sets up the `public` schema with RLS helpers and an example table.

**Schema:** `public`

**Helper Functions:**
- `public.auth_uid()` - Current user ID (calls auth.uid())
- `public.auth_role()` - Current user role (calls auth.role())

**Example Table:** `public.example_todos`
- Demonstrates RLS patterns
- Users can only see/modify their own todos
- Safe to drop after understanding the pattern

**Default Permissions:**
- `anon` role: Read-only access
- `authenticated` role: Full CRUD on own data
- `service_role`: Full access to everything

**Example Usage:**
```sql
-- Create a new table with RLS
CREATE TABLE public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- Users can only see their own posts
CREATE POLICY posts_select_own ON public.posts
  FOR SELECT
  USING (user_id = public.auth_uid());

-- Users can create posts (with their own user_id)
CREATE POLICY posts_insert_own ON public.posts
  FOR INSERT
  WITH CHECK (user_id = public.auth_uid());
```

---

## Migration State Tracking

Migrations are tracked in the `platform.migration_state` table (created automatically):

```sql
CREATE TABLE platform.migration_state (
  id SERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  migration_name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  executed_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (project_id, migration_name)
);
```

**How it Works:**
1. Before running migrations, service checks `migration_state` table
2. For each migration file, calculates SHA-256 checksum of SQL content
3. Skips migration if name exists with matching checksum
4. Executes migration if new or checksum changed
5. Records result with execution timestamp and duration

**Checksum Validation:**
- Detects if migration file content changed
- Prevents applying modified migrations (would fail on checksum mismatch)
- Ensures migration integrity

---

## Migration File Format

Migration files are SQL scripts located in `libs/sql/project_migrations/`.

**Naming Convention:**
```
{order}_{description}.sql

Examples:
001_auth_schema.sql
002_storage_schema.sql
003_public_baseline.sql
```

**Execution Order:** Lexicographic sort (001, 002, 003, ...)

**Best Practices:**
1. Use 3-digit prefixes (001, 002, ..., 099)
2. Descriptive names (auth_schema, add_user_profiles)
3. Idempotent SQL (use IF NOT EXISTS, CREATE OR REPLACE)
4. Include comments explaining changes
5. Test migrations on a development project first

**Example Migration:**

```sql
-- 004_user_profiles.sql
-- Add user profiles table

CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read all profiles
CREATE POLICY profiles_select_all ON public.user_profiles
  FOR SELECT
  USING (true);

-- Users can update their own profile
CREATE POLICY profiles_update_own ON public.user_profiles
  FOR UPDATE
  USING (user_id = public.auth_uid());

-- Grant permissions
GRANT SELECT, UPDATE ON public.user_profiles TO authenticated;
```

---

## Security Considerations

1. **Internal API Only:**
   - Migrations endpoint protected by INTERNAL_API_KEY
   - Only Platform API can trigger migrations
   - Not accessible to end users

2. **Admin Privileges:**
   - Migrations run with database admin privileges
   - Can create schemas, tables, functions, policies
   - Creates project roles during execution

3. **No Rollback:**
   - Failed migrations do not automatically rollback
   - Manual intervention required for failures
   - Consider transaction wrapping for complex migrations

4. **Checksum Integrity:**
   - Changing applied migration files will fail
   - Forces immutability of migration history
   - Create new migrations for schema changes

5. **RLS by Default:**
   - All default tables have RLS enabled
   - Strict isolation between users
   - Service role bypasses RLS

---

## Project Roles

Migrations create three PostgreSQL roles for each project:

### 1. `anon` Role

**Purpose:** Unauthenticated users

**Permissions:**
- Read-only access to public data
- Cannot access auth or storage schemas directly
- Used by PostgREST for anonymous requests

**Usage:** Client-side requests without authentication

---

### 2. `authenticated` Role

**Purpose:** Authenticated users

**Permissions:**
- Full CRUD on own data (via RLS)
- Read access to public data
- Cannot access other users' data

**Usage:** Client-side requests with user JWT token

---

### 3. `service_role` Role

**Purpose:** Server-side operations, admin tasks

**Permissions:**
- Full access to all schemas and tables
- Bypasses RLS policies
- Can impersonate other roles

**Usage:**
- Server-side API operations
- Admin dashboards
- Batch operations
- Data migrations

**Security:** Never expose service_role_key to clients!

---

## Environment Variables

**Required:**
- `PLATFORM_DB_DSN`: PostgreSQL connection string for platform database
- `ADMIN_DB_DSN`: PostgreSQL connection string with admin privileges for running migrations
- `INTERNAL_API_KEY`: Secret key for internal service-to-service authentication
- `MIGRATIONS_RUNNER_PORT`: Service port (default: 8002)

See [Environment Variables Documentation](./platform-env-vars.md) for full reference.

---

## Error Handling

The Migrations Service uses the centralized `@launchdb/common/errors` library for consistent error responses.

**Error Factory Functions Used:**
```typescript
import { ERRORS } from '@launchdb/common/errors';

// Project not found
throw ERRORS.ProjectNotFound(projectId);

// Invalid project status
throw ERRORS.ValidationError('Cannot run migrations on project with status: deleted', projectId);

// No migrations found
throw ERRORS.ValidationError('No migrations found');

// Invalid credentials (API key)
throw ERRORS.InvalidCredentials();

// Internal errors (config, DSN parsing)
throw ERRORS.InternalError('ADMIN_DB_DSN not configured');
```

**LaunchDbErrorFilter:**
The service registers `LaunchDbErrorFilter` globally to convert LaunchDbError instances to proper HTTP responses with correct status codes.

---

### Migration Failures

When a migration fails:

1. **Execution Stops:** No further migrations run
2. **Partial State:** Successfully applied migrations remain applied
3. **Error Recorded:** Failure details returned in response
4. **Manual Fix Required:** Administrator must resolve issue

**Example Failure Response:**

```json
{
  "project_id": "proj_802682481788fe51",
  "migrations_applied": 1,
  "migrations_skipped": 0,
  "total_duration_ms": 432,
  "status": "failed",
  "results": [
    {
      "name": "001_auth_schema",
      "checksum": "a3f2e8...",
      "executed": true,
      "duration_ms": 432
    },
    {
      "name": "002_storage_schema",
      "checksum": "b4d9f1...",
      "executed": false,
      "error": "syntax error at or near \"TABEL\""
    }
  ]
}
```

**Recovery Steps:**
1. Fix migration SQL file
2. Update checksum in `migration_state` table OR
3. Delete failed migration from `migration_state`
4. Retry migration run

---

## Custom Migrations (v1.1)

Future versions will support custom migrations per project:

```sql
-- User-created migration
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Planned Features:**
- Upload custom migrations via API
- Version control integration
- Migration preview/dry-run
- Automatic rollback on failure
- Migration history UI

---

## Monitoring

### Migration Logs

The Migrations Service logs all operations:

```bash
# View migration logs
docker logs launchdb-migrations-runner

# Example log output
[MigrationLoaderService] Loaded migration: 001_auth_schema.sql (checksum: a3f2e8...)
[MigrationLoaderService] Loaded migration: 002_storage_schema.sql (checksum: b4d9f1...)
[MigrationLoaderService] Loaded migration: 003_public_baseline.sql (checksum: c5e0g2...)
[MigrationLoaderService] Loaded 3 migrations
[MigrationsService] Running migrations for project proj_802682481788fe51
[MigrationsService] Migration 001_auth_schema executed in 432ms
[MigrationsService] Migration 002_storage_schema executed in 387ms
[MigrationsService] Migration 003_public_baseline executed in 426ms
[MigrationsService] Migrations completed: 3 applied, 0 skipped (1245ms total)
```

### Query Migration State

```sql
-- Connect to project database
psql -d proj_802682481788fe51

-- View applied migrations
SELECT * FROM platform.migration_state
WHERE project_id = 'proj_802682481788fe51'
ORDER BY executed_at;

-- Check migration status
SELECT
  migration_name,
  executed_at,
  LEFT(checksum, 8) as checksum_prefix
FROM platform.migration_state
WHERE project_id = 'proj_802682481788fe51';
```

---

## Testing

### Local Development

```bash
# Migrations Service runs on port 8002
curl http://localhost:8002/health
```

### Test Migration Execution

```bash
# Run migrations for a project (requires INTERNAL_API_KEY)
curl -X POST http://localhost:8002/internal/migrations/run \
  -H "X-Internal-API-Key: your-internal-api-key" \
  -H "Content-Type: application/json" \
  -d '{"project_id":"proj_802682481788fe51"}'
```

### Verify Schemas

```bash
# Connect to project database
psql postgresql://proj_xxx_authenticator:password@localhost:6432/proj_xxx

# List schemas
\dn

# List auth tables
\dt auth.*

# List storage tables
\dt storage.*

# List migration state for project
SELECT * FROM platform.migration_state WHERE project_id = 'proj_xxx';
```

---

## Troubleshooting

### Migration Stuck in "provisioning"

**Symptoms:** Project status remains "provisioning" after creation

**Causes:**
- Migrations service down
- Migration execution failed
- Database connection failed

**Solution:**
```bash
# Check migrations service
docker ps --filter "name=migrations-runner"
docker logs launchdb-migrations-runner

# Check project status
psql -d platform -c "SELECT id, status FROM platform.projects WHERE id = 'proj_xxx';"

# Manually run migrations
curl -X POST http://localhost:8002/internal/migrations/run \
  -H "X-Internal-API-Key: your-key" \
  -H "Content-Type: application/json" \
  -d '{"project_id":"proj_xxx"}'
```

---

### Checksum Mismatch Error

**Symptoms:** Migration fails with "checksum mismatch" error

**Cause:** Migration file content changed after being applied

**Solution:**
```sql
-- Option 1: Reset migration state (DANGER: reapplies migration)
DELETE FROM platform.migration_state
WHERE project_id = 'proj_xxx' AND migration_name = '001_auth_schema';

-- Option 2: Update checksum (if change is intentional and safe)
UPDATE platform.migration_state
SET checksum = 'new_checksum_value'
WHERE project_id = 'proj_xxx' AND migration_name = '001_auth_schema';
```

---

## See Also

- [Platform API Documentation](./platform-api.md) - Project management
- [Database Schema](./database-schema.md) - Complete schema reference
- [Auth Service Documentation](./auth-service.md) - Authentication implementation
- [Storage Service Documentation](./storage-service.md) - File storage implementation
- [Environment Variables](./platform-env-vars.md) - Configuration reference
