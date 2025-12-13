# Environment Variables Documentation

This document describes all environment variables used by LaunchDB's NestJS services.

## Required Variables

These variables MUST be set in production:

| Variable | Description | Example |
|----------|-------------|---------|
| `LAUNCHDB_MASTER_KEY` | Base64-encoded 32-byte key for encrypting secrets | `base64-encoded-key-here` |
| `PLATFORM_DB_DSN` | PostgreSQL connection string for platform database | `postgresql://user:pass@localhost:5432/platform` |
| `ADMIN_DB_DSN` | PostgreSQL admin connection string for creating project databases | `postgresql://postgres:pass@localhost:5432/postgres` |
| `JWT_SECRET` | Secret for signing platform owner JWT tokens | `your-secure-random-string` |
| `INTERNAL_API_KEY` | Shared secret for internal service-to-service communication | `your-internal-api-key` |

---

## Database Configuration

### `PLATFORM_DB_DSN`

**Type:** String (PostgreSQL connection string)
**Required:** Yes
**Default:** None

**Description:** Connection string for the platform database where owners, projects, and secrets are stored.

**Format:**
```
postgresql://[user]:[password]@[host]:[port]/[database]
```

**Example:**
```bash
PLATFORM_DB_DSN=postgresql://platform_user:secure_password@postgres:5432/platform
```

**Used by:** Platform API, Migrations Runner

---

### `ADMIN_DB_DSN`

**Type:** String (PostgreSQL connection string)
**Required:** Yes
**Default:** None

**Description:** Admin-level PostgreSQL connection string with permissions to create databases and roles. Used during project creation to set up per-project databases.

**Format:**
```
postgresql://[admin_user]:[password]@[host]:[port]/postgres
```

**Example:**
```bash
ADMIN_DB_DSN=postgresql://postgres:admin_password@postgres:5432/postgres
```

**Permissions Required:**
- `CREATE DATABASE`
- `CREATE ROLE`
- `GRANT` privileges

**Used by:** Platform API (project creation)

---

### `PROJECTS_DB_HOST`

**Type:** String
**Required:** No
**Default:** `pgbouncer`

**Description:** Hostname for connecting to per-project databases. Points to PgBouncer for connection pooling.

**Example:**
```bash
PROJECTS_DB_HOST=pgbouncer
```

**Used by:** Auth Service, Storage Service, Migrations Runner

---

### `PROJECTS_DB_PORT`

**Type:** Integer
**Required:** No
**Default:** `6432`

**Description:** Port for connecting to per-project databases via PgBouncer.

**Example:**
```bash
PROJECTS_DB_PORT=6432
```

**Note:** Standard PostgreSQL port is 5432. PgBouncer typically runs on 6432.

**Used by:** Auth Service, Storage Service, Migrations Runner

---

## Security Configuration

### `LAUNCHDB_MASTER_KEY`

**Type:** String (Base64-encoded)
**Required:** Yes
**Default:** None

**Description:** Master encryption key for AES-256-GCM encryption of secrets stored in the platform database. This key encrypts JWT secrets, database passwords, and API keys.

**Format:** Base64-encoded 32 bytes (256 bits)

**Generation:**
```bash
# Generate a secure random key
openssl rand -base64 32
```

**Example:**
```bash
LAUNCHDB_MASTER_KEY=6K8/sN5vT9mR2pL4cX7yB3nH8wE1qA5jF4gD9kM0vZ8=
```

**Security:**
- Store securely (never commit to version control)
- Rotate periodically
- Losing this key means losing access to all encrypted secrets

**Used by:** Platform API (for encrypting/decrypting secrets)

---

### `INTERNAL_API_KEY`

**Type:** String
**Required:** Yes
**Default:** `change-me-in-production` (insecure!)

**Description:** Shared secret for authenticating internal service-to-service communication. Used in `X-Internal-API-Key` header.

**Generation:**
```bash
# Generate a secure random key
openssl rand -hex 32
```

**Example:**
```bash
INTERNAL_API_KEY=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
```

**Used by:**
- Platform API → Migrations Runner
- Platform API → Manager API

**Security:** Keep secret, never expose to clients

---

### `JWT_SECRET`

**Type:** String
**Required:** Yes
**Default:** `platform-secret-change-me` (insecure!)

**Description:** Secret for signing JWT tokens issued to platform owners (dashboard users).

