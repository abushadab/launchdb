#!/bin/bash
# LaunchDB Storage Backup Script
# Syncs storage objects to remote location using rsync
#
# Usage: ./storage-backup.sh
#
# Environment variables:
#   STORAGE_PATH       - Local storage path (default: /storage)
#   RSYNC_DEST         - Remote rsync destination (required, e.g., user@host:/storage-backups)
#   RSYNC_SSH_KEY_PATH - SSH key for rsync (default: /root/.ssh/backup_key)
#   BACKUP_RETENTION_DAYS - Days to keep old files on remote (default: 30)

set -euo pipefail

# Configuration
STORAGE_PATH="${STORAGE_PATH:-/storage}"
RSYNC_DEST="${RSYNC_DEST:-}"
RSYNC_SSH_KEY_PATH="${RSYNC_SSH_KEY_PATH:-/root/.ssh/backup_key}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
LOG_FILE="/backups/storage-backup.log"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"
}

# Error handling
error_exit() {
    log "ERROR: $1"
    exit 1
}

# Check required environment variables
if [ -z "$RSYNC_DEST" ]; then
    error_exit "RSYNC_DEST is required (e.g., user@host:/storage-backups)"
fi

if [ ! -d "$STORAGE_PATH" ]; then
    error_exit "Storage path does not exist: $STORAGE_PATH"
fi

log "=== LaunchDB Storage Backup Started ==="
log "Storage path: $STORAGE_PATH"
log "Remote destination: $RSYNC_DEST"

# Calculate storage size
STORAGE_SIZE=$(du -sh "$STORAGE_PATH" 2>/dev/null | cut -f1 || echo "unknown")
log "Storage size: $STORAGE_SIZE"

# Perform rsync (using conditional execution to avoid eval command injection)
log "Starting rsync to remote..."
START_TIME=$(date +%s)

# Execute rsync with proper quoting - no eval needed
if [ -f "$RSYNC_SSH_KEY_PATH" ]; then
    log "Using SSH key: $RSYNC_SSH_KEY_PATH"
    # Use accept-new instead of no for better security (prevents MITM attacks on key changes)
    if rsync -avz --delete --stats \
        -e "ssh -i \"$RSYNC_SSH_KEY_PATH\" -o StrictHostKeyChecking=accept-new" \
        --exclude '*.tmp' --exclude '.DS_Store' --exclude 'Thumbs.db' \
        "$STORAGE_PATH/" "$RSYNC_DEST/" 2>&1 | tee -a "${LOG_FILE}"; then
        END_TIME=$(date +%s)
        DURATION=$((END_TIME - START_TIME))
        log "Rsync completed successfully in ${DURATION} seconds"
    else
        error_exit "Rsync failed"
    fi
else
    if rsync -avz --delete --stats \
        --exclude '*.tmp' --exclude '.DS_Store' --exclude 'Thumbs.db' \
        "$STORAGE_PATH/" "$RSYNC_DEST/" 2>&1 | tee -a "${LOG_FILE}"; then
        END_TIME=$(date +%s)
        DURATION=$((END_TIME - START_TIME))
        log "Rsync completed successfully in ${DURATION} seconds"
    else
        error_exit "Rsync failed"
    fi
fi

# Remote cleanup (optional)
if [ "$RETENTION_DAYS" -gt 0 ]; then
    log "Cleaning up remote files older than $RETENTION_DAYS days..."

    # Extract remote host and path using bash parameter expansion
    # More robust than cut for IPv6 addresses and paths with colons
    REMOTE_HOST="${RSYNC_DEST%%:*}"
    REMOTE_PATH="${RSYNC_DEST#*:}"

    # Validate REMOTE_PATH to prevent command injection
    # Allow alphanumeric, slash, dot, underscore, hyphen only
    if ! [[ "$REMOTE_PATH" =~ ^[a-zA-Z0-9/_.-]+$ ]]; then
        error_exit "Invalid REMOTE_PATH format: $REMOTE_PATH (only alphanumeric, /, _, ., - allowed)"
    fi

    # Run cleanup on remote
    # Use accept-new instead of no for better security (prevents MITM attacks on key changes)
    if [ -f "$RSYNC_SSH_KEY_PATH" ]; then
        if ssh -i "$RSYNC_SSH_KEY_PATH" -o StrictHostKeyChecking=accept-new \
            "$REMOTE_HOST" "find '$REMOTE_PATH' -type f -mtime +$RETENTION_DAYS -delete" 2>&1 | tee -a "${LOG_FILE}"; then
            log "Remote cleanup completed"
        else
            log "WARNING: Remote cleanup failed (non-critical)"
        fi
    else
        if ssh "$REMOTE_HOST" "find '$REMOTE_PATH' -type f -mtime +$RETENTION_DAYS -delete" 2>&1 | tee -a "${LOG_FILE}"; then
            log "Remote cleanup completed"
        else
            log "WARNING: Remote cleanup failed (non-critical)"
        fi
    fi
fi

log "=== LaunchDB Storage Backup Completed ==="
