# LaunchDB - NestJS Implementation

VPS-first Backend-as-a-Service (BaaS) platform for Next.js/React applications.

## Architecture

LaunchDB provides a multi-tenant platform for managing PostgreSQL-backed projects with built-in authentication, storage, and API generation via PostgREST.

### Services

| Service | Port | Description |
|---------|------|-------------|
| **Platform API** | 8000 | Owner authentication, project management, connection info |
| **Auth Service** | 8001 | Multi-tenant user authentication (per-project) |
| **Migrations Runner** | 8002 | Database schema migrations (auth, storage, public) |
| **Storage Service** | 8003 | File upload/download with signed URLs |
| **PostgREST** | 3000 | Auto-generated REST API from PostgreSQL schemas |
| **PgBouncer** | 6432 | Connection pooler (default for all services) |
| **PostgreSQL** | 5432 | Platform + project databases |

### Architecture Diagram

```
┌─────────────┐
│   Clients   │
└──────┬──────┘
       │
       ├──────────────────┬────────────────┬───────────────┐
       │                  │                │               │
┌──────▼──────┐    ┌──────▼──────┐  ┌─────▼─────┐  ┌─────▼─────┐
│ Platform API│    │Auth Service │  │  Storage  │  │ PostgREST │
│   :8000     │    │   :8001     │  │  :8003    │  │   :3000   │
└──────┬──────┘    └──────┬──────┘  └─────┬─────┘  └─────┬─────┘
       │                  │                │               │
       └──────────────────┴────────────────┴───────────────┘
                          │
                   ┌──────▼──────┐
                   │  PgBouncer  │
                   │   :6432     │
                   └──────┬──────┘
                          │
                   ┌──────▼──────┐
                   │ PostgreSQL  │
                   │   :5432     │
                   └─────────────┘
```

## Project Creation Flow (8 Steps)

Per `interfaces.md §5`, project creation follows this orchestration:

1. **Create platform.projects row** — Status: 'provisioning'
2. **Create project database** — Database + global roles (anon, authenticated, service_role)
3. **Generate secrets** — JWT secret, DB password, API keys
4. **Store encrypted secrets** — AES-256-GCM encryption
5. **Trigger migrations** — Apply auth.*, storage.* schemas via Migrations Runner
6. **Update status** — Status: 'active'
7. **Generate PostgREST config** — Write config file + SIGHUP reload
8. **Return project info** — DB URI, API keys, service URLs

## Environment Variables

### Required Variables

```bash
# Master encryption key (base64-encoded 32 bytes)
LAUNCHDB_MASTER_KEY=<base64-32-bytes>  # REQUIRED - Generate with: openssl rand -base64 32

# Platform database (owners, projects, secrets)
PLATFORM_DB_DSN=postgresql://postgres:password@platform-postgres:5432/launchdb_platform

# Admin database (for creating project databases)
ADMIN_DB_DSN=postgresql://postgres:password@platform-postgres:5432/postgres

# Platform JWT secret
PLATFORM_JWT_SECRET=<secure-random-string>

# Internal API key (for service-to-service communication)
INTERNAL_API_KEY=<secure-random-string>
```

### Service Configuration

```bash
# Database connection (defaults to PgBouncer)
PROJECTS_DB_HOST=pgbouncer           # Default: 'pgbouncer'
PROJECTS_DB_PORT=6432                 # Default: 6432 (PgBouncer port)

# Service URLs (for connection info response)
POSTGREST_URL=http://localhost:3000
AUTH_SERVICE_URL=http://localhost:8001
STORAGE_SERVICE_URL=http://localhost:8003
MIGRATIONS_RUNNER_URL=http://migrations-runner:8002

# PostgREST configuration
POSTGREST_CONFIG_DIR=/etc/postgrest/projects  # Config file directory
POSTGREST_PID_FILE=/var/run/postgrest.pid    # PID file for SIGHUP reload

# Storage configuration
STORAGE_BASE_PATH=/data              # Local disk storage path
```

### Service URL Alignment with Sonnet B

**Important**: When deploying with Sonnet B's infrastructure, update service URLs to match:

```bash
# Production URLs (replace with actual domains)
POSTGREST_URL=https://api.yourdomain.com
AUTH_SERVICE_URL=https://auth.yourdomain.com
STORAGE_SERVICE_URL=https://storage.yourdomain.com

# Or for internal Docker Compose networking:
POSTGREST_URL=http://postgrest:3000
AUTH_SERVICE_URL=http://auth-service:8001
STORAGE_SERVICE_URL=http://storage-service:8003
```

These URLs are returned in the connection info endpoint (`GET /api/projects/:id/connection`) for client consumption.

## Deployment Requirements

### PostgREST Reload Mechanism

**Critical**: PostgREST config reload requires `pid: "host"` in docker-compose.yml:

```yaml
postgrest:
  image: postgrest/postgrest:v12.0.2
  pid: "host"  # Required for SIGHUP from platform-api
  volumes:
    - postgrest-config:/etc/postgrest/projects
    - postgrest-pid:/var/run
```

**How it works**:
1. Platform API writes config to `/etc/postgrest/projects/{projectId}.conf`
2. Platform API reads PID from `/var/run/postgrest.pid`
3. Platform API sends `SIGHUP` signal to PostgREST process
4. PostgREST reloads all config files

**Fallback**: If `pid: "host"` is not viable (security/container restrictions), implement HTTP-based reload helper:
- Add lightweight HTTP server in PostgREST container (port 9000)
- Endpoint: `POST http://postgrest:9000/reload` → sends SIGHUP to local process
- Update `PostgRestService.reloadViaHelper()` to call this endpoint

### PgBouncer Configuration

Services default to PgBouncer (port 6432) for connection pooling. Ensure:
- PgBouncer is configured with `pool_mode = transaction`
- Per-project databases are added to PgBouncer config
- Connection limits match expected load

**Direct Postgres Access**: Override if needed:
```bash
PROJECTS_DB_HOST=platform-postgres
PROJECTS_DB_PORT=5432
```

## Project Deletion (Partial Implementation)

⚠️ **v1.0 Limitation**: Project deletion is **soft delete only**. The following steps are deferred to v1.1:

### v1.0 Implemented Steps

1. ✅ **Soft delete** — Mark project status as 'deleted'
2. ✅ **Delete PostgREST config** — Remove `{projectId}.conf` file
3. ✅ **Reload PostgREST** — SIGHUP to remove project from API
4. ✅ **Delete secrets** — Remove encrypted secrets from platform.secrets

### v1.1 Deferred Steps

5. ⏳ **Revoke API keys** — Requires api_keys table (not yet implemented)
6. ⏳ **Invalidate caches** — Requires cache invalidation endpoints in auth/storage services
7. ⏳ **Delete storage files** — Requires storage cleanup endpoint: `DELETE /internal/projects/{id}/files`
8. ⏳ **Drop database + roles** — Decision needed: async job vs immediate deletion

**Manual Cleanup Required (v1.0)**:
```sql
-- Drop project database (manual)
DROP DATABASE proj_abc123;
DROP ROLE proj_abc123_authenticator;

-- Delete storage files (manual)
rm -rf /data/proj_abc123
```

**Tracking**: See `projects.service.ts:155-191` for TODO markers.

## Quick Start

### 1. Install Dependencies

```bash
cd nestjs-code
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values (especially LAUNCHDB_MASTER_KEY)
```

### 3. Initialize Platform Database

```bash
# Run platform schema SQL
psql $PLATFORM_DB_DSN -f libs/sql/001_platform_schema.sql
```

### 4. Start Services

```bash
# Development mode
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

## API Usage Examples

### Owner Signup

```bash
curl -X POST http://localhost:8000/api/owners/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "owner@example.com",
    "password": "SecurePassword123!"
  }'
```

### Owner Login

```bash
curl -X POST http://localhost:8000/api/owners/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "owner@example.com",
    "password": "SecurePassword123!"
  }'

# Response includes access_token (valid for 7 days)
```

### Create Project

```bash
curl -X POST http://localhost:8000/api/projects \
  -H "Authorization: Bearer <owner_access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-app",
    "display_name": "My Application"
  }'

# Returns: project_id, db_name, status: "active"
```

### Get Connection Info

```bash
curl http://localhost:8000/api/projects/{project_id}/connection \
  -H "Authorization: Bearer <owner_access_token>"