**Generation:**
```bash
# Generate a secure random string
openssl rand -base64 64
```

**Example:**
```bash
JWT_SECRET=Hs8Kq3Nv9Rz2Bm7Cw1Xp6Yt4Jf0Lg5De8Pn3Qu7Am2Sv9Wk6
```

**Used by:** Platform API (owner authentication)

**Note:** This is separate from per-project JWT secrets which are stored in the secrets table.

---

## Service Ports

### `PLATFORM_API_PORT`

**Type:** Integer
**Required:** No
**Default:** `8000`

**Description:** HTTP port for the Platform API service.

**Example:**
```bash
PLATFORM_API_PORT=8000
```

**Endpoints:** Owner auth, project management, PostgREST proxy

---

### `AUTH_SERVICE_PORT`

**Type:** Integer
**Required:** No
**Default:** `8001`

**Description:** HTTP port for the Auth Service.

**Example:**
```bash
AUTH_SERVICE_PORT=8001
```

**Endpoints:** Per-project user authentication

---

### `MIGRATIONS_RUNNER_PORT`

**Type:** Integer
**Required:** No
**Default:** `8002`

**Description:** HTTP port for the Migrations Runner service.

**Example:**
```bash
MIGRATIONS_RUNNER_PORT=8002
```

**Endpoints:** Internal migration execution

---

### `STORAGE_SERVICE_PORT`

**Type:** Integer
**Required:** No
**Default:** `8003`

**Description:** HTTP port for the Storage Service.

**Example:**
```bash
STORAGE_SERVICE_PORT=8003
```

**Endpoints:** Per-project file storage

---

## Service URLs

These URLs are returned in the Platform API's "Get Connection Info" response for client configuration.

### `POSTGREST_URL`

**Type:** String (URL)
**Required:** No
**Default:** `http://localhost:3000`

**Description:** Base URL for accessing PostgREST instances. Clients use this URL + project ID path.

**Example:**
```bash
POSTGREST_URL=http://localhost:8000/db
```

**Client Usage:**
```javascript
// Client connects to PostgREST via Platform API proxy
const url = `${POSTGREST_URL}/${projectId}/table_name`;
```

---

### `AUTH_SERVICE_URL`

**Type:** String (URL)
**Required:** No
**Default:** `http://localhost:8001`

**Description:** Base URL for the Auth Service.

**Example:**
```bash
AUTH_SERVICE_URL=http://localhost:8001
```

**Client Usage:**
```javascript
// Client authenticates with Auth Service
const url = `${AUTH_SERVICE_URL}/auth/${projectId}/login`;
```

---

### `STORAGE_SERVICE_URL`

**Type:** String (URL)
**Required:** No
**Default:** `http://localhost:8003`

**Description:** Base URL for the Storage Service.

**Example:**
```bash
STORAGE_SERVICE_URL=http://localhost:8003
```

**Client Usage:**
```javascript
// Client uploads to Storage Service
const url = `${STORAGE_SERVICE_URL}/storage/${projectId}/bucket/path`;
```

---

### `MIGRATIONS_RUNNER_URL`

**Type:** String (URL)
**Required:** No
**Default:** `http://migrations-runner:8002`

**Description:** Internal URL for the Migrations Runner service. Used by Platform API during project creation.

**Example:**
```bash
MIGRATIONS_RUNNER_URL=http://migrations-runner:8002
```

**Note:** This is an internal URL (not exposed to clients)

---

### `POSTGREST_MANAGER_URL`

**Type:** String (URL)
**Required:** No
**Default:** `http://postgrest-manager:9000`

**Description:** Internal URL for the PostgREST Manager service. Used by Platform API to start/stop PostgREST containers.

**Example:**
```bash
POSTGREST_MANAGER_URL=http://postgrest-manager:9000
```

**Note:** This is an internal URL (not exposed to clients)

---

## Storage Configuration

### `STORAGE_BASE_PATH`

**Type:** String (filesystem path)
**Required:** No
**Default:** `/data`

**Description:** Base filesystem path for storing uploaded files.

**Example:**
```bash
STORAGE_BASE_PATH=/var/lib/launchdb/storage
```

**Structure:**
```
/var/lib/launchdb/storage/
├── proj_xxx/
│   ├── bucket1/
│   │   └── file.jpg
│   └── bucket2/
│       └── document.pdf
└── proj_yyy/
    └── bucket1/
        └── image.png
```

