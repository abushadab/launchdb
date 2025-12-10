# LaunchDB Deployment Guide

## Pre-Deployment Checklist

### Server Requirements
- [ ] Ubuntu 22.04 LTS or similar
- [ ] Minimum 4 vCPU, 8 GB RAM, 50 GB disk
- [ ] Docker 20.10+ installed
- [ ] Docker Compose 2.0+ installed
- [ ] Domain name with DNS access
- [ ] Firewall configured (ports 22, 80, 443)

### Prerequisites Installation
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Docker Compose (if not included)
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify
docker --version
docker-compose --version
```

## Step 1: DNS Configuration

Point your domain to the server:
```bash
# A record
api.example.com  →  123.45.67.89

# Verify DNS propagation
dig api.example.com +short
```

## Step 2: Firewall Configuration

```bash
# Using ufw (Ubuntu)
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (ACME challenge)
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# Verify
sudo ufw status
```

## Step 3: Clone/Copy Configuration

```bash
# Create deployment directory
mkdir -p /opt/launchdb
cd /opt/launchdb

# Clone the LaunchDB repository
git clone https://github.com/your-org/launchdb.git .
cd infrastructure
```

## Step 4: Environment Configuration

```bash
# Copy template
cp .env.example .env

# Generate and replace secrets (using sed to avoid duplicates)
sed -i "s|POSTGRES_SUPERUSER_PASSWORD=.*|POSTGRES_SUPERUSER_PASSWORD=$(openssl rand -base64 24)|" .env
sed -i "s|AUTHENTICATOR_PASSWORD=.*|AUTHENTICATOR_PASSWORD=$(openssl rand -base64 24)|" .env
sed -i "s|LAUNCHDB_MASTER_KEY=.*|LAUNCHDB_MASTER_KEY=$(openssl rand -base64 32)|" .env
sed -i "s|PLATFORM_JWT_SECRET=.*|PLATFORM_JWT_SECRET=$(openssl rand -base64 32)|" .env
sed -i "s|POSTGREST_JWT_SECRET=.*|POSTGREST_JWT_SECRET=$(openssl rand -base64 32)|" .env
sed -i "s|INTERNAL_API_KEY=.*|INTERNAL_API_KEY=$(openssl rand -hex 32)|" .env
sed -i "s|POSTGREST_ADMIN_KEY=.*|POSTGREST_ADMIN_KEY=$(openssl rand -hex 32)|" .env
sed -i "s|BACKUP_ENCRYPTION_KEY=.*|BACKUP_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env

# Set domain and email
sed -i "s|DOMAIN=.*|DOMAIN=your-domain.com|" .env
sed -i "s|ACME_EMAIL=.*|ACME_EMAIL=your-email@example.com|" .env

# Review and adjust any remaining values
nano .env
```

**IMPORTANT**: Back up the `.env` file securely! Store in password manager or encrypted vault.

## Step 5: Configure PgBouncer

```bash
# Update pgbouncer/userlist.txt with hashed passwords
# Generate MD5 hash for postgres user
cd scripts
./pgbouncer-add-user.sh postgres "$POSTGRES_SUPERUSER_PASSWORD"
./pgbouncer-add-user.sh authenticator "$AUTHENTICATOR_PASSWORD"
```

## Step 6: Build Custom Images

Before deploying, build the custom images required by LaunchDB:

### Build Custom PostgREST Image
```bash
# Build the custom Alpine-based PostgREST image with shell and PID file support
docker-compose build postgrest-image

# Verify image was created
docker images | grep launchdb/postgrest

# Expected output:
# launchdb/postgrest  v1  <image-id>  <timestamp>  ~30MB
```

**Why a custom image?**
The official PostgREST image (postgrest/postgrest:v11.2.2) is distroless with no shell, preventing PID file creation needed for SIGHUP-based config reload. Our custom image:
- Based on Alpine Linux 3.19
- Includes PostgREST v11.2.2 static binary
- Has built-in wrapper script that writes `/var/run/postgrest.pid`
- Includes curl for healthchecks

### Build Backup Image
```bash
# Build backup container with gpg/rsync dependencies
docker-compose build backup