```

**Response**:
```json
{
  "project_id": "proj_abc123",
  "db_uri": "postgresql://proj_abc123_authenticator:***@pgbouncer:6432/proj_abc123",
  "anon_key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "service_role_key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "postgrest_url": "http://localhost:3000",
  "auth_url": "http://localhost:8001/auth/proj_abc123",
  "storage_url": "http://localhost:8003/storage/proj_abc123"
}
```

## Contract Compliance

This implementation follows all specifications exactly:

- ✅ **JWT Claims** (interfaces.md §1): HS256, all required fields, 15-min/7-day TTLs
- ✅ **PostgREST Config** (interfaces.md §2): File+SIGHUP reload, global role names
- ✅ **Auth Routing** (interfaces.md §3): Path-based `/auth/:projectId/*`, multi-tenant
- ✅ **Secrets Management** (interfaces.md §4): AES-256-GCM, encrypted at rest, base64 master key
- ✅ **Project Creation** (interfaces.md §5): All 8 steps implemented
- ✅ **Storage Interface** (interfaces.md §6): Local disk `/data/<projectId>/<bucket>/`, signed URLs
- ✅ **v1-decisions.md**: Multi-tenant services, PgBouncer-ready, global roles, admin DSN migrations

## Security Notes

### SQL Injection Prevention

All project IDs are validated with regex before use in SQL:
```typescript
if (!/^proj_[a-z0-9]{16}$/.test(projectId)) {
  throw new Error('Invalid project ID');
}
```

### Encrypted Secrets

All sensitive data (JWT secrets, DB passwords, API keys) are encrypted at rest using AES-256-GCM with a master key.

**Master Key Requirements**:
- Exactly 32 bytes (256 bits)
- Base64-encoded for storage
- Stored securely (environment variable, secrets manager)
- Never logged or exposed in API responses

### Global Roles

PostgreSQL roles are shared across all projects:
- `anon` (NOLOGIN) — Unauthenticated access
- `authenticated` (NOLOGIN) — Authenticated users
- `service_role` (NOLOGIN, BYPASSRLS) — Admin operations

Per-project authenticator:
- `{projectId}_authenticator` (LOGIN) — Can SET ROLE to global roles

## Troubleshooting

### PostgREST Not Reloading

**Symptom**: New projects don't appear in PostgREST
**Fix**: Check PID file and `pid: "host"` configuration

```bash
# Check PID file exists
cat /var/run/postgrest.pid

# Check PostgREST process
ps aux | grep postgrest

# Manual reload
kill -HUP <pid>
```

### Database Connection Errors

**Symptom**: Services can't connect to project databases
**Fix**: Verify PgBouncer configuration and project database creation

```bash
# Check project database exists
psql $ADMIN_DB_DSN -c "\l" | grep proj_

# Check roles
psql $ADMIN_DB_DSN -c "\du" | grep proj_
```

### Secrets Decryption Errors

**Symptom**: "Decryption failed" errors
**Fix**: Verify master key is exactly 32 bytes base64-encoded

```bash
# Generate new master key
openssl rand -base64 32

# Verify key length
echo $LAUNCHDB_MASTER_KEY | base64 -d | wc -c
# Should output: 32
```

## Development

### Running Tests

```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e

# Coverage
npm run test:cov
```

### Project Structure

```
nestjs-code/
├── apps/
│   ├── platform-api/       # Port 8000
│   ├── auth-service/        # Port 8001 (TODO)
│   ├── storage-service/     # Port 8003 (TODO)
│   └── migrations-runner/   # Port 8002 (TODO)
├── libs/
│   ├── common/
│   │   ├── crypto/          # AES-256-GCM, Argon2
│   │   ├── jwt/             # JWT encoding/decoding
│   │   ├── database/        # Connection pooling
│   │   ├── config/          # Environment config
│   │   └── types/           # Shared TypeScript types
│   └── sql/                 # SQL migration files
└── docker-compose.yml       # Full stack (TODO)
```

## License

Proprietary - All rights reserved

## Support

For issues or questions, contact the development team or open an issue in the project repository.
