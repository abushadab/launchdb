#!/bin/bash
# LaunchDB Backup Script
# Performs nightly per-project database dumps with encryption and retention
#
# Usage: ./backup.sh [--project <project_id>] [--all]
#
# Environment variables:
#   POSTGRES_HOST      - Postgres host (default: postgres)
#   POSTGRES_PORT      - Postgres port (default: 5432)
#   POSTGRES_USER      - Postgres superuser (default: postgres)
#   POSTGRES_PASSWORD  - Postgres password (required)
#   BACKUP_RETENTION_DAYS - Days to keep backups (default: 7)
#   BACKUP_ENCRYPTION_KEY - GPG passphrase for encryption (required)
#   RSYNC_DEST         - Remote rsync destination (optional, e.g., user@host:/backups)
#   RSYNC_SSH_KEY_PATH - SSH key for rsync (default: /root/.ssh/backup_key)

set -euo pipefail

# Configuration
POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
BACKUP_DIR="/backups"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="${BACKUP_DIR}/backup.log"

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

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
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
    error_exit "POSTGRES_PASSWORD is required"
fi

if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
    error_exit "BACKUP_ENCRYPTION_KEY is required for encryption"
fi

# Get list of project databases
get_project_databases() {
    PGPASSWORD="${POSTGRES_PASSWORD}" psql \
        -h "${POSTGRES_HOST}" \
        -p "${POSTGRES_PORT}" \
        -U "${POSTGRES_USER}" \
        -d platform \
        -t -c "SELECT id FROM projects WHERE status = 'active' ORDER BY id;" \
        2>/dev/null || echo ""
}

# Backup a single database
backup_database() {
    local db_name="$1"
    local backup_file="${BACKUP_DIR}/${db_name}_${TIMESTAMP}.sql"
    local encrypted_file="${backup_file}.gpg"

    log "Starting backup for database: ${db_name}"

    # Perform pg_dump
    if PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
        -h "${POSTGRES_HOST}" \
        -p "${POSTGRES_PORT}" \
        -U "${POSTGRES_USER}" \
        -d "${db_name}" \
        -F p \
        --no-owner \
        --no-acl \
        -f "${backup_file}" 2>>"${LOG_FILE}"; then

        log "Database dump completed: ${backup_file}"

        # Encrypt the backup
        log "Encrypting backup..."
        # Use here-string (<<<) instead of echo to avoid exposing key in process list
        if gpg \
            --batch \
            --yes \
            --passphrase-fd 0 \
            --symmetric \
            --cipher-algo AES256 \
            -o "${encrypted_file}" \
            "${backup_file}" 2>>"${LOG_FILE}" \
            <<< "${BACKUP_ENCRYPTION_KEY}"; then

            log "Backup encrypted: ${encrypted_file}"

            # Remove unencrypted backup
            rm -f "${backup_file}"

            # Calculate and log file size
            local size=$(du -h "${encrypted_file}" | cut -f1)
            log "Backup size: ${size}"

            return 0
        else
            log "ERROR: Failed to encrypt backup for ${db_name}"
            rm -f "${backup_file}"
            return 1
        fi
    else
        log "ERROR: pg_dump failed for ${db_name}"
        return 1
    fi
}

# Backup platform database
backup_platform() {
    log "Backing up platform database..."
    backup_database "platform"
}

# Backup all project databases
backup_all_projects() {
    local projects=$(get_project_databases)

    if [ -z "$projects" ]; then
        log "No active projects found to backup"
        return 0
    fi

    local count=0
    local failed=0

    while IFS= read -r project_id; do
        # Trim whitespace
        project_id=$(echo "$project_id" | xargs)

        if [ -n "$project_id" ]; then
            if backup_database "$project_id"; then
                ((count++))
            else
                ((failed++))
            fi
        fi
    done <<< "$projects"

    log "Backed up ${count} project databases, ${failed} failed"
}

# Clean up old backups
cleanup_old_backups() {
    log "Cleaning up backups older than ${RETENTION_DAYS} days..."

    local deleted_count=$(find "${BACKUP_DIR}" -name "*.sql.gpg" -type f -mtime "+${RETENTION_DAYS}" -delete -print | wc -l)

    log "Deleted ${deleted_count} old backup files"
}

# Sync backups to remote location
sync_to_remote() {
    if [ -z "${RSYNC_DEST:-}" ]; then
        log "RSYNC_DEST not set, skipping remote sync"
        return 0
    fi

    log "Syncing backups to remote: ${RSYNC_DEST}"

    # Use conditional execution instead of eval to avoid command injection
    if [ -n "${RSYNC_SSH_KEY_PATH:-}" ] && [ -f "${RSYNC_SSH_KEY_PATH}" ]; then
        # Use accept-new instead of no for better security (prevents MITM attacks on key changes)
        if rsync -avz --delete \
            -e "ssh -i \"${RSYNC_SSH_KEY_PATH}\" -o StrictHostKeyChecking=accept-new" \
            "${BACKUP_DIR}/" "${RSYNC_DEST}/" 2>>"${LOG_FILE}"; then
            log "Remote sync completed successfully"
        else
            log "WARNING: Remote sync failed"
            return 1
        fi
    else
        if rsync -avz --delete "${BACKUP_DIR}/" "${RSYNC_DEST}/" 2>>"${LOG_FILE}"; then
            log "Remote sync completed successfully"
        else
            log "WARNING: Remote sync failed"
            return 1
        fi
    fi
}

# Main execution
main() {
    log "=== LaunchDB Backup Started ==="

    local backup_type="${1:-all}"

    case "$backup_type" in
        --all)
            backup_platform
            backup_all_projects
            ;;
        --platform)
            backup_platform
            ;;
        --project)
            if [ -z "${2:-}" ]; then
                error_exit "Project ID required with --project flag"
            fi
            backup_database "$2"
            ;;
        *)
            # Default: backup everything
            backup_platform
            backup_all_projects
            ;;
    esac

    cleanup_old_backups
    sync_to_remote

    log "=== LaunchDB Backup Completed ==="
}

# Run main function
main "$@"
