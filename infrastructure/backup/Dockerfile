FROM postgres:15-alpine

# Install dependencies for backup scripts
# - gpg: For encrypting backups with AES-256-GCM
# - rsync: For remote backup synchronization
# - openssh-client: For SSH connections to remote backup servers
RUN apk add --no-cache \
    gnupg \
    rsync \
    openssh-client

# Set working directory
WORKDIR /app

# Note: Backup scripts are mounted as volumes from host
# This container is run on-demand, not as a service
# Usage: docker exec launchdb-backup /backup.sh

CMD ["echo", "Backup container ready. Run: docker exec launchdb-backup /backup.sh"]
