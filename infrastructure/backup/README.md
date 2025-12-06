# LaunchDB Backup Scripts

## Overview
Automated backup scripts for LaunchDB with encryption, retention, and remote sync.

## Components

### 1. Database Backup (`backup.sh`)
- **Function**: Nightly per-project PostgreSQL dumps
- **Encryption**: AES256 via GPG
- **Retention**: Configurable (default: 7 days)
- **Remote Sync**: Optional rsync to secondary location

**Usage:**
```bash
# Backup all databases (platform + all projects)
docker exec launchdb-backup /backup.sh --all

# Backup only platform database
docker exec launchdb-backup /backup.sh --platform

# Backup specific project
docker exec launchdb-backup /backup.sh --project proj_abc123
```

### 2. Storage Backup (`storage-backup.sh`)
- **Function**: Rsync of storage objects to remote location
- **Incremental**: Only syncs changed files
- **Cleanup**: Removes old files on remote

**Usage:**
```bash
docker exec launchdb-backup /storage-backup.sh
```

### 3. Restore (`restore.sh`)
- **Function**: Restore database from encrypted backup
- **Safety**: Prompts before dropping existing database

**Usage:**
```bash
docker exec launchdb-backup /restore.sh \
  /backups/proj_abc123_20231201_120000.sql.gpg \
  proj_abc123
```

## Environment Variables

### Required
- `POSTGRES_PASSWORD`: PostgreSQL superuser password
- `BACKUP_ENCRYPTION_KEY`: GPG passphrase for encryption/decryption

### Optional
- `POSTGRES_HOST`: PostgreSQL host (default: `postgres`)
- `POSTGRES_PORT`: PostgreSQL port (default: `5432`)
- `POSTGRES_USER`: PostgreSQL user (default: `postgres`)
- `BACKUP_RETENTION_DAYS`: Days to keep backups (default: `7`)
- `RSYNC_DEST`: Remote destination (e.g., `user@host:/backups`)
- `RSYNC_SSH_KEY_PATH`: SSH key path (default: `/root/.ssh/backup_key`)

## Setup

### 1. Configure Environment
Create `.env` file or add to docker-compose.yml:
```env
POSTGRES_PASSWORD=your_secure_password
BACKUP_ENCRYPTION_KEY=your_gpg_passphrase
RSYNC_DEST=backup-user@backup.example.com:/var/backups/launchdb
BACKUP_RETENTION_DAYS=7
```

### 2. Set Up SSH Key for Remote Sync (Optional)
```bash
# Generate SSH key
ssh-keygen -t ed25519 -f backup_key -N ""

# Copy public key to remote server
ssh-copy-id -i backup_key.pub backup-user@backup.example.com

# Place key in backup/ssh directory
mkdir -p backup/ssh
cp backup_key backup/ssh/backup_key
chmod 600 backup/ssh/backup_key
```

### 3. Schedule Backups
Add to crontab (on host):
```bash
# Daily database backup at 2 AM
0 2 * * * docker exec launchdb-backup /backup.sh --all

# Daily storage backup at 3 AM
0 3 * * * docker exec launchdb-backup /storage-backup.sh
```

See `crontab.example` for more options.

## Backup File Format

### Database Backups
```
<database_name>_<timestamp>.sql.gpg
```
Examples:
- `platform_20231201_020000.sql.gpg`
- `proj_abc123_20231201_020015.sql.gpg`

### Location
- Local: `/backups` volume (mapped to `backup-data` volume)
- Remote: Configured via `RSYNC_DEST`

## Testing

### Test Database Backup
```bash
docker exec launchdb-backup /backup.sh --platform
docker exec launchdb-backup ls -lh /backups
```

### Test Storage Backup
```bash
# Dry run
docker exec launchdb-backup rsync -avzn /storage/ $RSYNC_DEST/

# Actual backup
docker exec launchdb-backup /storage-backup.sh
```

### Test Restore
```bash
# Create test database
docker exec launchdb-backup /restore.sh \
  /backups/proj_test_20231201_020000.sql.gpg \
  proj_test_restored
```

## Monitoring

### Check Backup Logs
```bash
docker exec launchdb-backup tail -f /backups/backup.log
docker exec launchdb-backup tail -f /backups/storage-backup.log
```

### Check Backup Size
```bash
docker exec launchdb-backup du -sh /backups
```

### List Recent Backups
```bash
docker exec launchdb-backup ls -lht /backups/*.gpg | head -20
```

## Security Notes

1. **Encryption Key**: Store `BACKUP_ENCRYPTION_KEY` securely (e.g., in password manager)
2. **SSH Keys**: Use dedicated SSH key with restricted permissions on remote server
3. **Remote Access**: Configure firewall rules to restrict rsync access
4. **Backup Storage**: Ensure remote storage is encrypted at rest
5. **Key Rotation**: Rotate encryption keys periodically (requires re-encrypting old backups)

## Disaster Recovery

### Full System Restore
1. Deploy fresh LaunchDB stack
2. Restore platform database first
3. Restore each project database
4. Restore storage objects
5. Update DNS/configuration as needed

### Restore Checklist
- [ ] Platform database restored
- [ ] All project databases restored
- [ ] Storage objects synced
- [ ] Database connections verified
- [ ] Application services restarted
- [ ] PostgREST configs regenerated
- [ ] PgBouncer configs updated

## Troubleshooting

### Backup Fails: "gpg: decryption failed"
- Verify `BACKUP_ENCRYPTION_KEY` is correct
- Check GPG is installed in backup container

### Rsync Fails: "Permission denied"
- Verify SSH key permissions (should be 600)
- Check remote user has write access to destination
- Test SSH connection: `ssh -i backup_key user@host`

### Database Restore Fails
- Check PostgreSQL is running
- Verify `POSTGRES_PASSWORD` is correct
- Ensure target database doesn't exist (or confirm drop)

### Large Backup Files
- Consider using compressed format: `-F c` in pg_dump
- Implement incremental backups for very large databases
- Monitor storage capacity on backup destination
