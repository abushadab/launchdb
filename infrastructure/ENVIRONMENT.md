# LaunchDB Environment Variables Reference

## Required Variables

### Database
```bash
# PostgreSQL superuser password
# Used by: postgres, pgbouncer, platform-api, auth-service, backup
POSTGRES_SUPERUSER_PASSWORD="your_secure_password_here"

# Optional: PostgreSQL superuser name (default: postgres)
POSTGRES_SUPERUSER="postgres"

# Authenticator role password (for PostgREST)
AUTHENTICATOR_PASSWORD="secure_authenticator_password"
```

### Security & Encryption
```bash
# Master encryption key for secrets management (32 bytes, base64)
# Used by: platform-api, auth-service, storage-service
# Generate: openssl rand -base64 32
LAUNCHDB_MASTER_KEY="base64_encoded_32_byte_key"

# Platform JWT secret for owner authentication
# Used by: platform-api, dashboard-ui
# Generate: openssl rand -base64 32
PLATFORM_JWT_SECRET="platform_jwt_secret_here"

# PostgREST JWT secret (can be same as PLATFORM_JWT_SECRET or separate)
# Used by: postgrest
# Generate: openssl rand -base64 32
POSTGREST_JWT_SECRET="postgrest_jwt_secret_here"

# Internal API key for service-to-service auth
# Used by: platform-api, auth-service, postgrest
# Generate: openssl rand -hex 32
INTERNAL_API_KEY="internal_api_key_here"

# PostgREST admin key for reload endpoint
# Used by: platform-api, postgrest
# Generate: openssl rand -hex 32
POSTGREST_ADMIN_KEY="postgrest_admin_key_here"

# Backup encryption key (for GPG encryption)
# Generate: openssl rand -base64 32
BACKUP_ENCRYPTION_KEY="backup_gpg_passphrase"
```

### Domain & TLS
```bash
# Primary domain for the platform
DOMAIN="api.example.com"

# Email for Let's Encrypt notifications
ACME_EMAIL="admin@example.com"
```

## Optional Variables

### Database Configuration
```bash
# Database host (default: postgres)
POSTGRES_HOST="postgres"

# Database port (default: 5432)
POSTGRES_PORT="5432"
```

### SMTP / Email
```bash
# SMTP server for auth emails
SMTP_HOST="smtp.example.com"
SMTP_PORT="587"
SMTP_USER="noreply@example.com"
SMTP_PASSWORD="smtp_password"
SMTP_FROM="noreply@example.com"

# For development, use Mailhog or similar
# SMTP_HOST="mailhog"
# SMTP_PORT="1025"
```

### Backup Configuration
```bash
# Backup retention in days (default: 7)
BACKUP_RETENTION_DAYS="7"

# Remote rsync destination for offsite backups
# Format: user@host:/path
RSYNC_DEST="backup-user@backup.example.com:/var/backups/launchdb"

# Path to SSH key for rsync (mounted in backup container)
RSYNC_SSH_KEY_PATH="/root/.ssh/backup_key"
```

### Storage Configuration
```bash
# Max file upload size in MB (default: 50)
MAX_FILE_SIZE_MB="50"

# Signed URL TTL in seconds (default: 3600)
SIGNED_URL_TTL="3600"
```

### Service Configuration
```bash
# Log level for services (default: info)
# Options: error, warn, info, debug
LOG_LEVEL="info"

# Node environment (default: production)
NODE_ENV="production"

# PgBouncer configuration directory
PGBOUNCER_CONFIG_DIR="/etc/pgbouncer"

# PostgREST configuration directory
POSTGREST_CONFIG_DIR="/etc/postgrest"
```

## Per-Service Environment Variables

### platform-api
```bash
PORT=8000
DATABASE_URL="postgres://postgres:${POSTGRES_SUPERUSER_PASSWORD}@pgbouncer:6432/platform"
LAUNCHDB_MASTER_KEY="${LAUNCHDB_MASTER_KEY}"
JWT_SECRET="${PLATFORM_JWT_SECRET}"
INTERNAL_API_KEY="${INTERNAL_API_KEY}"
POSTGREST_ADMIN_KEY="${POSTGREST_ADMIN_KEY}"
LOG_LEVEL="info"
```

### dashboard-ui
```bash
PORT=3001
NEXT_PUBLIC_API_URL="https://${DOMAIN}/api"
NODE_ENV="production"
```

### auth-service
```bash
PORT=8001
DATABASE_URL="postgres://postgres:${POSTGRES_SUPERUSER_PASSWORD}@pgbouncer:6432/platform"
LAUNCHDB_MASTER_KEY="${LAUNCHDB_MASTER_KEY}"
CACHE_TTL_SECONDS="300"
ACCESS_TOKEN_TTL="900"
REFRESH_TOKEN_TTL="604800"
SMTP_HOST="${SMTP_HOST}"
SMTP_PORT="${SMTP_PORT}"
SMTP_USER="${SMTP_USER}"
SMTP_PASSWORD="${SMTP_PASSWORD}"
SMTP_FROM="${SMTP_FROM}"
LOG_LEVEL="info"
```

