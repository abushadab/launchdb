# LaunchDB Infrastructure & Operations

## Overview
This directory contains the complete infrastructure and operations configuration for LaunchDB v1, a self-hosted VPS-first Backend-as-a-Service platform.

**Sonnet B Deliverables** (per `brief.md`):
- Docker Compose orchestration
- PgBouncer connection pooling
- Caddy reverse proxy with TLS
- Backup & restore scripts
- PostgREST configuration management
- Healthchecks for all services

## Directory Structure

```
code/
├── docker-compose.yml          # Main orchestration file
├── .env.example                # Environment variables template
├── backup/                     # Backup & restore scripts
│   ├── backup.sh              # Database backup (encrypted)
│   ├── restore.sh             # Database restore
│   ├── storage-backup.sh      # Storage object sync
│   ├── crontab.example        # Backup scheduling
│   └── README.md
├── caddy/                      # Reverse proxy configuration
│   ├── Caddyfile              # Main Caddy config
│   └── README.md
├── pgbouncer/                  # Connection pooling
│   ├── pgbouncer.ini          # PgBouncer config
│   ├── userlist.txt           # User authentication
│   └── README.md
├── postgrest/                  # PostgREST config management
│   ├── template.conf          # Config template
│   └── README.md
├── postgrest-manager/          # PostgREST container management
│   ├── index.js               # HTTP API service
│   ├── package.json           # Dependencies
│   └── Dockerfile             # Container image
├── postgres/                   # PostgreSQL initialization
│   └── init/                  # Init scripts
├── scripts/                    # Management scripts
│   ├── pgbouncer-add-project.sh
│   ├── pgbouncer-add-user.sh
│   ├── postgrest-add-project.sh
│   ├── postgrest-spawn.sh
│   ├── postgrest-stop.sh
│   ├── postgrest-wrapper.sh
│   └── postgrest-reload.sh
└── README.md                   # This file
```

## Quick Start

### 1. Prerequisites
- Docker 20.10+
- Docker Compose 2.0+
- 4-8 GB RAM, 2-4 vCPU minimum
- Domain with DNS pointed to server

### 2. Configuration
```bash
# Copy environment template
cp .env.example .env

# Edit environment variables
nano .env

# Generate secrets
export LAUNCHDB_MASTER_KEY=$(openssl rand -base64 32)
export PLATFORM_JWT_SECRET=$(openssl rand -base64 32)
export BACKUP_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Add to .env file
echo "LAUNCHDB_MASTER_KEY=$LAUNCHDB_MASTER_KEY" >> .env
echo "PLATFORM_JWT_SECRET=$PLATFORM_JWT_SECRET" >> .env
echo "BACKUP_ENCRYPTION_KEY=$BACKUP_ENCRYPTION_KEY" >> .env
```

### 3. Deploy
```bash
# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

### 4. Verify
```bash
# Check health
curl https://your-domain.com/api/health
curl https://your-domain.com

# Check services
docker-compose ps
```

## Service Architecture

### Control Plane (Platform Layer)
- **postgres**: PostgreSQL 15 (platform database)
- **pgbouncer**: Connection pooling
- **platform-api**: Platform REST API (port 3000)
- **dashboard-ui**: Web dashboard (port 3001)

### App Plane (Project Services)
- **auth-service**: Multi-tenant auth (port 8001)
- **postgrest-{projectId}**: Per-project database REST API (port 3000 per container)
- **storage-service**: File storage (port 8003)
- **migrations**: Database migration runner (port 8002)
- **postgrest-manager**: PostgREST container lifecycle management (port 9000)

### Infrastructure
- **reverse-proxy**: Caddy (ports 80, 443)
- **backup**: Backup container (on-demand)

## Port Mapping

| Service | Internal Port | External Port | Purpose |
|---------|--------------|---------------|---------|
| postgres | 5432 | 127.0.0.1:5432 | Database (local only) |
| pgbouncer | 6432 | 127.0.0.1:6432 | Connection pool (local only) |
| platform-api | 8000 | - | Proxied via Caddy |
| dashboard-ui | 3001 | - | Proxied via Caddy |
| auth-service | 8001 | - | Proxied via Caddy |
| migrations | 8002 | - | Internal service |
| storage-service | 8003 | - | Proxied via Caddy |
| postgrest-manager | 9000 | - | Internal service |
| postgrest-{projectId} | 3000 | - | Per-project, routed via platform-api |
| caddy | 80, 443 | 80, 443 | Public HTTPS |
| caddy admin | 2019 | 2019 | Metrics (local) |

**Note:** PostgREST runs as per-project containers spawned dynamically. Each project gets its own `postgrest-{projectId}` container.

## Volume Mounts

| Volume | Path | Purpose |
|--------|------|---------|
| postgres-data | /var/lib/postgresql/data | Database files |
| pgbouncer-logs | /var/log/pgbouncer | PgBouncer logs |
| postgrest-configs | /etc/postgrest | PostgREST configs |
| storage-data | /var/lib/launchdb/storage | Object storage |
| backup-data | /backups | Backup files |
| caddy-data | /data | Caddy certificates |
| caddy-config | /config | Caddy config |

## Environment Variables

See `ENVIRONMENT.md` for complete reference.

**Critical Variables** (must be set):
- `POSTGRES_SUPERUSER_PASSWORD`
- `LAUNCHDB_MASTER_KEY`
- `PLATFORM_JWT_SECRET`
- `DOMAIN`
- `ACME_EMAIL`

## Integration Points for Sonnet A

### Platform API
**Expected by infra:**
- Health endpoint: `GET /health` → `200 OK`
- Database connection via PgBouncer (not direct postgres)
- Secrets from encrypted `platform.secrets` table

**Should call infra services:**
```javascript
// On project creation
await exec(`/scripts/pgbouncer-add-project.sh ${projectId} ${poolSize}`);
await exec(`/scripts/postgrest-add-project.sh ${projectId} ${jwtSecret} ${password}`);
// This spawns postgrest-{projectId} container automatically

