# Production Deployment Guide

## Table of Contents

- [Overview](#overview)
- [Server Requirements](#server-requirements)
- [Pre-Deployment Checklist](#pre-deployment-checklist)
- [Installation Steps](#installation-steps)
- [Configuration](#configuration)
- [Service Startup](#service-startup)
- [Post-Deployment Verification](#post-deployment-verification)
- [Monitoring Setup](#monitoring-setup)
- [Backup Configuration](#backup-configuration)
- [Maintenance Procedures](#maintenance-procedures)
- [Scaling Considerations](#scaling-considerations)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)

## Overview

This guide covers production deployment of LaunchDB infrastructure on a single VPS (Virtual Private Server). The deployment uses Docker Compose for orchestration and Caddy for automatic TLS certificate management.

**Architecture:** Single-VPS deployment suitable for 50-100 active projects.

**Services Deployed:**
- PostgreSQL (database)
- PgBouncer (connection pooler)
- Manager API (container orchestration)
- Platform API (control plane)
- Auth service
- Storage service
- Migrations service
- Caddy (reverse proxy with automatic TLS)
- Backup service

**Estimated Setup Time:** 45-60 minutes

## Server Requirements

### Minimum Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **CPU** | 2 cores | 4 cores |
| **RAM** | 4 GB | 8 GB |
| **Storage** | 40 GB SSD | 100 GB SSD |
| **Network** | 1 Gbps | 1 Gbps |
| **OS** | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |

### Capacity Planning

**Memory Calculation:**
```
PostgreSQL: 1 GB (base) + 500 MB (max_connections=500)
PgBouncer: 100 MB
Manager API: 200 MB
Platform API: 300 MB
Auth service: 200 MB
Storage service: 200 MB
Migrations: 200 MB
Caddy: 100 MB
PostgREST containers: 50 MB × (number of projects)

Total: ~3 GB + (50 MB × projects)

Example:
- 20 projects: 3 GB + 1 GB = 4 GB (minimum VPS size)
- 50 projects: 3 GB + 2.5 GB = 5.5 GB (8 GB VPS recommended)
```

**Storage Calculation:**
```
Docker images: 2 GB
PostgreSQL data: 1 GB + (database growth)
Logs: 500 MB/day (with rotation)
Backups: (database size) × (retention days)
User uploads: (projects) × (average storage per project)

Example:
- 50 projects, 30-day backup retention, 1 GB storage per project:
  = 2 GB (images) + 5 GB (DB) + 15 GB (logs) + 150 GB (backups) + 50 GB (uploads)
  = 222 GB total (provision 250-300 GB)
```

### Operating System

**Supported:**
- Ubuntu 22.04 LTS (recommended)
- Ubuntu 20.04 LTS
- Debian 11 (Bullseye)
- Debian 12 (Bookworm)

**Not Tested:**
- CentOS / RHEL (may work with adjustments)
- Fedora
- Arch Linux

### Network Requirements

**Inbound Ports:**
- `80/tcp` - HTTP (ACME challenge)
- `443/tcp` - HTTPS (API traffic)
- `22/tcp` - SSH (administration)

**Outbound Ports:**
- `80/tcp`, `443/tcp` - HTTPS (ACME, Docker Hub, package updates)
- `587/tcp` - SMTP (email sending, if configured)

**Firewall Configuration:**
```bash
# Allow SSH
ufw allow 22/tcp

# Allow HTTP/HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Block all other inbound
ufw default deny incoming
ufw default allow outgoing

# Enable firewall
ufw enable
```

**⚠️ CRITICAL:** Do NOT expose PostgreSQL (5432), PgBouncer (6432), or Manager API (9000) to public internet.

### Domain Requirements

**Required:**
- Registered domain name
- DNS A record pointing to server IP
- DNS propagation complete (24-48 hours, verify with `dig`)

**Example:**
```bash
# Verify DNS propagation
dig +short api.launchdb.io

# Should return your server IP
# 1.2.3.4
```

**Subdomain vs Root Domain:**
- ✅ Recommended: `api.yourdomain.com` (subdomain)
- ✅ Supported: `yourdomain.com` (root domain)
- ❌ Not Supported: `localhost`, `127.0.0.1` (cannot obtain TLS certificates)

## Pre-Deployment Checklist

### 1. Server Preparation

- [ ] VPS provisioned with Ubuntu 22.04 LTS
- [ ] SSH access configured with key-based authentication
- [ ] Root or sudo access available
- [ ] Server timezone set (`timedatectl set-timezone UTC`)
- [ ] System packages updated (`apt update && apt upgrade -y`)

### 2. DNS Configuration

- [ ] Domain registered
- [ ] A record created: `api.yourdomain.com → <server-ip>`
- [ ] DNS propagation verified (`dig +short api.yourdomain.com`)
- [ ] TTL reduced to 300 seconds (5 minutes) for faster updates

### 3. Firewall & Security

- [ ] SSH key-based authentication enabled
- [ ] Password authentication disabled (`/etc/ssh/sshd_config: PasswordAuthentication no`)
- [ ] Firewall configured (UFW or iptables)
- [ ] Fail2ban installed and configured (optional but recommended)

### 4. Secrets & Credentials

- [ ] Strong passwords generated for all services
- [ ] Secrets stored in password manager (1Password, LastPass, etc.)
- [ ] Backup of `LAUNCHDB_MASTER_KEY` stored offline
- [ ] Backup of `BACKUP_ENCRYPTION_KEY` stored offline

### 5. Email Configuration (Optional)

- [ ] SMTP service account created (SendGrid, AWS SES, etc.)
- [ ] SMTP credentials obtained
- [ ] Sending domain verified (if required by SMTP provider)
- [ ] Test email sent successfully

### 6. Backup Strategy

- [ ] Offsite backup server prepared (optional but recommended)
- [ ] SSH key pair generated for rsync backups
- [ ] Public key added to backup server
- [ ] Backup destination tested (`rsync -avz /test/ user@backup-server:/backups/test/`)

## Installation Steps

### Step 1: Connect to Server

```bash
# Connect via SSH
ssh root@<server-ip>

# Or with non-root user
ssh ubuntu@<server-ip>
```

### Step 2: Install Docker

```bash
# Update package index
apt update && apt upgrade -y

# Install dependencies
apt install -y ca-certificates curl gnupg lsb-release

# Add Docker GPG key
mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Verify installation
docker --version
# Docker version 24.0.x, build xxxxx

docker compose version
# Docker Compose version v2.20.x
```

### Step 3: Configure Docker (Optional)

```bash
# Create Docker daemon configuration
cat > /etc/docker/daemon.json <<EOF
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
systemctl restart docker
```

### Step 4: Create Deployment Directory

```bash
# Create directory
mkdir -p /opt/launchdb
cd /opt/launchdb

# Create subdirectories
mkdir -p postgres/init
mkdir -p pgbouncer
mkdir -p scripts
mkdir -p postgrest/projects
mkdir -p platform-api/config
mkdir -p caddy
mkdir -p backup/ssh
```

### Step 5: Clone Repository

```bash
# Clone from GitHub
git clone https://github.com/yourusername/launchdb.git /opt/launchdb

# Or download release tarball
git clone https://github.com/yourusername/launchdb.git /opt/launchdb

# Verify structure
ls -la /opt/launchdb
# Should show: docker-compose.yml, scripts/, pgbouncer/, etc.
```

### Step 6: Install Additional Dependencies

```bash
# Install PostgreSQL client (for manual database access)
apt install -y postgresql-client

# Install monitoring tools
apt install -y htop iotop netcat-openbsd

# Install log rotation (if not using Docker log driver)
apt install -y logrotate
```

## Configuration

### Step 1: Create Environment File

```bash
cd /opt/launchdb

# Copy example environment file
cp .env.example .env

# Secure permissions (root only)
chmod 600 .env
chown root:root .env
```

### Step 2: Generate Secrets

```bash
# Generate all secrets at once
cat >> .env.secrets <<EOF
# Generated secrets - $(date)
POSTGRES_SUPERUSER_PASSWORD=$(openssl rand -base64 24)
AUTHENTICATOR_PASSWORD=$(openssl rand -base64 24)
LAUNCHDB_MASTER_KEY=$(openssl rand -base64 32)
PLATFORM_JWT_SECRET=$(openssl rand -base64 32)
POSTGREST_JWT_SECRET=$(openssl rand -base64 32)
INTERNAL_API_KEY=$(openssl rand -hex 32)
POSTGREST_ADMIN_KEY=$(openssl rand -hex 32)
BACKUP_ENCRYPTION_KEY=$(openssl rand -base64 32)
EOF

# Review generated secrets
cat .env.secrets

# ⚠️ CRITICAL: Backup this file immediately
cp .env.secrets /root/launchdb-secrets-$(date +%Y%m%d).txt
chmod 400 /root/launchdb-secrets-*.txt

# Append to .env
cat .env.secrets >> .env
rm .env.secrets  # Remove temporary file
```

### Step 3: Configure .env File

```bash
# Edit .env
vim .env
```

**Update the following variables:**

```bash
# ============================================================
# REQUIRED: Update these values
# ============================================================

# Domain (YOUR domain, not example.com)
DOMAIN=api.yourdomain.com

# Email for Let's Encrypt (monitored email)
ACME_EMAIL=ops@yourdomain.com

# Manager API paths (CRITICAL - use absolute paths)
HOST_SCRIPT_DIR=/opt/launchdb/scripts
HOST_CONFIG_DIR=/opt/launchdb/postgrest/projects

# ============================================================
# OPTIONAL: SMTP Configuration (if sending emails)
# ============================================================

# SMTP_HOST=smtp.sendgrid.net
# SMTP_PORT=587
# SMTP_USER=apikey
# SMTP_PASSWORD=SG.xxxxxxxxxxxx
# SMTP_FROM=noreply@yourdomain.com

# ============================================================
# OPTIONAL: Backup Configuration
# ============================================================

# BACKUP_RETENTION_DAYS=30
# RSYNC_DEST=backup@backup.yourdomain.com:/backups/launchdb
```

### Step 4: Configure PgBouncer

```bash
# PgBouncer userlist is generated from .env
cd /opt/launchdb/pgbouncer

# Generate userlist.txt with MD5 hashed passwords
cat > generate-userlist.sh <<'EOF'
#!/bin/bash
set -e

source ../.env

# Generate MD5 hash for PostgreSQL authentication
# Format: "username" "md5<md5 of password + username>"
function md5_hash() {
  local user="$1"
  local pass="$2"
  local hash=$(echo -n "${pass}${user}" | md5sum | awk '{print $1}')
  echo "\"${user}\" \"md5${hash}\""
}

# Create userlist.txt
cat > userlist.txt <<USERLIST
# PgBouncer userlist - Generated $(date)
# Format: "username" "md5<hash>"

# PostgreSQL superuser
$(md5_hash "$POSTGRES_SUPERUSER" "$POSTGRES_SUPERUSER_PASSWORD")

# Project authenticator roles (added dynamically by Manager API)
USERLIST

chmod 600 userlist.txt
echo "✅ Generated userlist.txt"
EOF

chmod +x generate-userlist.sh
./generate-userlist.sh
```

**Verify userlist.txt:**
```bash
cat userlist.txt
# Should show: "postgres" "md5<hash>"
```

### Step 5: Configure Caddy (Reverse Proxy)

```bash
cd /opt/launchdb/caddy

# Caddyfile is already configured in repository
# Verify configuration
cat Caddyfile
```

**Expected Caddyfile:**
```
# NOTE: Using http:// prefix when behind Cloudflare Tunnel
# Cloudflare handles TLS termination
http://{$DOMAIN} {
  # Platform API
  handle /api/* {
    reverse_proxy platform-api:8000
  }

  # Auth Service (per-project)
  handle /auth/* {
    reverse_proxy auth-service:8001
  }

  # PostgREST Routes (per-project database access)
  handle /db/* {
    reverse_proxy platform-api:8000
  }

  # Storage Service (per-project)
  handle /storage/* {
    reverse_proxy storage-service:8003
  }

  # Default Route (placeholder - no dashboard in v0.1.x)
  handle /* {
    respond "LaunchDB - API running."
  }
}
```

### Step 6: Set Correct File Permissions

```bash
cd /opt/launchdb

# PostgreSQL init scripts (if any)
chmod 755 postgres/init/*.sh 2>/dev/null || true

# PgBouncer config
chmod 600 pgbouncer/pgbouncer.ini
chmod 600 pgbouncer/userlist.txt

# Scripts (must be executable)
chmod 755 scripts/*.sh

# PostgREST config directory
chmod 755 postgrest/projects

# Backup scripts
chmod 755 backup/*.sh
chmod 600 backup/ssh/backup_key 2>/dev/null || true
```

## Service Startup

### Step 1: Build Custom Images

```bash
cd /opt/launchdb

# Build PgBouncer image
docker compose build pgbouncer

# Build Manager API image
docker compose build postgrest-manager

# Build PostgREST base image (used by per-project containers)
docker compose build postgrest-image

# Build Backup service image
docker compose build backup

# Verify images built
docker images | grep launchdb
# abushadaf/launchdb-pgbouncer          latest
# abushadaf/launchdb-postgrest-manager  latest
# abushadaf/launchdb-postgrest          latest
# abushadaf/launchdb-backup             latest
```

### Step 2: Start Core Infrastructure

```bash
# Start database and connection pooler first
docker compose up -d postgres

# Wait for PostgreSQL to be healthy
docker compose ps postgres
# Should show: Up (healthy)

# Start PgBouncer
docker compose up -d pgbouncer

# Wait for PgBouncer to be healthy
docker compose ps pgbouncer
# Should show: Up (healthy)
```

**Verify database connectivity:**
```bash
# Connect to PostgreSQL via PgBouncer
docker exec -it launchdb-postgres psql -U postgres -d platform

# Inside psql:
# \l          -- List databases
# \q          -- Quit
```

### Step 3: Start Platform Services

```bash
# Start Migrations service (needed by Platform API)
docker compose up -d migrations

# Wait for Migrations to be healthy
docker compose ps migrations

# Start Platform API
docker compose up -d platform-api

# Wait for Platform API to be healthy
docker compose ps platform-api
```

**Check Platform API logs:**
```bash
docker logs launchdb-platform-api --tail 50

# Should show:
# [NestJS] Platform API listening on port 8000
# [Database] Connected to platform database
```

### Step 4: Start Manager API

```bash
# Start Manager API (container orchestration)
docker compose up -d postgrest-manager

# Wait for Manager API to be healthy
docker compose ps postgrest-manager

# Check logs
docker logs launchdb-postgrest-manager --tail 20
# Should show: "Manager API listening on port 9000"
```

### Step 5: Start Application Services

```bash
# Start Auth service
docker compose up -d auth-service

# Start Storage service
docker compose up -d storage-service

# Wait for all services to be healthy
docker compose ps
```

### Step 6: Start Reverse Proxy

```bash
# Start Caddy (will obtain TLS certificate automatically)
docker compose up -d reverse-proxy

# Check logs for TLS certificate acquisition
docker logs launchdb-caddy --tail 50 -f

# Should show:
# [INFO] [api.yourdomain.com] acme: Obtaining bundled SAN certificate
# [INFO] [api.yourdomain.com] Certificate obtained successfully
```

**⚠️ IMPORTANT:** First TLS certificate acquisition may take 30-60 seconds. Monitor logs for errors.

### Step 7: Verify All Services

```bash
# Check all container statuses
docker compose ps

# Expected output: All services "Up (healthy)"
# launchdb-postgres            Up (healthy)
# launchdb-pgbouncer           Up (healthy)
# launchdb-platform-api        Up (healthy)
# launchdb-postgrest-manager   Up (healthy)
# launchdb-migrations          Up (healthy)
# launchdb-auth-service        Up (healthy)
# launchdb-storage-service     Up (healthy)
# launchdb-caddy               Up (healthy)
```

**If any service is unhealthy:**
```bash
# Check logs
docker logs <container-name>

# Restart unhealthy service
docker compose restart <service-name>
```

## Post-Deployment Verification

### 1. Health Check Endpoints

```bash
# Platform API health
curl https://api.yourdomain.com/api/health
# Expected: {"status":"ok","service":"platform-api"}

# Manager API health (internal, test from server)
curl http://localhost:9000/health
# Expected: {"status":"healthy","service":"postgrest-manager"}
```

### 2. Database Connectivity

```bash
# Test PostgreSQL connection
docker exec -it launchdb-postgres psql -U postgres -d platform -c "SELECT version();"

# Test PgBouncer connection
docker exec -it launchdb-postgres psql -U postgres -h pgbouncer -p 6432 -d platform -c "SELECT 1;"
```

### 3. TLS Certificate Verification

```bash
# Check certificate details
echo | openssl s_client -servername api.yourdomain.com -connect api.yourdomain.com:443 2>/dev/null | openssl x509 -noout -text | grep -E "(Issuer|Subject|Not After)"

# Expected issuer: Let's Encrypt
# Subject: CN=api.yourdomain.com
# Not After: <90 days from now>
```

### 4. Create Test Project

```bash
# Register test user via Platform API
curl -X POST https://api.yourdomain.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPassword123!"
  }'

# Login to get JWT token
JWT_TOKEN=$(curl -X POST https://api.yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPassword123!"
  }' | jq -r '.accessToken')

# Create test project
curl -X POST https://api.yourdomain.com/api/projects \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-project"
  }'

# Expected: 201 Created with project details
```

### 5. Verify PostgREST Container Spawned

```bash
# List PostgREST containers
docker ps --filter "name=postgrest-proj_"

# Should show: postgrest-proj_<project_id> container running

# Check PostgREST logs
docker logs postgrest-proj_<project_id>
# Should show: "Listening on port 3000"
```

### 6. Test PostgREST API

```bash
# Get project details (including API URL)
PROJECT=$(curl -X GET https://api.yourdomain.com/api/projects \
  -H "Authorization: Bearer $JWT_TOKEN" | jq -r '.projects[0]')

PROJECT_ID=$(echo $PROJECT | jq -r '.id')
echo "Project ID: $PROJECT_ID"

# Test PostgREST endpoint (should return empty array - no tables yet)
curl https://api.yourdomain.com/project/$PROJECT_ID/
# Expected: {"message":"root path","hint":"Try GET /table_name"}
```

### 7. Delete Test Project

```bash
# Clean up test project
curl -X DELETE https://api.yourdomain.com/api/projects/$PROJECT_ID \
  -H "Authorization: Bearer $JWT_TOKEN"

# Verify PostgREST container removed
docker ps --filter "name=postgrest-proj_$PROJECT_ID"
# Should show: No containers
```

**If all tests pass: ✅ Deployment successful!**

## Monitoring Setup

### 1. Container Monitoring

**Install Docker monitoring tools:**

```bash
# Option A: cAdvisor (lightweight)
docker run -d \
  --name=cadvisor \
  --restart=unless-stopped \
  --volume=/:/rootfs:ro \
  --volume=/var/run:/var/run:ro \
  --volume=/sys:/sys:ro \
  --volume=/var/lib/docker/:/var/lib/docker:ro \
  --publish=127.0.0.1:8080:8080 \
  gcr.io/cadvisor/cadvisor:latest

# Access: http://localhost:8080 (SSH tunnel or VPN only)
```

### 2. Log Monitoring

**Centralized log collection:**

```bash
# View all service logs
docker compose logs -f

# View specific service
docker compose logs -f platform-api

# View logs with timestamps
docker compose logs -f --timestamps platform-api

# Search logs
docker compose logs platform-api | grep ERROR
```

**Log rotation (already configured via Docker daemon):**
```bash
# Verify log rotation settings
cat /etc/docker/daemon.json
# Should show:
# {
#   "log-opts": {
#     "max-size": "10m",
#     "max-file": "3"
#   }
# }
```

### 3. Disk Space Monitoring

```bash
# Check disk usage
df -h

# Check Docker disk usage
docker system df

# Clean up unused resources (run periodically)
docker system prune -a --volumes
# WARNING: This removes all unused images, containers, and volumes
```

**Automated cleanup cron job:**
```bash
# Add to crontab
crontab -e

# Run cleanup weekly (Sunday 3 AM)
0 3 * * 0 docker system prune -af --volumes --filter "until=168h"
```

### 4. Uptime Monitoring

**External monitoring services:**
- UptimeRobot (https://uptimerobot.com) - Free tier available
- Pingdom (https://pingdom.com)
- Better Uptime (https://betteruptime.com)

**Monitor endpoints:**
- `https://api.yourdomain.com/api/health` (Platform API)
- `https://api.yourdomain.com` (Caddy)

### 5. Alerts

**Email alerts for critical issues:**

```bash
# Install monitoring script
cat > /usr/local/bin/launchdb-monitor.sh <<'EOF'
#!/bin/bash
# LaunchDB health monitor

ALERT_EMAIL="ops@yourdomain.com"

# Check if all critical services are running
CRITICAL_SERVICES="launchdb-postgres launchdb-pgbouncer launchdb-platform-api launchdb-postgrest-manager launchdb-caddy"

for SERVICE in $CRITICAL_SERVICES; do
  if ! docker ps --format "{{.Names}}" | grep -q "^${SERVICE}$"; then
    echo "ALERT: Service $SERVICE is not running" | mail -s "LaunchDB Alert: $SERVICE Down" $ALERT_EMAIL
  fi
done

# Check disk space (alert if > 80%)
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
if [ $DISK_USAGE -gt 80 ]; then
  echo "ALERT: Disk usage is ${DISK_USAGE}%" | mail -s "LaunchDB Alert: Disk Space" $ALERT_EMAIL
fi
EOF

chmod +x /usr/local/bin/launchdb-monitor.sh

# Add to crontab (run every 5 minutes)
crontab -e
# */5 * * * * /usr/local/bin/launchdb-monitor.sh
```

## Backup Configuration

### 1. Configure Backup Service

**SSH key setup (if using rsync):**
```bash
cd /opt/launchdb/backup/ssh

# Generate SSH key pair
ssh-keygen -t ed25519 -f backup_key -N ""

# Set permissions
chmod 600 backup_key
chmod 644 backup_key.pub

# Copy public key to backup server
ssh-copy-id -i backup_key.pub backup-user@backup.yourdomain.com
```

**Update .env with backup settings:**
```bash
vim /opt/launchdb/.env

# Add:
BACKUP_RETENTION_DAYS=30
RSYNC_DEST=backup-user@backup.yourdomain.com:/backups/launchdb
```

### 2. Manual Backup Test

```bash
# Run backup manually
docker exec launchdb-backup /backup.sh

# Check backup files
docker exec launchdb-backup ls -lh /backups

# Should show:
# platform_20241205_120000.sql.gz.gpg
# proj_xxx_20241205_120000.sql.gz.gpg
```

**Verify backup encryption:**
```bash
# Decrypt test backup
docker exec launchdb-backup sh -c '
  gpg --decrypt --passphrase "$BACKUP_ENCRYPTION_KEY" \
    /backups/platform_20241205_120000.sql.gz.gpg | gunzip | head -20
'

# Should show SQL dump header
```

### 3. Automated Backup Schedule

```bash
# Add backup cron job
crontab -e

# Daily backups at 2 AM
0 2 * * * docker exec launchdb-backup /backup.sh >> /var/log/launchdb-backup.log 2>&1
```

### 4. Backup Monitoring

```bash
# Check last backup time
docker exec launchdb-backup ls -lt /backups | head -5

# Verify backups exist on remote server (if using rsync)
ssh backup-user@backup.yourdomain.com "ls -lh /backups/launchdb | tail -10"
```

## Maintenance Procedures

### 1. Update LaunchDB

```bash
cd /opt/launchdb

# Pull latest changes
git fetch origin
git checkout main  # Or specific version tag

# Or download new release
git clone https://github.com/yourusername/launchdb.git /opt/launchdb

# Rebuild images
docker compose build

# Restart services with rolling update
docker compose up -d --no-deps --build platform-api
docker compose up -d --no-deps --build postgrest-manager

# Verify services restarted successfully
docker compose ps
```

### 2. Update Docker Images

```bash
# Pull latest base images
docker compose pull postgres
docker compose pull caddy

# Restart services
docker compose up -d postgres
docker compose up -d reverse-proxy
```

### 3. Database Maintenance

**Vacuum and analyze:**
```bash
# Vacuum platform database
docker exec -it launchdb-postgres psql -U postgres -d platform -c "VACUUM ANALYZE;"

# Vacuum all project databases
docker exec -it launchdb-postgres psql -U postgres -c "
SELECT 'VACUUM ANALYZE;'
FROM pg_database
WHERE datname LIKE 'proj_%';" \
| xargs -I {} docker exec -it launchdb-postgres psql -U postgres -d {} -c {}
```

**Check database size:**
```bash
docker exec -it launchdb-postgres psql -U postgres -c "
SELECT
  datname AS database,
  pg_size_pretty(pg_database_size(datname)) AS size
FROM pg_database
WHERE datname NOT IN ('template0', 'template1')
ORDER BY pg_database_size(datname) DESC;"
```

### 4. Certificate Renewal

**Automatic:** Caddy handles certificate renewal automatically (60 days before expiration).

**Manual renewal (if needed):**
```bash
# Restart Caddy to force certificate renewal
docker compose restart reverse-proxy

# Check logs
docker logs launchdb-caddy --tail 50 | grep -i certificate
```

### 5. Rotate Secrets

**⚠️ WARNING:** Rotating `LAUNCHDB_MASTER_KEY` will invalidate all encrypted data. Only rotate other secrets.

**Rotate INTERNAL_API_KEY:**
```bash
# 1. Generate new key
NEW_INTERNAL_API_KEY=$(openssl rand -hex 32)

# 2. Update .env
vim /opt/launchdb/.env
# Change: INTERNAL_API_KEY=<new_value>

# 3. Restart services that use this key
docker compose restart platform-api
docker compose restart postgrest-manager
docker compose restart migrations

# 4. Verify health
curl https://api.yourdomain.com/api/health
```

**Rotate SMTP password:**
```bash
# 1. Update password in SMTP provider dashboard

# 2. Update .env
vim /opt/launchdb/.env
# Change: SMTP_PASSWORD=<new_value>

# 3. Restart Auth service
docker compose restart auth-service
```

### 6. Scale Down / Pause Services

**Temporarily pause LaunchDB:**
```bash
# Stop all services
docker compose stop

# Resume services
docker compose start
```

**Remove unused PostgREST containers:**
```bash
# List all PostgREST containers
docker ps -a --filter "name=postgrest-proj_" --format "{{.Names}}\t{{.Status}}"

# Remove exited containers
docker ps -a --filter "name=postgrest-proj_" --filter "status=exited" -q | xargs -r docker rm
```

## Scaling Considerations

### Vertical Scaling (Increase VPS Resources)

**When to scale:**
- CPU usage consistently > 80%
- Memory usage consistently > 85%
- Disk I/O bottlenecks (check with `iotop`)

**Upgrade VPS plan:**
1. Resize VPS via hosting provider dashboard
2. Reboot server
3. Verify new resources: `lscpu`, `free -h`, `df -h`
4. Update PostgreSQL tuning if memory increased

### Horizontal Scaling (Multiple Servers)

**Not supported in v0.1.x.** LaunchDB v0.1.x is designed for single-VPS deployment.

**Future horizontal scaling options (v0.2.0+):**
- Multiple PostgreSQL instances (sharded by project)
- Load balancer for PostgREST containers
- Kubernetes for container orchestration
- Managed PostgreSQL (RDS, Cloud SQL)

### Connection Pool Tuning

**Increase per-project pool size:**

```bash
# Edit default in pgbouncer-add-project.sh
vim /opt/launchdb/scripts/pgbouncer-add-project.sh

# Change line 8:
POOL_SIZE="${2:-10}"  # Increase from 5 to 10

# Apply to existing projects manually:
docker exec --user root launchdb-pgbouncer vi /etc/pgbouncer/pgbouncer.ini
# Change: pool_size=5 → pool_size=10 for specific projects

# Reload PgBouncer
docker exec launchdb-pgbouncer kill -HUP 1
```

**Increase PostgreSQL max_connections:**

```bash
# Edit docker-compose.yml
vim /opt/launchdb/docker-compose.yml

# Change line 45:
- "max_connections=1000"  # Increase from 500

# Restart PostgreSQL
docker compose restart postgres
```

## Rollback Procedures

### Rollback Application Code

```bash
cd /opt/launchdb

# Checkout previous version
git checkout v0.1.4  # Replace with previous stable version

# Rebuild images
docker compose build

# Restart services
docker compose up -d

# Verify rollback
curl https://api.yourdomain.com/api/health
```

### Restore Database from Backup

```bash
# 1. Stop services accessing database
docker compose stop platform-api migrations auth-service storage-service

# 2. List available backups
docker exec launchdb-backup ls -lt /backups

# 3. Restore platform database
BACKUP_FILE="platform_20241205_020000.sql.gz.gpg"

docker exec launchdb-backup sh -c "
  gpg --decrypt --batch --passphrase \"\$BACKUP_ENCRYPTION_KEY\" \
    /backups/$BACKUP_FILE | \
  gunzip | \
  psql -U postgres -h postgres -d platform
"

# 4. Restart services
docker compose start platform-api migrations auth-service storage-service

# 5. Verify
curl https://api.yourdomain.com/api/health
```

### Emergency Stop All Services

```bash
# Stop all services immediately
docker compose down

# Stop specific service
docker stop launchdb-platform-api
```

## Troubleshooting

### Issue: Caddy Cannot Obtain TLS Certificate

**Symptoms:**
- `curl https://api.yourdomain.com` returns "connection refused" or "certificate invalid"
- Caddy logs show "ACME challenge failed"

**Troubleshooting:**
```bash
# 1. Verify DNS resolves correctly
dig +short api.yourdomain.com
# Should return server IP

# 2. Verify port 80 accessible from internet
curl -I http://api.yourdomain.com
# Should return HTTP response (not connection refused)

# 3. Check firewall
ufw status | grep -E "(80|443)"
# Should show: 80/tcp ALLOW, 443/tcp ALLOW

# 4. Check Caddy logs
docker logs launchdb-caddy --tail 100 | grep -i error
```

**Solution:**
- Ensure DNS A record points to server IP
- Ensure ports 80/443 accessible (check VPS firewall and cloud provider security groups)
- Wait 5-10 minutes for DNS propagation

---

### Issue: PostgreSQL Out of Connections

**Symptoms:**
- Platform API returns 500 errors
- Logs show "FATAL: sorry, too many clients already"

**Troubleshooting:**
```bash
# Check active connections
docker exec launchdb-postgres psql -U postgres -c "
SELECT count(*), state
FROM pg_stat_activity
GROUP BY state;"

# Check max_connections setting
docker exec launchdb-postgres psql -U postgres -c "SHOW max_connections;"
```

**Solution:**
```bash
# Increase max_connections in docker-compose.yml
vim docker-compose.yml
# Line 45: max_connections=1000

# Restart PostgreSQL
docker compose restart postgres
```

---

### Issue: PgBouncer Config Corrupted

**Symptoms:**
- PostgREST containers crash with "authentication failed"
- PgBouncer logs show "invalid config"

**Troubleshooting:**
```bash
# Check PgBouncer config integrity
docker exec --user root launchdb-pgbouncer cat /etc/pgbouncer/pgbouncer.ini | wc -l
# Should be ~80+ lines, not 0

# Check for recent backups
docker exec --user root launchdb-pgbouncer ls -lt /etc/pgbouncer/pgbouncer.ini.backup*
```

**Solution:**
```bash
# Restore from latest backup
LATEST_BACKUP=$(docker exec --user root launchdb-pgbouncer ls -t /etc/pgbouncer/pgbouncer.ini.backup* | head -1)

docker exec --user root launchdb-pgbouncer cp $LATEST_BACKUP /etc/pgbouncer/pgbouncer.ini

# Reload PgBouncer
docker exec launchdb-pgbouncer kill -HUP 1
```

---

### Issue: Manager API Cannot Spawn Containers

**Symptoms:**
- Project creation returns 500 error
- Manager API logs show "cannot mount volume" or "path does not exist"

**Troubleshooting:**
```bash
# Check HOST_SCRIPT_DIR exists
ls -la /opt/launchdb/scripts

# Check HOST_CONFIG_DIR exists
ls -la /opt/launchdb/postgrest/projects

# Check Manager API environment variables
docker exec launchdb-postgrest-manager env | grep HOST_
```

**Solution:**
```bash
# Create missing directories
mkdir -p /opt/launchdb/scripts
mkdir -p /opt/launchdb/postgrest/projects

# Update .env with correct paths
vim /opt/launchdb/.env
# HOST_SCRIPT_DIR=/opt/launchdb/scripts
# HOST_CONFIG_DIR=/opt/launchdb/postgrest/projects

# Restart Manager API
docker compose restart postgrest-manager
```

---

### Issue: Disk Space Full

**Symptoms:**
- Services crash or restart unexpectedly
- Logs show "no space left on device"

**Troubleshooting:**
```bash
# Check disk usage
df -h

# Check Docker disk usage
docker system df

# Find large files
du -sh /opt/launchdb/* | sort -h

# Check log sizes
du -sh /var/lib/docker/containers/*/*-json.log | sort -h | tail -10
```

**Solution:**
```bash
# Clean up Docker resources
docker system prune -a --volumes

# Clean up old backups (if stored locally)
find /opt/launchdb/backups -name "*.gpg" -mtime +30 -delete

# Increase disk size via VPS provider
# Then resize filesystem:
resize2fs /dev/vda1  # Adjust device name
```

---

### Issue: All Services Slow / High Latency

**Troubleshooting:**
```bash
# Check CPU usage
top

# Check memory usage
free -h

# Check disk I/O
iotop

# Check network
netstat -tuln
```

**Solution:**
- Vertical scaling (increase VPS resources)
- Optimize database queries (add indexes)
- Enable query caching in Platform API
- Reduce connection pool sizes to free memory

---

## Support & Resources

- **Documentation:** `/docs/`
- **GitHub Issues:** https://github.com/yourusername/launchdb/issues
- **Architecture Overview:** `/docs/architecture.md`
- **Manager API Docs:** `/docs/infrastructure/manager-api.md`
- **Environment Variables:** `/docs/infrastructure/environment-vars.md`

---

**Deployment checklist complete? ✅ Your LaunchDB instance is production-ready!**