# Verify
docker images | grep launchdb/backup
```

### Optional: Push to Registry
If deploying to multiple servers or using a CI/CD pipeline:

```bash
# Tag images
docker tag launchdb/postgrest:v1 registry.example.com/launchdb/postgrest:v1
docker tag launchdb/backup:latest registry.example.com/launchdb/backup:latest

# Push to registry
docker push registry.example.com/launchdb/postgrest:v1
docker push registry.example.com/launchdb/backup:latest

# On deployment servers, pull images
docker pull registry.example.com/launchdb/postgrest:v1
docker pull registry.example.com/launchdb/backup:latest
```

## Step 7: Deploy Services

```bash
# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f

# Specifically check postgrest-manager
docker-compose logs postgrest-manager
```

## Step 8: Verify Deployment

### Check Service Health
```bash
# All services should be "healthy" or "Up"
docker-compose ps

# Check individual services
docker-compose logs platform-api | tail -20
docker-compose logs dashboard-ui | tail -20
docker-compose logs caddy | tail -20
```

### Test Endpoints
```bash
# HTTPS should work (Caddy auto-TLS)
curl -I https://your-domain.com

# Health check (if implemented)
curl https://your-domain.com/api/health

# PostgREST Manager health (internal)
docker exec launchdb-platform-api curl http://postgrest-manager:9000/health
# Should return: {"status":"healthy","service":"postgrest-manager"}
```

### Test PostgREST Per-Project Containers
```bash
# List running PostgREST containers (should be empty initially)
curl -X GET http://localhost:9000/internal/postgrest \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}"

# Create a test project container
# First, generate config
docker exec launchdb-postgrest-manager \
  /scripts/postgrest-add-project.sh proj_test "$(openssl rand -base64 32)" "$(openssl rand -base64 24)"

# Spawn the container
curl -X POST http://localhost:9000/internal/postgrest/spawn \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
  -d '{"projectId": "proj_test"}'

# Verify container is running
docker ps --filter "name=postgrest-proj_test"

# Test config reload
curl -X POST http://localhost:9000/internal/postgrest/proj_test/restart \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}"

# Clean up test container
curl -X DELETE http://localhost:9000/internal/postgrest/proj_test \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}"
```

### Check Database
```bash
# Connect to postgres
docker exec -it launchdb-postgres psql -U postgres -d platform

# Run queries
\l                          # List databases
\dt platform.*              # List platform tables
SELECT * FROM platform.owners LIMIT 1;
\q
```

### Check PgBouncer
```bash
# Connect via PgBouncer
docker exec -it launchdb-pgbouncer psql -h 127.0.0.1 -p 6432 -U postgres -d platform

# Show pools
SHOW POOLS;
SHOW STATS;
\q
```

## Step 9: Configure Backups

### Set Up SSH Key for Remote Backup
```bash
# Generate SSH key
ssh-keygen -t ed25519 -f backup_key -N ""

# Copy to remote server
ssh-copy-id -i backup_key.pub backup-user@backup.example.com

# Place key in backup/ssh directory
mkdir -p backup/ssh
cp backup_key backup/ssh/backup_key
chmod 600 backup/ssh/backup_key

# Update .env with remote backup destination
sed -i 's|RSYNC_DEST=.*|RSYNC_DEST=backup-user@backup.example.com:/var/backups/launchdb|' .env

# Restart backup container
docker-compose restart backup
```

### Test Backup
```bash
# Manual backup
docker exec launchdb-backup /backup.sh --platform

# Verify backup file
docker exec launchdb-backup ls -lh /backups/

# Test storage backup
docker exec launchdb-backup /storage-backup.sh
```

### Schedule Backups
```bash
# Add to crontab (on host)
crontab -e

# Add these lines:
0 2 * * * docker exec launchdb-backup /backup.sh --all
0 3 * * * docker exec launchdb-backup /storage-backup.sh
```

## Step 10: Create First Owner/Project

```bash
# Connect to database
docker exec -it launchdb-postgres psql -U postgres -d platform

