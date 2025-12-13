# Docker and Docker Compose Setup Guide

## Table of Contents

- [Prerequisites](#prerequisites)
- [System Requirements](#system-requirements)
- [Installation](#installation)
- [Directory Structure](#directory-structure)
- [Configuration](#configuration)
- [Docker Compose Services](#docker-compose-services)
- [Volumes and Data Persistence](#volumes-and-data-persistence)
- [Networking](#networking)
- [Initial Deployment](#initial-deployment)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Software

- **Docker:** Version 20.10 or higher
- **Docker Compose:** Version 2.0 or higher (v2 CLI recommended)
- **Git:** For cloning the repository
- **Bash:** For running setup scripts

### Operating System

- **Supported:** Linux (Ubuntu 20.04+, Debian 11+, CentOS 8+)
- **Architecture:** x86_64 (amd64)
- **Not supported:** Windows, macOS (use Linux VPS)

### Minimum Server Specifications

- **CPU:** 2 cores
- **RAM:** 4GB minimum, 8GB recommended
- **Storage:** 20GB minimum, 50GB+ recommended for production
- **Network:** Public IPv4 address for production deployment

### Ports Required

| Port | Service | Public/Internal | Purpose |
|------|---------|-----------------|---------|
| 80 | Caddy | Public | HTTP (redirects to HTTPS) |
| 443 | Caddy | Public | HTTPS (TLS termination) |
| 5432 | PostgreSQL | Internal | Database (localhost only) |
| 6432 | PgBouncer | Internal | Connection pooling (localhost only) |
| 8000 | Platform API | Internal | Control plane API |
| 8001 | Auth | Internal | Authentication service |
| 8002 | Migrations | Internal | Database migrations |
| 8003 | Storage | Internal | File storage service |
| 9000 | Manager API | Internal | Container orchestration |

**Note:** Only ports 80 and 443 should be exposed to the public internet. All other ports are bound to `127.0.0.1` or internal Docker networks.

## System Requirements

### Disk Space Breakdown

```
PostgreSQL data:        ~100MB per project database
PostgREST containers:   ~20MB per project
Docker images:          ~2GB (all services)
Logs:                   ~100MB (with rotation)
Backups:                Variable (depends on retention policy)

Recommended: 50GB for 50 projects + growth
```

### Memory Usage

```
PostgreSQL:      ~500MB
PgBouncer:       ~50MB
Platform API:    ~200MB
PostgREST (each):~50MB
Other services:  ~300MB

Total baseline:  ~1.5GB
Per-project:     +50MB (PostgREST container)

Recommended: 8GB RAM for 50 projects
```

### CPU Considerations

- **Baseline:** 1-2 cores sufficient for light load
- **Production:** 4+ cores for concurrent project creation
- **Scaling:** CPU usage grows with API request volume, not project count

## Installation

### 1. Install Docker

#### Ubuntu/Debian

```bash
# Update package index
sudo apt-get update

# Install dependencies
sudo apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Add Docker's official GPG key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Set up repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Verify installation
docker --version
docker compose version
```

#### CentOS/RHEL

```bash
# Install Docker
sudo yum install -y yum-utils
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start Docker
sudo systemctl start docker
sudo systemctl enable docker

# Verify installation
docker --version
docker compose version
```

### 2. Configure Docker

```bash
# Add your user to docker group (optional, allows non-root docker usage)
sudo usermod -aG docker $USER

# Log out and back in for group changes to take effect
# Or use: newgrp docker

# Configure Docker daemon (optional optimizations)
sudo mkdir -p /etc/docker
cat <<EOF | sudo tee /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2"
}
EOF

# Restart Docker
sudo systemctl restart docker
```

### 3. Clone Repository

```bash
# Clone LaunchDB repository
git clone https://github.com/yourusername/launchdb.git
cd launchdb
```

## Directory Structure

```
launchdb/
├── docker-compose.yml          # Main orchestration file
├── .env                        # Environment variables (create from .env.example)
├── .env.example                # Template for environment variables
│
├── infrastructure/             # Infrastructure components
│   ├── postgres/
│   │   └── init/               # PostgreSQL initialization scripts
│   │
│   ├── pgbouncer/
│   │   ├── Dockerfile          # PgBouncer container image
│   │   ├── pgbouncer.ini       # PgBouncer configuration
│   │   ├── userlist.txt        # PgBouncer user authentication
│   │   └── entrypoint.sh       # Container entrypoint script
│   │
│   ├── postgrest/
│   │   ├── Dockerfile          # PostgREST image
│   │   └── projects/           # Per-project config files (generated)
│   │
│   ├── postgrest-manager/
│   │   ├── Dockerfile          # Manager API container image
│   │   ├── index.js            # Manager API server
│   │   └── package.json        # Node.js dependencies
│   │
│   ├── scripts/
│   │   ├── pgbouncer-add-project.sh
│   │   ├── pgbouncer-add-user.sh
│   │   ├── pgbouncer-remove-project.sh
│   │   ├── pgbouncer-remove-user.sh
│   │   └── postgrest-spawn.sh
│   │
│   ├── caddy/
│   │   └── Caddyfile           # Reverse proxy configuration
│   │
│   └── backup/
│       ├── Dockerfile
│       ├── backup.sh
│       └── restore.sh
│
├── platform/                   # Platform services (NestJS monorepo)
│   ├── apps/
│   │   ├── platform-api/       # Main API
│   │   ├── auth-service/       # Authentication
│   │   ├── storage-service/    # File storage
│   │   └── migrations-runner/  # Database migrations
│   ├── libs/                   # Shared libraries
│   ├── Dockerfile
│   └── package.json
│
└── docs/                       # Documentation
    ├── architecture.md
    └── infrastructure/
```

## Configuration

### 1. Create Environment File

```bash
# Copy example environment file
cp .env.example .env

# Edit with your values
nano .env
```

### 2. Required Environment Variables

```bash
# PostgreSQL
POSTGRES_SUPERUSER=postgres
POSTGRES_SUPERUSER_PASSWORD=your_secure_password_here

# API Keys
INTERNAL_API_KEY=generate_random_32char_key
LAUNCHDB_MASTER_KEY=generate_random_32char_key

# Domain Configuration
DOMAIN=yourdomain.com
ACME_EMAIL=admin@yourdomain.com

# Docker Host Paths (absolute paths required)
HOST_SCRIPT_DIR=/opt/launchdb/infrastructure/scripts
HOST_CONFIG_DIR=/opt/launchdb/infrastructure/postgrest/projects

# Optional SMTP (for email features)
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=your_sendgrid_api_key

# Optional Backup (for automated backups)
RSYNC_DEST=user@backup-server:/backups/launchdb
```

### 3. Generate Secure Keys

```bash
# Generate random keys
openssl rand -hex 32  # For INTERNAL_API_KEY
openssl rand -hex 32  # For LAUNCHDB_MASTER_KEY

# Or use this one-liner to update .env
sed -i "s/INTERNAL_API_KEY=.*/INTERNAL_API_KEY=$(openssl rand -hex 32)/" .env
sed -i "s/LAUNCHDB_MASTER_KEY=.*/LAUNCHDB_MASTER_KEY=$(openssl rand -hex 32)/" .env
```

### 4. Configure PgBouncer

Initial `infrastructure/pgbouncer/userlist.txt` should contain the platform user:

```
"postgres" "md5<md5_hash_of_password+username>"
```

Generate the hash:

```bash
# Generate MD5 hash for PgBouncer
PASSWORD="your_password"
USERNAME="postgres"
echo -n "md5$(echo -n "${PASSWORD}${USERNAME}" | md5sum | cut -d' ' -f1)"
```

Update `infrastructure/pgbouncer/userlist.txt`:

```
"postgres" "md5abc123def456..."
```

## Docker Compose Services

### Service Overview

```yaml
services:
  postgres:         # PostgreSQL database
  pgbouncer:        # Connection pooler
  platform-api:     # Main API
  auth-service:     # Authentication
  storage-service:  # File storage
  migrations:       # Database migrations
  postgrest-manager:# Container orchestration
  reverse-proxy:    # Caddy (TLS + routing)
```

### Build Images

```bash
# Build all custom images
docker compose build

# Or build specific services
docker compose build pgbouncer
docker compose build postgrest-manager
docker compose build platform-api
```

### Service Dependencies

```
reverse-proxy → platform-api → pgbouncer → postgres
                              ↓
              postgrest-manager → postgres
                              ↓
              migrations → postgres
              auth-service → postgres
              storage-service → postgres
```

**Health Checks:** Services wait for dependencies to be healthy before starting.

## Volumes and Data Persistence

### Named Volumes

```yaml
volumes:
  postgres-data:    # PostgreSQL database files
  pgbouncer-logs:   # PgBouncer logs
  storage-data:     # Uploaded files
  backup-data:      # Backup archives
  caddy-data:       # TLS certificates
  caddy-config:     # Caddy configuration
```

### Bind Mounts

```yaml
# Configuration files (read-only where possible)
./infrastructure/pgbouncer/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini
./infrastructure/pgbouncer/userlist.txt:/etc/pgbouncer/userlist.txt
./infrastructure/scripts:/scripts:ro
./infrastructure/postgrest/projects:/etc/postgrest/projects:ro

# Docker socket (Manager API needs container control)
/var/run/docker.sock:/var/run/docker.sock:ro
```

### Data Backup Strategy

```bash
# Backup PostgreSQL data
docker compose exec postgres pg_dumpall -U postgres > backup.sql

# Backup volumes
docker run --rm \
  -v launchdb_postgres-data:/data \
  -v $(pwd):/backup \
  ubuntu tar czf /backup/postgres-data-$(date +%Y%m%d).tar.gz -C /data .

# Backup configuration
tar czf config-backup-$(date +%Y%m%d).tar.gz \
  .env infrastructure/
```

## Networking

### Docker Networks

```yaml
networks:
  launchdb-internal:
    driver: bridge
```

**All services communicate via the internal bridge network.**

### Container Name Resolution

Services can communicate using service names:

```
platform-api → pgbouncer:6432
platform-api → auth-service:8001
postgrest-manager → postgres:5432
postgrest-{project} → pgbouncer:6432
```

### Network Isolation

- **Public:** Only Caddy (ports 80/443) exposed
- **Internal:** All other services on private bridge network
- **PostgreSQL:** Bound to `127.0.0.1:5432` on host (not accessible from Docker network directly, only via PgBouncer)

### Dynamic PostgREST Network

PostgREST containers are attached to the same network at spawn time:

```bash
docker run --network launchdb_launchdb-internal ...
```

Network name is auto-detected using Docker Compose project prefix.

## Initial Deployment

### Step 1: Pre-flight Checks

```bash
# Verify Docker is running
docker info

# Verify Docker Compose version
docker compose version

# Verify .env file exists and has required variables
grep -E "POSTGRES_SUPERUSER_PASSWORD|INTERNAL_API_KEY|LAUNCHDB_MASTER_KEY" .env

# Verify scripts are executable
chmod +x infrastructure/scripts/*.sh
```

### Step 2: Build Images

```bash
# Build all services
docker compose build

# Verify images
docker images | grep launchdb
```

### Step 3: Start Infrastructure Layer

```bash
# Start PostgreSQL first
docker compose up -d postgres

# Wait for PostgreSQL to be healthy
docker compose ps postgres

# Start PgBouncer
docker compose up -d pgbouncer
```

### Step 4: Start Application Services

```bash
# Start all services
docker compose up -d

# Monitor logs
docker compose logs -f
```

### Step 5: Verify Deployment

```bash
# Check all services are healthy
docker compose ps

# Expected output:
# NAME                            STATUS
# launchdb-postgres               Up (healthy)
# launchdb-pgbouncer              Up (healthy)
# launchdb-platform-api           Up (healthy)
# launchdb-migrations             Up (healthy)
# launchdb-auth-service           Up (healthy)
# launchdb-storage-service        Up (healthy)
# launchdb-postgrest-manager      Up (healthy)
# launchdb-caddy          Up (healthy)
```

## Verification

### Health Checks

```bash
# PostgreSQL
docker compose exec postgres pg_isready -U postgres

# PgBouncer (via psql)
docker compose exec pgbouncer psql -h 127.0.0.1 -p 6432 -U postgres -d platform -c "SELECT 1;"

# Platform API
curl http://localhost:8000/health

# Manager API
curl -H "X-Internal-Key: ${INTERNAL_API_KEY}" http://localhost:9000/health

# Auth Service
curl http://localhost:8001/health

# Migrations Service
curl http://localhost:8002/health

# Storage Service
curl http://localhost:8003/health
```

### Database Connectivity

```bash
# Connect to platform database
docker compose exec postgres psql -U postgres -d platform

# List databases
\l

# Exit
\q
```

### Logs

```bash
# All services
docker compose logs

# Specific service
docker compose logs postgres
docker compose logs platform-api

# Follow logs
docker compose logs -f platform-api

# Last N lines
docker compose logs --tail=50 pgbouncer
```

## Troubleshooting

### Service Won't Start

**Check logs:**
```bash
docker compose logs <service-name>
```

**Common issues:**

1. **Port already in use:**
   ```bash
   # Find process using port
   sudo lsof -i :8000

   # Kill process or change port in docker-compose.yml
   ```

2. **Missing environment variables:**
   ```bash
   # Verify .env file
   cat .env | grep -E "POSTGRES_SUPERUSER_PASSWORD|INTERNAL_API_KEY"
   ```

3. **Permission denied (Docker socket):**
   ```bash
   # Add user to docker group
   sudo usermod -aG docker $USER
   newgrp docker
   ```

### PostgreSQL Connection Issues

**Problem:** Cannot connect to PostgreSQL

**Solutions:**

1. **Check if PostgreSQL is running:**
   ```bash
   docker compose ps postgres
   ```

2. **Check PostgreSQL logs:**
   ```bash
   docker compose logs postgres
   ```

3. **Test connection inside container:**
   ```bash
   docker compose exec postgres psql -U postgres -c "SELECT 1;"
   ```

4. **Verify password:**
   ```bash
   # Check if password matches .env
   docker compose exec postgres psql -U postgres -W
   ```

### PgBouncer Connection Issues

**Problem:** `server login has been failing, try again later`

**Cause:** PostgreSQL max_connections exhausted

**Solution:**

1. **Check active connections:**
   ```bash
   docker compose exec postgres psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"
   ```

2. **Check max_connections:**
   ```bash
   docker compose exec postgres psql -U postgres -c "SHOW max_connections;"
   ```

3. **Increase if needed:**
   ```yaml
   # In docker-compose.yml
   postgres:
     command:
       - "postgres"
       - "-c"
       - "max_connections=500"  # Increase from default 200
   ```

4. **Reduce pool sizes:**
   ```bash
   # Edit pgbouncer.ini
   # Change pool_size=20 to pool_size=5 for existing projects
   ```

### Container Restart Loops

**Problem:** Container keeps restarting

**Debug:**

1. **Check container logs:**
   ```bash
   docker logs <container-name>
   ```

2. **Check exit code:**
   ```bash
   docker inspect <container-name> | grep -A 5 "State"
   ```

3. **Run container interactively:**
   ```bash
   docker compose run --rm <service-name> /bin/sh
   ```

### Disk Space Issues

**Problem:** Out of disk space

**Solutions:**

1. **Clean up Docker:**
   ```bash
   # Remove unused containers, images, volumes
   docker system prune -a --volumes

   # WARNING: This removes ALL unused Docker resources
   ```

2. **Check disk usage:**
   ```bash
   df -h
   du -sh /var/lib/docker
   ```

3. **Clean up logs:**
   ```bash
   # Truncate large log files
   truncate -s 0 /var/lib/docker/containers/*/*-json.log
   ```

### Network Issues

**Problem:** Services can't communicate

**Solutions:**

1. **Verify network:**
   ```bash
   docker network ls
   docker network inspect launchdb_launchdb-internal
   ```

2. **Test connectivity:**
   ```bash
   docker compose exec platform-api ping pgbouncer
   docker compose exec platform-api nc -zv pgbouncer 6432
   ```

3. **Recreate network:**
   ```bash
   docker compose down
   docker network prune
   docker compose up -d
   ```

## Maintenance

### Updating Services

```bash
# Pull latest code
git pull

# Rebuild changed images
docker compose build

# Recreate containers
docker compose up -d --force-recreate
```

### Viewing Resource Usage

```bash
# All containers
docker stats

# Specific service
docker stats launchdb-postgres
```

### Rotating Logs

Logs are automatically rotated with Docker's json-file log driver (configured in daemon.json).

Manual rotation:

```bash
# Restart service to rotate logs
docker compose restart <service-name>
```

## Security Best Practices

1. **Never commit `.env` file to version control**
2. **Use strong passwords (32+ characters)**
3. **Restrict PostgreSQL to localhost only** (already configured)
4. **Keep Docker and Docker Compose updated**
5. **Regularly backup data volumes**
6. **Monitor logs for suspicious activity**
7. **Use firewall to restrict external access** (only ports 80/443 public)

## Next Steps

- [Manager API Documentation](./manager-api.md)
- [PgBouncer Scripts](./pgbouncer-scripts.md)
- [Production Deployment Guide](./deployment.md)
- [Environment Variables Reference](./environment-vars.md)
