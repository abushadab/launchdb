# Infrastructure Environment Variables

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Required Variables](#required-variables)
  - [Database Configuration](#database-configuration)
  - [Security & Encryption](#security--encryption)
  - [Domain & TLS](#domain--tls)
  - [Manager API Paths](#manager-api-paths)
- [Optional Variables](#optional-variables)
  - [SMTP / Email](#smtp--email)
  - [Storage Configuration](#storage-configuration)
  - [Authentication & Session](#authentication--session)
  - [Backup Configuration](#backup-configuration)
  - [Logging & Debugging](#logging--debugging)
- [Advanced Configuration](#advanced-configuration)
  - [PostgreSQL Tuning](#postgresql-tuning)
  - [Connection Pooling](#connection-pooling)
  - [Container Ports](#container-ports)
- [Security Best Practices](#security-best-practices)
- [Environment-Specific Examples](#environment-specific-examples)
- [Validation & Troubleshooting](#validation--troubleshooting)

## Overview

LaunchDB infrastructure services are configured via environment variables defined in `.env` file. This document covers all infrastructure-related variables for:

- PostgreSQL database
- PgBouncer connection pooler
- Manager API (PostgREST orchestration)
- Reverse proxy (Caddy)
- Backup service

**Platform service variables** (Platform API, Auth, Storage, Migrations) are documented separately in `/docs/platform-env-vars.md`.

## Quick Start

```bash
# 1. Copy example environment file
cp .env.example .env

# 2. Generate secure random keys
export LAUNCHDB_MASTER_KEY=$(openssl rand -base64 32)
export PLATFORM_JWT_SECRET=$(openssl rand -base64 32)
export POSTGREST_JWT_SECRET=$(openssl rand -base64 32)
export INTERNAL_API_KEY=$(openssl rand -hex 32)
export POSTGREST_ADMIN_KEY=$(openssl rand -hex 32)
export BACKUP_ENCRYPTION_KEY=$(openssl rand -base64 32)

# 3. Generate strong database passwords
export POSTGRES_SUPERUSER_PASSWORD=$(openssl rand -base64 24)
export AUTHENTICATOR_PASSWORD=$(openssl rand -base64 24)

# 4. Edit .env and update generated values
vim .env

# 5. Update DOMAIN and ACME_EMAIL with your values

# 6. Set HOST_SCRIPT_DIR and HOST_CONFIG_DIR to absolute paths

# 7. Start infrastructure
docker-compose up -d postgres pgbouncer postgrest-manager
```

## Required Variables

These variables MUST be set for infrastructure services to function correctly. Missing required variables will cause service failures.

### Database Configuration

#### `POSTGRES_SUPERUSER_PASSWORD`

**Required:** Yes
**Service:** PostgreSQL, PgBouncer, Platform API, Migrations, Auth, Storage
**Description:** Password for PostgreSQL superuser account. Used by all services that need database access.

**Security:**
- Must be strong (minimum 16 characters, alphanumeric + symbols recommended)
- Never commit to version control
- Rotate periodically in production

**Example:**
```bash
# Generate secure password
POSTGRES_SUPERUSER_PASSWORD=$(openssl rand -base64 24)

# Or use a custom strong password
POSTGRES_SUPERUSER_PASSWORD="MyStr0ng!P@ssw0rd#2024"
```

**Used By:**
- `postgres` service: `POSTGRES_PASSWORD`
- Platform API: `PLATFORM_DB_DSN` connection string
- Migrations: `ADMIN_DB_DSN` connection string
- Auth service: `PLATFORM_DB_DSN` connection string
- Storage service: `PLATFORM_DB_DSN` connection string

---

#### `POSTGRES_SUPERUSER`

**Required:** No (has default)
**Default:** `postgres`
**Service:** PostgreSQL, all database clients
**Description:** Username for PostgreSQL superuser account.

**Recommendation:** Use default `postgres` unless you have specific compliance requirements.

**Example:**
```bash
POSTGRES_SUPERUSER=postgres  # Default, recommended
```

---

#### `AUTHENTICATOR_PASSWORD`

**Required:** Yes
**Service:** PostgREST (per-project containers)
**Description:** Password for `proj_xxx_authenticator` role used by PostgREST to connect to project databases.

**Security:**
- Different from `POSTGRES_SUPERUSER_PASSWORD`
- Generated and stored by Migrations service when creating project databases
- Unique per project in production (v2 feature)

**Example:**
```bash
# Generate secure password
AUTHENTICATOR_PASSWORD=$(openssl rand -base64 24)
```

**Usage:** Manager API passes this password when spawning PostgREST containers, which use it to connect via PgBouncer.

---

### Security & Encryption

#### `LAUNCHDB_MASTER_KEY`

**Required:** Yes
**Service:** Platform API, Migrations, Auth, Storage
**Description:** Master encryption key for encrypting sensitive data at rest (database passwords, JWT secrets, API keys).

**Security:**
- 32 bytes, base64 encoded
- NEVER change after deployment (will invalidate all encrypted data)
- Store securely (e.g., AWS Secrets Manager, HashiCorp Vault)
- Backup encrypted copy offline

**Example:**
```bash
# Generate (32 bytes = 44 characters base64)
LAUNCHDB_MASTER_KEY=$(openssl rand -base64 32)

# Result: "a8F3k9J2mNpQ7tUvWxYz1BcDeF5gHi6jKlMn0oPq3rSt="
```

**⚠️ CRITICAL WARNING:**
- Losing this key = permanent data loss
- Changing this key = all encrypted data becomes unreadable
- Back up securely before production deployment

---

#### `PLATFORM_JWT_SECRET`

**Required:** Yes
**Service:** Platform API
**Description:** JWT signing secret for Platform API authentication tokens.

**Security:**
- 32 bytes, base64 encoded
- Used to sign and verify JWT tokens for Platform API endpoints
- Changing this invalidates all active Platform API sessions

**Example:**
```bash
# Generate
PLATFORM_JWT_SECRET=$(openssl rand -base64 32)
```

---

#### `POSTGREST_JWT_SECRET`

**Required:** Yes
**Service:** PostgREST (per-project containers)
**Description:** Default JWT secret template for PostgREST instances.

**Note:** In v1, each project gets a unique JWT secret generated at creation time. This variable serves as a fallback/template.

**Security:**
- 32 bytes, base64 encoded
- Per-project secrets stored encrypted in platform database

**Example:**
```bash
# Generate
POSTGREST_JWT_SECRET=$(openssl rand -base64 32)
```

---

#### `INTERNAL_API_KEY`

**Required:** Yes
**Service:** Platform API, Manager API, Migrations
**Description:** Shared secret for internal service-to-service authentication (Platform API → Manager API → Migrations).

**Security:**
- 64 hex characters (32 bytes)
- Not exposed to public internet
- Rotatable via rolling restart

**Example:**
```bash
# Generate (32 bytes = 64 hex characters)
INTERNAL_API_KEY=$(openssl rand -hex 32)

# Result: "a1b2c3d4e5f6..."
```

**Usage:**
- Platform API sends `X-Internal-Key: <INTERNAL_API_KEY>` header to Manager API
- Manager API validates header before executing container operations

---

#### `POSTGREST_ADMIN_KEY`

**Required:** Yes
**Service:** Platform API, PostgREST (per-project containers)
**Description:** Admin-level API key for PostgREST instances, bypassing JWT authentication.

**Security:**
- 64 hex characters (32 bytes)
- Used for administrative operations (schema inspection, configuration)
- Never expose to end users

**Example:**
```bash
# Generate
POSTGREST_ADMIN_KEY=$(openssl rand -hex 32)
```

**Usage:**
- Platform API uses this to verify PostgREST health
- Admin tools use this for schema management

---

#### `BACKUP_ENCRYPTION_KEY`

**Required:** Yes (if using backup service)
**Service:** Backup service
**Description:** GPG passphrase for encrypting database backups before storing/transferring.

**Security:**
- 32 bytes, base64 encoded
- Required to restore backups
- Store offline copy securely

**Example:**
```bash
# Generate
BACKUP_ENCRYPTION_KEY=$(openssl rand -base64 32)
```

**Usage:** Backup service uses this to encrypt `pg_dump` output before writing to disk or transferring via rsync.

---

### Domain & TLS

#### `DOMAIN`

**Required:** Yes
**Service:** Caddy (reverse proxy), Dashboard UI, Manager API
**Description:** Fully qualified domain name for your LaunchDB deployment.

**Format:** `domain.com` or `api.domain.com` (no protocol, no trailing slash)

**Example:**
```bash
# Production
DOMAIN=api.launchdb.io

# Staging
DOMAIN=staging-api.launchdb.io
```

**Usage:**
- Caddy uses this for TLS certificate generation (Let's Encrypt)
- Dashboard UI uses this to construct API URLs
- PostgREST containers use this for OpenAPI spec generation

**DNS Requirements:**
- A record pointing to server IP: `api.launchdb.io → 1.2.3.4`
- Port 80 and 443 accessible from internet (for ACME challenge)

---

#### `ACME_EMAIL`

**Required:** Yes
**Service:** Caddy (reverse proxy)
**Description:** Email address for Let's Encrypt ACME registration and renewal notifications.

**Format:** Valid email address

**Example:**
```bash
ACME_EMAIL=admin@launchdb.io
```

**Usage:**
- Let's Encrypt sends certificate expiration warnings to this email
- Required for production TLS certificates
- Cannot be omitted (Let's Encrypt requirement)

**Recommendation:** Use a monitored email address (not noreply@)

---

### Manager API Paths

**⚠️ CRITICAL:** These variables are **REQUIRED** and have **NO DEFAULTS**. Missing values will cause Manager API to fail spawning PostgREST containers.

#### `HOST_SCRIPT_DIR`

**Required:** Yes (NO DEFAULT)
**Service:** Manager API
**Description:** Absolute path on Docker host where PgBouncer management scripts are located. Used to mount scripts into spawned PostgREST containers.

**Format:** Absolute path (e.g., `/opt/launchdb/scripts`)

**Why Required:** Manager API spawns PostgREST containers with `--volume ${HOST_SCRIPT_DIR}:/scripts:ro` flag. Docker daemon needs absolute host path to mount correctly.

**Example:**
```bash
# Production deployment in /opt
HOST_SCRIPT_DIR=/opt/launchdb/scripts

# Development (relative to repo root)
HOST_SCRIPT_DIR=/path/to/launchdb/infrastructure/scripts

# Custom location
HOST_SCRIPT_DIR=/srv/launchdb/scripts
```

**How to Set:**
```bash
# Determine your deployment directory
pwd
# Output: /opt/launchdb

# Set HOST_SCRIPT_DIR to <deployment_dir>/scripts
HOST_SCRIPT_DIR=/opt/launchdb/scripts
```

**Troubleshooting:**
- **Error:** "cannot mount volume: path does not exist"
  **Cause:** `HOST_SCRIPT_DIR` points to non-existent directory
  **Fix:** Ensure `scripts/` directory exists at specified path on Docker host

---

#### `HOST_CONFIG_DIR`

**Required:** Yes (NO DEFAULT)
**Service:** Manager API
**Description:** Absolute path on Docker host where PostgREST config files are stored. Used to mount per-project configs into PostgREST containers.

**Format:** Absolute path (e.g., `/opt/launchdb/postgrest/projects`)

**Why Required:** Manager API generates config files at `${HOST_CONFIG_DIR}/{projectId}.conf` and mounts them into PostgREST containers at startup.

**Example:**
```bash
# Production
HOST_CONFIG_DIR=/opt/launchdb/postgrest/projects

# Development (relative to repo root)
HOST_CONFIG_DIR=/path/to/launchdb/infrastructure/postgrest/projects
```

**How to Set:**
```bash
# Deployment directory
pwd
# Output: /opt/launchdb

# Set HOST_CONFIG_DIR to <deployment_dir>/postgrest/projects
HOST_CONFIG_DIR=/opt/launchdb/postgrest/projects

# Create directory if it doesn't exist
mkdir -p /opt/launchdb/postgrest/projects
```

**File Permissions:**
- Directory must be readable by Manager API container
- Manager API writes config files as root user
- PostgREST containers read config files as postgrest user

---

## Optional Variables

These variables have sensible defaults but can be customized for your deployment.

### SMTP / Email

**Purpose:** Auth service sends transactional emails (password reset, email verification). If SMTP is not configured, email features will be disabled.

#### `SMTP_HOST`

**Required:** No
**Default:** `localhost`
**Service:** Auth service
**Description:** SMTP server hostname for sending emails.

**Example:**
```bash
# Production (SendGrid)
SMTP_HOST=smtp.sendgrid.net

# Production (AWS SES)
SMTP_HOST=email-smtp.us-east-1.amazonaws.com

# Development (Mailhog)
SMTP_HOST=mailhog
```

---

#### `SMTP_PORT`

**Required:** No
**Default:** `1025`
**Service:** Auth service
**Description:** SMTP server port.

**Common Ports:**
- `25` - Unencrypted SMTP (not recommended)
- `587` - STARTTLS (recommended for production)
- `465` - SMTPS (deprecated, use 587)
- `1025` - Mailhog/Mailtrap (development)

**Example:**
```bash
# Production (STARTTLS)
SMTP_PORT=587

# Development (Mailhog)
SMTP_PORT=1025
```

---

#### `SMTP_USER`

**Required:** No
**Default:** None
**Service:** Auth service
**Description:** SMTP authentication username.

**Example:**
```bash
# SendGrid
SMTP_USER=apikey

# AWS SES
SMTP_USER=AKIAIOSFODNN7EXAMPLE

# Gmail
SMTP_USER=noreply@launchdb.io
```

---

#### `SMTP_PASSWORD`

**Required:** No
**Default:** None
**Service:** Auth service
**Description:** SMTP authentication password or API key.

**Security:** Store securely, never commit to version control.

**Example:**
```bash
# SendGrid API key
SMTP_PASSWORD=SG.xxxxxxxxxxxxxxxxxxxx

# AWS SES credentials
SMTP_PASSWORD=Ahj...example...key
```

---

#### `SMTP_FROM`

**Required:** No
**Default:** `noreply@launchdb.local`
**Service:** Auth service
**Description:** "From" email address for outgoing emails.

**Format:** Valid email address

**Example:**
```bash
SMTP_FROM=noreply@launchdb.io
```

**Recommendation:** Use a dedicated noreply address or support address that matches your domain.

---

### Storage Configuration

#### `STORAGE_PATH`

**Required:** No
**Default:** `/var/lib/launchdb/storage`
**Service:** Storage service
**Description:** Container path for storing uploaded files.

**Note:** This is the path **inside** the container. Host path is configured via Docker volume mount in `docker-compose.yml`.

**Example:**
```bash
# Default (recommended)
STORAGE_PATH=/var/lib/launchdb/storage
```

**Disk Space Planning:**
- Estimate: `(Number of projects) × (Average files per project) × (Average file size)`
- Example: 100 projects × 100 files × 5MB = 50GB
- Provision accordingly in Docker volume

---

#### `MAX_FILE_SIZE_MB`

**Required:** No
**Default:** `50`
**Service:** Storage service
**Description:** Maximum file upload size in megabytes.

**Constraints:**
- Must be ≤ reverse proxy limit (Caddy default: 10GB)
- Consider disk space availability

**Example:**
```bash
# Restrict uploads to 10MB
MAX_FILE_SIZE_MB=10

# Allow large uploads (100MB)
MAX_FILE_SIZE_MB=100
```

---

#### `SIGNED_URL_TTL`

**Required:** No
**Default:** `3600` (1 hour)
**Service:** Storage service
**Description:** Time-to-live (TTL) for signed URLs in seconds.

**Use Case:** Storage service generates signed URLs for secure file downloads. TTL determines how long the URL remains valid.

**Example:**
```bash
# 15 minutes
SIGNED_URL_TTL=900

# 24 hours
SIGNED_URL_TTL=86400
```

**Security Consideration:** Shorter TTLs increase security but may break long-running downloads.

---

### Authentication & Session

#### `CACHE_TTL_SECONDS`

**Required:** No
**Default:** `300` (5 minutes)
**Service:** Auth service
**Description:** Cache TTL for session validation lookups.

**Example:**
```bash
# 10 minutes
CACHE_TTL_SECONDS=600
```

---

#### `ACCESS_TOKEN_TTL`

**Required:** No
**Default:** `900` (15 minutes)
**Service:** Auth service
**Description:** Access token lifetime in seconds.

**Example:**
```bash
# 1 hour
ACCESS_TOKEN_TTL=3600
```

---

#### `REFRESH_TOKEN_TTL`

**Required:** No
**Default:** `604800` (7 days)
**Service:** Auth service
**Description:** Refresh token lifetime in seconds.

**Example:**
```bash
# 30 days
REFRESH_TOKEN_TTL=2592000
```

---

### Backup Configuration

#### `BACKUP_RETENTION_DAYS`

**Required:** No
**Default:** `7`
**Service:** Backup service
**Description:** Number of days to retain backups before automatic deletion.

**Example:**
```bash
# Keep backups for 30 days
BACKUP_RETENTION_DAYS=30
```

**Disk Space:** Estimate `(Database size) × (Backup retention days)` for volume size.

---

#### `RSYNC_DEST`

**Required:** No
**Default:** None (local backups only)
**Service:** Backup service
**Description:** Remote rsync destination for offsite backup copies.

**Format:** `user@host:/path`

**Example:**
```bash
# Remote server
RSYNC_DEST=backup-user@backup.example.com:/var/backups/launchdb

# AWS S3 (via s3fs mount)
RSYNC_DEST=/mnt/s3-backups/launchdb
```

**Setup:**
1. Configure SSH key authentication (no password prompts)
2. Place SSH private key at `./backup/ssh/backup_key`
3. Set `RSYNC_DEST` in `.env`
4. Test: `docker exec launchdb-backup rsync -avz /backups/ $RSYNC_DEST`

---

#### `RSYNC_SSH_KEY_PATH`

**Required:** No
**Default:** `/root/.ssh/backup_key`
**Service:** Backup service
**Description:** Container path to SSH private key for rsync authentication.

**Setup:**
```bash
# Generate SSH key pair
ssh-keygen -t ed25519 -f ./backup/ssh/backup_key -N ""

# Add public key to remote server
ssh-copy-id -i ./backup/ssh/backup_key.pub backup-user@backup.example.com

# Set permissions
chmod 600 ./backup/ssh/backup_key
```

---

### Logging & Debugging

#### `LOG_LEVEL`

**Required:** No
**Default:** `info`
**Service:** All NestJS services (Platform API, Auth, Storage, Migrations)
**Description:** Log verbosity level.

**Options:** `error`, `warn`, `info`, `debug`

**Example:**
```bash
# Production
LOG_LEVEL=info

# Development/Debugging
LOG_LEVEL=debug

# Production (minimal logs)
LOG_LEVEL=warn
```

**Performance Note:** `debug` level significantly increases log volume and may impact performance.

---

#### `NODE_ENV`

**Required:** No
**Default:** `production`
**Service:** All Node.js services
**Description:** Node.js environment mode.

**Options:** `production`, `development`

**Example:**
```bash
# Production
NODE_ENV=production

# Development
NODE_ENV=development
```

**Effects:**
- `production`: Optimized builds, minimal logging, security headers enabled
- `development`: Source maps, verbose errors, hot reload (if supported)

---

## Advanced Configuration

These variables are for advanced use cases and should only be modified if you understand the implications.

### PostgreSQL Tuning

PostgreSQL configuration is set via `command` parameters in `docker-compose.yml` (lines 44-57). These are **not** environment variables but hardcoded arguments.

**Current Configuration:**
```yaml
command:
  - "postgres"
  - "-c"
  - "max_connections=500"           # Total connection limit
  - "-c"
  - "shared_buffers=256MB"          # Memory for caching
  - "-c"
  - "effective_cache_size=1GB"      # OS cache hint
  - "-c"
  - "log_statement=mod"             # Log INSERT/UPDATE/DELETE
  - "-c"
  - "log_min_duration_statement=1000"  # Log queries > 1 second
  - "-c"
  - "password_encryption=md5"       # PgBouncer requires MD5
```

**Key Settings:**

#### `max_connections=500`

**Default:** `100` (PostgreSQL default)
**Current:** `500`
**Description:** Maximum concurrent connections to PostgreSQL.

**Tuning:**
- Current capacity: ~200 active connections (29 projects × 5 pool_size + 55 overhead)
- Headroom: 60%
- Increase if supporting >80 projects

**Formula:** `(Projects × Pool Size) + Platform Overhead < max_connections`

**Example:**
- 50 projects: `50 × 5 + 55 = 305 connections` (needs `max_connections=400`)
- 90 projects: `90 × 5 + 55 = 505 connections` (needs `max_connections=600`)

**Memory Impact:** Each connection uses ~10MB. `500 connections = ~5GB memory`

---

#### `shared_buffers=256MB`

**Default:** `128MB` (PostgreSQL default)
**Current:** `256MB`
**Description:** Memory for database caching.

**Recommendation:** 25% of system RAM, max 8GB
- 2GB RAM VPS: `shared_buffers=512MB`
- 8GB RAM VPS: `shared_buffers=2GB`
- 32GB RAM VPS: `shared_buffers=8GB`

---

#### `effective_cache_size=1GB`

**Default:** `4GB` (PostgreSQL default)
**Current:** `1GB`
**Description:** Hint to query planner about available OS cache.

**Recommendation:** 50-75% of system RAM
- 2GB RAM VPS: `effective_cache_size=1GB`
- 8GB RAM VPS: `effective_cache_size=6GB`

---

#### `password_encryption=md5`

**Default:** `scram-sha-256` (PostgreSQL 14+)
**Current:** `md5`
**Description:** Password hashing algorithm.

**⚠️ CRITICAL:** PgBouncer requires MD5. Do NOT change to `scram-sha-256` or authentication will fail.

---

### Connection Pooling

PgBouncer configuration is managed in `./pgbouncer/pgbouncer.ini`. Key settings:

```ini
[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 25
server_connect_timeout = 30
server_login_retry = 30
```

**Per-Project Pool Size:**

Set via Manager API during project creation. Current default: `5` (configured in `scripts/pgbouncer-add-project.sh`).

**Tuning:**
- Free tier projects: `pool_size=3`
- Paid tier projects: `pool_size=10`
- High-traffic projects: `pool_size=20`

**Change Default Pool Size:**

Edit `./scripts/pgbouncer-add-project.sh` line 8:
```bash
# Before
POOL_SIZE="${2:-5}"

# After (new default: 10)
POOL_SIZE="${2:-10}"
```

**Change Existing Project Pool Size:**

```bash
# 1. Edit /etc/pgbouncer/pgbouncer.ini inside container
docker exec --user root launchdb-pgbouncer vi /etc/pgbouncer/pgbouncer.ini

# 2. Find project entry
# proj_xxx = host=postgres port=5432 dbname=proj_xxx pool_size=5 reserve_pool=2

# 3. Change pool_size (e.g., 5 → 10)
# proj_xxx = host=postgres port=5432 dbname=proj_xxx pool_size=10 reserve_pool=2

# 4. Reload PgBouncer
docker exec launchdb-pgbouncer kill -HUP 1
```

---

### Container Ports

Internal ports are hardcoded in `docker-compose.yml`. Do NOT change unless you understand service dependencies.

| Service | Internal Port | External Port | Description |
|---------|---------------|---------------|-------------|
| postgres | 5432 | 127.0.0.1:5432 | PostgreSQL (localhost only) |
| pgbouncer | 6432 | 127.0.0.1:6432 | PgBouncer (localhost only) |
| platform-api | 8000 | 8000 | Platform API (public) |
| auth-service | 8001 | - | Auth (internal only) |
| migrations | 8002 | - | Migrations (internal only) |
| storage-service | 8003 | - | Storage (internal only) |
| postgrest-manager | 9000 | 9000 | Manager API (internal) |
| reverse-proxy | 80, 443 | 80, 443 | Caddy (public) |

**⚠️ Security Note:** Only reverse-proxy (80, 443) should be exposed to public internet. All other services should be behind firewall or bound to localhost.

---

## Security Best Practices

### 1. Secret Generation

**Always use cryptographically secure random generators:**

```bash
# ✅ GOOD: OpenSSL random generator
LAUNCHDB_MASTER_KEY=$(openssl rand -base64 32)
INTERNAL_API_KEY=$(openssl rand -hex 32)

# ❌ BAD: Predictable or short secrets
LAUNCHDB_MASTER_KEY="password123"
INTERNAL_API_KEY="my-secret-key"
```

### 2. Secret Storage

**Never commit secrets to version control:**

```bash
# Add .env to .gitignore
echo ".env" >> .gitignore

# Verify .env is not tracked
git ls-files | grep .env
# (should return nothing)
```

**Production secret management:**
- Use secret management service (AWS Secrets Manager, HashiCorp Vault)
- Mount secrets as files or environment variables at runtime
- Rotate secrets periodically (quarterly recommended)

### 3. Network Security

**Firewall configuration:**

```bash
# Allow HTTP/HTTPS only
ufw allow 80/tcp
ufw allow 443/tcp

# Block direct database access from internet
ufw deny 5432/tcp
ufw deny 6432/tcp

# Allow SSH (change port if needed)
ufw allow 22/tcp

# Enable firewall
ufw enable
```

### 4. TLS Configuration

**Always use TLS in production:**

```bash
# REQUIRED: Valid domain pointing to server
DOMAIN=api.launchdb.io

# REQUIRED: Email for Let's Encrypt
ACME_EMAIL=admin@launchdb.io
```

**Caddy automatically:**
- Obtains TLS certificates from Let's Encrypt
- Renews certificates before expiration
- Redirects HTTP → HTTPS
- Enables HTTP/2

### 5. Database Security

**Password requirements:**
- Minimum 16 characters
- Alphanumeric + symbols
- Unique per environment (dev, staging, prod)
- Never reuse passwords across services

**Example strong password:**
```bash
# Generate 24-character password (32 bytes base64)
POSTGRES_SUPERUSER_PASSWORD=$(openssl rand -base64 24)
# Result: "a8F3k9J2mNpQ7tUvWxYz1BcDeF5g=="
```

### 6. Backup Security

**Encrypt backups:**

```bash
# REQUIRED for backup service
BACKUP_ENCRYPTION_KEY=$(openssl rand -base64 32)
```

**Backup encryption:**
- All `pg_dump` backups are GPG-encrypted
- Offsite backups transferred via SSH (if `RSYNC_DEST` set)
- Store `BACKUP_ENCRYPTION_KEY` offline securely

**Recovery:**
```bash
# Decrypt backup
gpg --decrypt --passphrase "$BACKUP_ENCRYPTION_KEY" backup.sql.gz.gpg | gunzip > backup.sql
```

### 7. Access Control

**Manager API:**
- Internal-only (port 9000 not exposed to internet)
- Authenticated via `X-Internal-Key` header
- Only accessible from Platform API container

**PostgreSQL:**
- Bound to `127.0.0.1:5432` (localhost only)
- Only accessible via PgBouncer within Docker network

**PgBouncer:**
- Bound to `127.0.0.1:6432` (localhost only)
- Only accessible within Docker network

---

## Environment-Specific Examples

### Development Environment

**Characteristics:**
- Local development machine
- Test data only
- Relaxed security
- Verbose logging
- Local SMTP (Mailhog)

**`.env` example:**
```bash
# Database
POSTGRES_SUPERUSER_PASSWORD=dev_password_not_for_production
POSTGRES_SUPERUSER=postgres
AUTHENTICATOR_PASSWORD=dev_authenticator_password

# Security (dev keys, NOT for production)
LAUNCHDB_MASTER_KEY=$(openssl rand -base64 32)
PLATFORM_JWT_SECRET=$(openssl rand -base64 32)
POSTGREST_JWT_SECRET=$(openssl rand -base64 32)
INTERNAL_API_KEY=$(openssl rand -hex 32)
POSTGREST_ADMIN_KEY=$(openssl rand -hex 32)
BACKUP_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Domain (local)
DOMAIN=localhost
ACME_EMAIL=dev@localhost

# SMTP (Mailhog)
SMTP_HOST=mailhog
SMTP_PORT=1025
SMTP_FROM=dev@localhost

# Logging
LOG_LEVEL=debug
NODE_ENV=development

# Manager API paths (adjust to your local path)
HOST_SCRIPT_DIR=/home/user/launchdb/scripts
HOST_CONFIG_DIR=/home/user/launchdb/postgrest/projects

# Backup (disabled)
BACKUP_RETENTION_DAYS=1
```

---

### Staging Environment

**Characteristics:**
- Cloud VPS
- Production-like configuration
- Real TLS certificates
- Test SMTP (Mailtrap)
- Moderate logging

**`.env` example:**
```bash
# Database
POSTGRES_SUPERUSER_PASSWORD=$(openssl rand -base64 24)  # Generate and store securely
POSTGRES_SUPERUSER=postgres
AUTHENTICATOR_PASSWORD=$(openssl rand -base64 24)

# Security (generate once, store in secret manager)
LAUNCHDB_MASTER_KEY=...  # From AWS Secrets Manager
PLATFORM_JWT_SECRET=...
POSTGREST_JWT_SECRET=...
INTERNAL_API_KEY=...
POSTGREST_ADMIN_KEY=...
BACKUP_ENCRYPTION_KEY=...

# Domain
DOMAIN=staging-api.launchdb.io
ACME_EMAIL=devops@launchdb.io

# SMTP (Mailtrap)
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=587
SMTP_USER=1234567890abcd
SMTP_PASSWORD=1234567890abcd
SMTP_FROM=staging@launchdb.io

# Logging
LOG_LEVEL=info
NODE_ENV=production

# Manager API paths
HOST_SCRIPT_DIR=/opt/launchdb/scripts
HOST_CONFIG_DIR=/opt/launchdb/postgrest/projects

# Backup
BACKUP_RETENTION_DAYS=7
RSYNC_DEST=backup@backup.launchdb.io:/backups/staging
```

---

### Production Environment

**Characteristics:**
- Cloud VPS or dedicated server
- Maximum security
- Real TLS certificates
- Production SMTP (SendGrid/AWS SES)
- Minimal logging
- Offsite backups
- Secret management service

**`.env` example:**
```bash
# Database
POSTGRES_SUPERUSER_PASSWORD=...  # From secret manager
POSTGRES_SUPERUSER=postgres
AUTHENTICATOR_PASSWORD=...

# Security (ALL from secret manager)
LAUNCHDB_MASTER_KEY=...  # AWS Secrets Manager
PLATFORM_JWT_SECRET=...
POSTGREST_JWT_SECRET=...
INTERNAL_API_KEY=...
POSTGREST_ADMIN_KEY=...
BACKUP_ENCRYPTION_KEY=...  # Store offline copy

# Domain
DOMAIN=api.launchdb.io
ACME_EMAIL=ops@launchdb.io

# SMTP (SendGrid)
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=...  # SendGrid API key from secret manager
SMTP_FROM=noreply@launchdb.io

# Logging
LOG_LEVEL=warn  # Minimal logs for performance
NODE_ENV=production

# Manager API paths
HOST_SCRIPT_DIR=/opt/launchdb/scripts
HOST_CONFIG_DIR=/opt/launchdb/postgrest/projects

# Storage
MAX_FILE_SIZE_MB=100
SIGNED_URL_TTL=3600

# Backup
BACKUP_RETENTION_DAYS=30
RSYNC_DEST=backup@offsite.example.com:/backups/launchdb-production
RSYNC_SSH_KEY_PATH=/root/.ssh/backup_key

# Optional: AWS S3 backup (if using s3fs)
# RSYNC_DEST=/mnt/s3-backups/launchdb-production
```

---

## Validation & Troubleshooting

### Validate Environment File

```bash
# 1. Check .env exists
test -f .env && echo "✅ .env exists" || echo "❌ .env missing"

# 2. Check required variables are set
for VAR in POSTGRES_SUPERUSER_PASSWORD LAUNCHDB_MASTER_KEY INTERNAL_API_KEY DOMAIN ACME_EMAIL HOST_SCRIPT_DIR HOST_CONFIG_DIR; do
  grep -q "^${VAR}=" .env && echo "✅ $VAR set" || echo "❌ $VAR missing"
done

# 3. Check for placeholder values (CHANGE_ME)
if grep -q "CHANGE_ME" .env; then
  echo "❌ Found placeholder values (CHANGE_ME) - update with real values"
else
  echo "✅ No placeholder values found"
fi

# 4. Verify HOST_SCRIPT_DIR exists
HOST_SCRIPT_DIR=$(grep "^HOST_SCRIPT_DIR=" .env | cut -d'=' -f2)
test -d "$HOST_SCRIPT_DIR" && echo "✅ HOST_SCRIPT_DIR exists: $HOST_SCRIPT_DIR" || echo "❌ HOST_SCRIPT_DIR missing: $HOST_SCRIPT_DIR"

# 5. Verify HOST_CONFIG_DIR exists
HOST_CONFIG_DIR=$(grep "^HOST_CONFIG_DIR=" .env | cut -d'=' -f2)
test -d "$HOST_CONFIG_DIR" && echo "✅ HOST_CONFIG_DIR exists: $HOST_CONFIG_DIR" || echo "❌ HOST_CONFIG_DIR missing: $HOST_CONFIG_DIR"
```

### Common Errors

#### Error: "Missing environment variable: POSTGRES_SUPERUSER_PASSWORD"

**Cause:** Required variable not set in `.env`

**Fix:**
```bash
# Add to .env
POSTGRES_SUPERUSER_PASSWORD=$(openssl rand -base64 24)
```

---

#### Error: "cannot mount volume: path does not exist"

**Cause:** `HOST_SCRIPT_DIR` or `HOST_CONFIG_DIR` points to non-existent directory

**Fix:**
```bash
# Create directories
mkdir -p /opt/launchdb/scripts
mkdir -p /opt/launchdb/postgrest/projects

# Update .env
HOST_SCRIPT_DIR=/opt/launchdb/scripts
HOST_CONFIG_DIR=/opt/launchdb/postgrest/projects
```

---

#### Error: "ACME challenge failed: dial tcp connection refused"

**Cause:** Let's Encrypt cannot reach server on port 80/443

**Fix:**
```bash
# 1. Check firewall
ufw status
# Allow HTTP/HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# 2. Verify DNS points to server
dig +short api.launchdb.io
# Should return server IP

# 3. Test port accessibility from external
curl -I http://api.launchdb.io
# Should return HTTP response (not connection refused)
```

---

#### Error: "Authentication failed for user postgres"

**Cause:** Password mismatch between `.env` and `pgbouncer/userlist.txt`

**Fix:**
```bash
# 1. Check password in .env
grep POSTGRES_SUPERUSER_PASSWORD .env

# 2. Regenerate userlist.txt with correct password
cd pgbouncer
./generate-userlist.sh

# 3. Restart services
docker-compose restart pgbouncer platform-api
```

---

#### Error: "Manager API: PROJECT_SPAWN_FAILED"

**Cause:** Manager API cannot execute scripts or spawn containers

**Troubleshooting:**
```bash
# 1. Check Manager API logs
docker logs launchdb-postgrest-manager

# 2. Verify Docker socket mounted
docker exec launchdb-postgrest-manager ls -la /var/run/docker.sock

# 3. Verify scripts mounted
docker exec launchdb-postgrest-manager ls /scripts

# 4. Test script execution manually
docker exec --user root launchdb-pgbouncer /scripts/pgbouncer-add-project.sh proj_test 5 2
```

---

### Environment Variable Checklist

Before deploying to production, verify:

- [ ] All required variables set (no CHANGE_ME placeholders)
- [ ] Secrets generated with `openssl rand` (not hardcoded)
- [ ] `LAUNCHDB_MASTER_KEY` backed up offline
- [ ] `BACKUP_ENCRYPTION_KEY` backed up offline
- [ ] `DOMAIN` DNS configured and resolves correctly
- [ ] `ACME_EMAIL` monitored
- [ ] `HOST_SCRIPT_DIR` and `HOST_CONFIG_DIR` point to correct absolute paths
- [ ] `.env` added to `.gitignore`
- [ ] `.env` permissions set to `600` (`chmod 600 .env`)
- [ ] SMTP credentials tested (send test email)
- [ ] Firewall configured (allow 80, 443; block 5432, 6432)
- [ ] Secrets stored in secret management service (production)

---

## Next Steps

- **Platform Environment Variables:** See `/docs/platform-env-vars.md` for Platform API, Auth, Storage, and Migrations service configuration
- **Deployment:** See `/docs/infrastructure/deployment.md` for production deployment guide
- **Troubleshooting:** See `/docs/infrastructure/manager-api.md` for Manager API error codes and troubleshooting
- **Architecture:** See `/docs/architecture.md` for system architecture overview