**Permissions:** Ensure the service has read/write access to this directory

**Used by:** Storage Service

---

### `BASE_URL`

**Type:** String (URL)
**Required:** No
**Default:** `http://localhost:8003`

**Description:** Public base URL for the Storage Service. Used to generate file access URLs.

**Example:**
```bash
BASE_URL=https://storage.yourdomain.com
```

**Usage:** File URLs are generated as `${BASE_URL}/storage/${projectId}/${bucket}/${path}`

**Used by:** Storage Service

---

## PostgREST Configuration

### `POSTGREST_CONFIG_DIR`

**Type:** String (filesystem path)
**Required:** No
**Default:** `/etc/postgrest/projects`

**Description:** Directory where per-project PostgREST configuration files are stored.

**Example:**
```bash
POSTGREST_CONFIG_DIR=/etc/postgrest/projects
```

**Structure:**
```
/etc/postgrest/projects/
├── proj_xxx.conf
├── proj_yyy.conf
└── proj_zzz.conf
```

**Used by:** Platform API (config generation)

---

### `POSTGREST_PID_FILE`

**Type:** String (filesystem path)
**Required:** No
**Default:** `/var/run/postgrest.pid`

**Description:** Path to PostgREST PID file for signal handling (SIGHUP for config reload).

**Example:**
```bash
POSTGREST_PID_FILE=/var/run/postgrest.pid
```

**Used by:** Platform API (PostgREST management)

---

## CORS Configuration

### `CORS_ORIGIN`

**Type:** String
**Required:** No
**Default:** `*`

**Description:** Allowed origins for Cross-Origin Resource Sharing (CORS).

**Examples:**
```bash
# Development (allow all)
CORS_ORIGIN=*

# Production (specific domains)
CORS_ORIGIN=https://app.yourdomain.com,https://admin.yourdomain.com

# Multiple origins (comma-separated)
CORS_ORIGIN=https://example.com,https://app.example.com
```

**Used by:** Auth Service, Storage Service

**Security:** Set specific domains in production, never use `*` in production!

---

## Environment File Examples

### Development (.env.development)

```bash
# Database
PLATFORM_DB_DSN=postgresql://platform:dev_password@localhost:5432/platform
ADMIN_DB_DSN=postgresql://postgres:admin_pass@localhost:5432/postgres
PROJECTS_DB_HOST=localhost
PROJECTS_DB_PORT=6432

# Security (INSECURE - for development only!)
LAUNCHDB_MASTER_KEY=dev_master_key_base64_32_bytes_here==
INTERNAL_API_KEY=dev-internal-api-key
JWT_SECRET=dev-platform-jwt-secret

# Service Ports
PLATFORM_API_PORT=8000
AUTH_SERVICE_PORT=8001
MIGRATIONS_RUNNER_PORT=8002
STORAGE_SERVICE_PORT=8003

# Service URLs
POSTGREST_URL=http://localhost:8000/db
AUTH_SERVICE_URL=http://localhost:8001
STORAGE_SERVICE_URL=http://localhost:8003
MIGRATIONS_RUNNER_URL=http://localhost:8002
POSTGREST_MANAGER_URL=http://localhost:9000

# Storage
STORAGE_BASE_PATH=/tmp/launchdb-storage
BASE_URL=http://localhost:8003

# PostgREST
POSTGREST_CONFIG_DIR=/tmp/postgrest-configs
POSTGREST_PID_FILE=/tmp/postgrest.pid

# CORS (allow all for development)
CORS_ORIGIN=*
```

---

### Production (.env.production)