# Create test owner (password should be hashed in production)
INSERT INTO platform.owners (email, password_hash, name)
VALUES ('admin@example.com', crypt('admin123', gen_salt('bf')), 'Admin User');

# Create test project
INSERT INTO platform.projects (id, name, owner_id, status)
VALUES ('proj_test', 'Test Project', (SELECT id FROM platform.owners LIMIT 1), 'active');

\q
```

## Step 11: Monitoring Setup

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f platform-api

# Follow with timestamps
docker-compose logs -f -t
```

### Check Resource Usage
```bash
# Docker stats
docker stats

# Disk usage
docker system df

# Volume usage
docker volume ls
```

### Caddy Metrics
```bash
# Prometheus metrics
curl http://localhost:2019/metrics
```

## Post-Deployment Checklist

- [ ] All services are running and healthy
- [ ] HTTPS works (green padlock in browser)
- [ ] Database connections work
- [ ] PgBouncer stats show active pools
- [ ] Backup runs successfully
- [ ] Remote backup destination accessible
- [ ] Cron jobs scheduled
- [ ] `.env` file backed up securely
- [ ] Firewall rules active
- [ ] SSH key-based auth configured
- [ ] Monitoring/alerting configured

## Troubleshooting

### Caddy Can't Get Certificate
```bash
# Check DNS
dig your-domain.com +short

# Check ports
sudo netstat -tlnp | grep ':80\|:443'

# Check Caddy logs
docker logs launchdb-caddy

# Manual cert test
docker exec launchdb-caddy caddy trust
```

### Database Connection Refused
```bash
# Check postgres is running
docker-compose ps postgres

# Check postgres logs
docker-compose logs postgres

# Test connection
docker exec launchdb-postgres psql -U postgres -c "SELECT 1"
```

### PgBouncer Auth Fails
```bash
# Check userlist.txt
docker exec launchdb-pgbouncer cat /etc/pgbouncer/userlist.txt

# Regenerate with correct password
docker exec launchdb-pgbouncer /scripts/pgbouncer-add-user.sh postgres "$POSTGRES_SUPERUSER_PASSWORD"
```

### Service Won't Start
```bash
# Check logs
docker-compose logs [service-name]

# Check environment
docker-compose config

# Restart
docker-compose restart [service-name]
```

## Maintenance

### Update Services
```bash
# Pull latest images
docker-compose pull

# Recreate containers
docker-compose up -d

# Remove old images
docker image prune -f
```

### Restart Services
```bash
# Restart all
docker-compose restart

# Restart specific service
docker-compose restart platform-api
```

### View Service Info
```bash
# Inspect container
docker inspect launchdb-platform-api

# Execute command in container
docker exec -it launchdb-platform-api sh
```

## Rollback Procedure

If deployment fails:

```bash
# Stop services
docker-compose down

# Restore from backup
docker exec launchdb-backup /restore.sh /backups/platform_20231201_020000.sql.gpg platform

# Restore previous .env
cp .env.backup .env

# Start services
docker-compose up -d
```

## Security Hardening

### 1. Disable Password SSH
```bash
# Edit SSH config
sudo nano /etc/ssh/sshd_config

# Set:
PasswordAuthentication no
PermitRootLogin no

# Restart
sudo systemctl restart sshd
```

### 2. Enable Automatic Updates
```bash
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### 3. Configure Fail2Ban
```bash
sudo apt install fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### 4. Regular Security Audit
```bash
# Check for updates
sudo apt update && apt list --upgradable

# Check open ports
sudo netstat -tlnp

# Check Docker images
docker images | grep -v REPOSITORY | awk '{print $1":"$2}' | xargs -I {} docker pull {}
```

## Next Steps

1. Configure application services (Sonnet A)
2. Set up monitoring (Prometheus, Grafana)
3. Configure alerting (PagerDuty, email)
4. Implement log aggregation (ELK, Loki)
5. Set up staging environment
6. Document runbooks for common issues

## Support

For issues:
- Check logs: `docker-compose logs -f`
- Review documentation in `README.md`
- Open an issue on GitHub