### migrations
```bash
PORT=8002
DATABASE_URL="postgres://postgres:${POSTGRES_SUPERUSER_PASSWORD}@pgbouncer:6432/platform"
LAUNCHDB_MASTER_KEY="${LAUNCHDB_MASTER_KEY}"
INTERNAL_API_KEY="${INTERNAL_API_KEY}"
LOG_LEVEL="info"
```

### postgrest
```bash
PGRST_DB_URI="postgres://authenticator:${AUTHENTICATOR_PASSWORD}@pgbouncer:6432/platform"
PGRST_DB_SCHEMAS="public,storage"
PGRST_DB_ANON_ROLE="anon"
PGRST_JWT_SECRET="${POSTGREST_JWT_SECRET}"
PGRST_JWT_AUD="authenticated"
PGRST_MAX_ROWS="1000"
PGRST_DB_POOL="10"
PGRST_DB_POOL_ACQUISITION_TIMEOUT="10"
PGRST_SERVER_PORT="3000"
PGRST_LOG_LEVEL="info"
```

### storage-service
```bash
PORT=8003
DATABASE_URL="postgres://postgres:${POSTGRES_SUPERUSER_PASSWORD}@pgbouncer:6432/platform"
LAUNCHDB_MASTER_KEY="${LAUNCHDB_MASTER_KEY}"
STORAGE_PATH="/var/lib/launchdb/storage"
MAX_FILE_SIZE_MB="${MAX_FILE_SIZE_MB}"
SIGNED_URL_TTL="${SIGNED_URL_TTL}"
LOG_LEVEL="info"
```

### backup
```bash
POSTGRES_HOST="postgres"
POSTGRES_PORT="5432"
POSTGRES_USER="${POSTGRES_SUPERUSER}"
POSTGRES_PASSWORD="${POSTGRES_SUPERUSER_PASSWORD}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS}"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY}"
RSYNC_DEST="${RSYNC_DEST}"
RSYNC_SSH_KEY_PATH="${RSYNC_SSH_KEY_PATH}"
```

### reverse-proxy (Caddy)
```bash
DOMAIN="${DOMAIN}"
ACME_EMAIL="${ACME_EMAIL}"
```

## Environment File Template

See `.env.example` for a complete template with all variables.

## Security Best Practices

### 1. Secret Generation
```bash
# Generate strong random secrets
openssl rand -base64 32  # For keys
openssl rand -hex 32     # For API keys
```

### 2. Secret Storage
- Never commit `.env` to version control
- Add `.env` to `.gitignore`
- Use environment-specific files: `.env.production`, `.env.staging`
- For production, consider using secret management service (Vault, AWS Secrets Manager)

### 3. Secret Rotation
When rotating secrets:
1. Generate new secret
2. Update `.env` file
3. Restart affected services
4. For JWT secrets: update all project configs
5. For database passwords: update postgres, pgbouncer, and all services

### 4. Validation
```bash
# Check required variables are set
docker-compose config | grep -E "POSTGRES_SUPERUSER_PASSWORD|LAUNCHDB_MASTER_KEY|DOMAIN"

# Test service startup
docker-compose up -d && docker-compose ps
```

## Development vs Production

### Development
```bash
# Relaxed settings for local development
LOG_LEVEL="debug"
NODE_ENV="development"
SMTP_HOST="mailhog"
BACKUP_RETENTION_DAYS="1"
```

### Production
```bash
# Secure settings for production
LOG_LEVEL="info"
NODE_ENV="production"
SMTP_HOST="smtp.example.com"
BACKUP_RETENTION_DAYS="7"
# Strong passwords, proper SMTP, rsync backup destination
```

## Environment Variable Checklist

Before deployment, ensure:

- [ ] `POSTGRES_SUPERUSER_PASSWORD` set (strong password)
- [ ] `LAUNCHDB_MASTER_KEY` generated (32 bytes)
- [ ] `PLATFORM_JWT_SECRET` generated (32 bytes)
- [ ] `POSTGREST_JWT_SECRET` generated (32 bytes)
- [ ] `BACKUP_ENCRYPTION_KEY` set
- [ ] `DOMAIN` points to server IP
- [ ] `ACME_EMAIL` is valid
- [ ] SMTP configured (or dev sink)
- [ ] `RSYNC_DEST` configured for backups
- [ ] All secrets backed up securely
- [ ] `.env` not in version control

## Troubleshooting

### Variable Not Found
```bash
# Check if variable is set
docker-compose config | grep VARIABLE_NAME

# Check in running container
docker exec <container> env | grep VARIABLE_NAME
```

### Database Connection Issues
- Verify `POSTGRES_SUPERUSER_PASSWORD` matches postgres password
- Check `DATABASE_URL` format: `postgres://user:password@host:port/database`
- Test connection: `docker exec launchdb-postgres psql -U postgres -c "SELECT 1"`

### TLS Certificate Issues
- Verify `DOMAIN` DNS resolves to server
- Check `ACME_EMAIL` is valid
- Ensure ports 80/443 are accessible
- Check Caddy logs: `docker logs launchdb-caddy`