```bash
# Database
PLATFORM_DB_DSN=postgresql://platform_prod:${DB_PASSWORD}@postgres.internal:5432/platform?sslmode=require
ADMIN_DB_DSN=postgresql://postgres:${ADMIN_PASSWORD}@postgres.internal:5432/postgres?sslmode=require
PROJECTS_DB_HOST=pgbouncer.internal
PROJECTS_DB_PORT=6432

# Security (REPLACE WITH REAL SECRETS!)
LAUNCHDB_MASTER_KEY=${MASTER_KEY_FROM_VAULT}
INTERNAL_API_KEY=${INTERNAL_KEY_FROM_VAULT}
JWT_SECRET=${JWT_SECRET_FROM_VAULT}

# Service Ports (internal network)
PLATFORM_API_PORT=8000
AUTH_SERVICE_PORT=8001
MIGRATIONS_RUNNER_PORT=8002
STORAGE_SERVICE_PORT=8003

# Service URLs (public-facing)
POSTGREST_URL=https://api.yourdomain.com/db
AUTH_SERVICE_URL=https://auth.yourdomain.com
STORAGE_SERVICE_URL=https://storage.yourdomain.com
MIGRATIONS_RUNNER_URL=http://migrations-runner.internal:8002
POSTGREST_MANAGER_URL=http://postgrest-manager.internal:9000

# Storage
STORAGE_BASE_PATH=/var/lib/launchdb/storage
BASE_URL=https://storage.yourdomain.com

# PostgREST
POSTGREST_CONFIG_DIR=/etc/postgrest/projects
POSTGREST_PID_FILE=/var/run/postgrest.pid

# CORS (specific domains only!)
CORS_ORIGIN=https://yourdomain.com,https://app.yourdomain.com
```

---

## Security Best Practices

### Secrets Management

1. **Never commit secrets to version control**
   - Use `.env` files (add to `.gitignore`)
   - Use secret management services (AWS Secrets Manager, HashiCorp Vault)

2. **Generate strong random values**
   ```bash
   # Master key (32 bytes, base64)
   openssl rand -base64 32

   # API keys (64 characters, hex)
   openssl rand -hex 32

   # JWT secret (secure random string)
   openssl rand -base64 64
   ```

3. **Rotate secrets regularly**
   - Master key: Every 90 days
   - Internal API key: Every 90 days
   - JWT secrets: Every 180 days

4. **Use environment-specific secrets**
   - Different secrets for dev, staging, production
   - Never use development secrets in production

### Database Security

1. **Use strong passwords**
   - Minimum 20 characters
   - Mix of uppercase, lowercase, numbers, symbols

2. **Enable SSL/TLS**
   - Add `?sslmode=require` to connection strings
   - Use certificates for mutual TLS

3. **Principle of least privilege**
   - Platform user: Only platform database access
   - Admin user: Only for database creation
   - Project users: Only their project database

### Network Security

1. **Internal services**
   - Use private network for service-to-service communication
   - Don't expose Migrations Runner or Manager API publicly

2. **CORS configuration**
   - Never use `*` in production
   - List specific allowed domains

3. **HTTPS only**
   - Use TLS certificates
   - Redirect HTTP to HTTPS
   - Enable HSTS headers

---

## Troubleshooting

### "Connection refused" errors

**Check:**
- Service is running: `docker ps`
- Port is correct: `PLATFORM_API_PORT=8000`
- Hostname is correct: `localhost` vs `0.0.0.0` vs container name

**Solution:**
```bash
# Test connection
curl http://localhost:8000/health
```

---

### "Invalid master key" errors

**Cause:** `LAUNCHDB_MASTER_KEY` is incorrect or not base64-encoded

**Solution:**
```bash
# Generate new key
NEW_KEY=$(openssl rand -base64 32)
echo "LAUNCHDB_MASTER_KEY=$NEW_KEY"

# Update .env and restart services
```

---

### "Database does not exist" errors

**Check:**
- `PLATFORM_DB_DSN` points to existing database
- Platform database schema is initialized

**Solution:**
```bash
# Create platform database
psql -U postgres -c "CREATE DATABASE platform;"

# Run platform schema migration
psql -U postgres -d platform -f libs/sql/001_platform_schema.sql
```

---

### "Permission denied" errors

**Cause:** Database user lacks required permissions

**Solution:**
```bash
# Grant permissions to platform user
psql -U postgres -c "GRANT ALL ON DATABASE platform TO platform_user;"
psql -U postgres -d platform -c "GRANT USAGE ON SCHEMA platform TO platform_user;"
psql -U postgres -d platform -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO platform_user;"
```

---

## See Also

- [Platform API Documentation](./platform-api.md) - API endpoints
- [Auth Service Documentation](./auth-service.md) - Authentication
- [Storage Service Documentation](./storage-service.md) - File storage
- [Migrations Service Documentation](./migrations-service.md) - Schema management
- [Database Schema](./database-schema.md) - Database structure