// Alternative: Use PostgREST Manager HTTP API
const response = await fetch('http://postgrest-manager:9000/internal/postgrest/spawn', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Internal-Key': process.env.INTERNAL_API_KEY
  },
  body: JSON.stringify({ projectId })
});
// Returns: { projectId, containerId, containerName, port, status }

// On project deletion
const deleteResponse = await fetch(`http://postgrest-manager:9000/internal/postgrest/${projectId}`, {
  method: 'DELETE',
  headers: { 'X-Internal-Key': process.env.INTERNAL_API_KEY }
});
// Returns: { projectId, status: 'stopped' }

// List running PostgREST containers
const listResponse = await fetch('http://postgrest-manager:9000/internal/postgrest', {
  headers: { 'X-Internal-Key': process.env.INTERNAL_API_KEY }
});
// Returns: { containers: [{ projectId, containerName, port, status }] }

// On user creation
await exec(`/scripts/pgbouncer-add-user.sh ${username} ${password}`);
```

**PostgREST Routing:**
Platform-api must handle `/db/*` routing to per-project PostgREST containers:
- Extract `{projectId}` from request path
- Proxy to `http://postgrest-{projectId}:3000` on internal network
- Containers are named predictably: `postgrest-{projectId}`

### Auth Service
**Expected by infra:**
- Health endpoint: `GET /health` → `200 OK`
- Routes: `/auth/{project_id}/*` (per `interfaces.md`)
- Multi-tenant: extracts project_id from path
- JWT claims per `interfaces.md` Section 1

### Storage Service
**Expected by infra:**
- Health endpoint: `GET /health` → `200 OK`
- Routes: `/storage/{project_id}/*`
- Files stored at: `/var/lib/launchdb/storage/<project_id>/<bucket>/<path>`

### PostgREST
**Expected by infra:**
- Configs in `/etc/postgrest/projects/<project_id>.conf`
- Reload via SIGHUP (handled by scripts)
- Multi-tenant routing via platform-api proxy

## Operations

### Backup
```bash
# Manual backup
docker exec launchdb-backup /backup.sh --all

# Schedule (add to crontab)
0 2 * * * docker exec launchdb-backup /backup.sh --all
```

### Restore
```bash
docker exec launchdb-backup /restore.sh \
  /backups/proj_abc123_20231201_020000.sql.gpg \
  proj_abc123
```

### Add Project
```bash
# Add to PgBouncer
docker exec launchdb-pgbouncer /scripts/pgbouncer-add-project.sh proj_abc123

# Add to PostgREST
docker exec launchdb-postgrest /scripts/postgrest-add-project.sh \
  proj_abc123 "jwt_secret" "auth_password"
```

### Monitoring
```bash
# Service health
docker-compose ps

# Logs
docker-compose logs -f [service-name]

# PgBouncer stats
docker exec launchdb-pgbouncer psql -h 127.0.0.1 -p 6432 -U postgres pgbouncer -c "SHOW STATS"

# Caddy metrics
curl http://localhost:2019/metrics
```

### Scaling Recommendations

| Projects | RAM | vCPU | Disk |
|----------|-----|------|------|
| 1-3 | 8 GB | 4 | 50 GB |
| 4-10 | 16 GB | 6 | 100 GB |
| 11-25 | 32 GB | 8 | 200 GB |

## Security Checklist

- [ ] Set strong `POSTGRES_SUPERUSER_PASSWORD`
- [ ] Generate unique `LAUNCHDB_MASTER_KEY` (32 bytes)
- [ ] Generate unique `PLATFORM_JWT_SECRET`
- [ ] Set `BACKUP_ENCRYPTION_KEY` for backup encryption
- [ ] Configure firewall (only 80, 443, 22 open)
- [ ] Set up SSH key-based auth for backups
- [ ] Enable automatic security updates
- [ ] Configure rsync backup destination
- [ ] Test restore procedure
- [ ] Set up monitoring/alerting

## Troubleshooting

### Services won't start
```bash
# Check logs
docker-compose logs

# Check environment
docker-compose config

# Restart specific service
docker-compose restart [service-name]
```

### Database connection errors
```bash
# Test direct connection
docker exec launchdb-postgres psql -U postgres -c "SELECT 1"

# Test via PgBouncer
docker exec launchdb-pgbouncer psql -h 127.0.0.1 -p 6432 -U postgres -d platform -c "SELECT 1"
```

### Caddy certificate issues
```bash
# Check Caddy logs
docker logs launchdb-caddy

# Verify DNS
dig your-domain.com

# Test manual cert
docker exec launchdb-caddy caddy trust
```

## Contracts & Compliance

This infrastructure implementation follows:
- `../spec.md` - Core architecture specification
- `../v1-decisions.md` - Technical decisions (MUST requirements)
- `../interfaces.md` - Service contracts (JWT, PostgREST, Auth, Storage, Secrets)

**Key Contracts:**
- PostgREST: file+SIGHUP reload (interfaces.md §2)
- Auth: path-based routing `/auth/{project_id}/*` (interfaces.md §3)
- JWT: HS256, claims schema (interfaces.md §1)
- Secrets: AES-256-GCM encryption (interfaces.md §4)
- Backups: nightly per-project pg_dump (v1-decisions.md)
- Rate limiting: per-project at proxy (v1-decisions.md)

## Support

For issues or questions:
- Open an issue on GitHub
- Reference specific files/line numbers
- Include relevant logs/errors
