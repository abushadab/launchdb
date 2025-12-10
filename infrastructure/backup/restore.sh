#!/bin/bash
# LaunchDB Restore Script
# Restores a database from encrypted backup
#
# Usage: ./restore.sh <backup_file.sql.gpg> <target_database>
#
# Environment variables:
#   POSTGRES_HOST      - Postgres host (default: postgres)
#   POSTGRES_PORT      - Postgres port (default: 5432)
#   POSTGRES_USER      - Postgres superuser (default: postgres)
#   POSTGRES_PASSWORD  - Postgres password (required)
#   BACKUP_ENCRYPTION_KEY - GPG passphrase for decryption (required)

set -euo pipefail

# Configuration
POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# Error handling
error_exit() {
    log "ERROR: $1"
    exit 1
}

# Check arguments
if [ $# -ne 2 ]; then
    echo "Usage: $0 <backup_file.sql.gpg> <target_database>"
    echo ""
    echo "Example:"
    echo "  $0 /backups/proj_abc123_20231201_120000.sql.gpg proj_abc123"
    exit 1
fi

BACKUP_FILE="$1"
TARGET_DB="$2"

# Validate inputs
if [ ! -f "$BACKUP_FILE" ]; then
    error_exit "Backup file not found: $BACKUP_FILE"
fi

# Validate TARGET_DB format to prevent SQL injection
# Allow alphanumeric, underscore, and hyphen only
if [ -z "$TARGET_DB" ]; then
    error_exit "Target database name is required"
fi

if ! [[ "$TARGET_DB" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    error_exit "Invalid database name: $TARGET_DB (only alphanumeric, underscore, hyphen allowed)"
fi

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
    error_exit "POSTGRES_PASSWORD is required"
fi

if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
    error_exit "BACKUP_ENCRYPTION_KEY is required for decryption"
fi

log "=== LaunchDB Restore Started ==="
log "Backup file: $BACKUP_FILE"
log "Target database: $TARGET_DB"

# Decrypt backup
TEMP_SQL="/tmp/restore_${TARGET_DB}_$$.sql"
log "Decrypting backup..."

# Use here-string (<<<) instead of echo to avoid exposing key in process list
if gpg \
    --batch \
    --yes \
    --passphrase-fd 0 \
    --decrypt \
    -o "${TEMP_SQL}" \
    "${BACKUP_FILE}" 2>/dev/null \
    <<< "${BACKUP_ENCRYPTION_KEY}"; then

    log "Backup decrypted successfully"
else
    error_exit "Failed to decrypt backup file"
fi

# Check if database exists
DB_EXISTS=$(PGPASSWORD="${POSTGRES_PASSWORD}" psql \
    -h "${POSTGRES_HOST}" \
    -p "${POSTGRES_PORT}" \
    -U "${POSTGRES_USER}" \
    -d postgres \
    -tAc "SELECT 1 FROM pg_database WHERE datname='${TARGET_DB}'")

if [ "$DB_EXISTS" = "1" ]; then
    log "WARNING: Database ${TARGET_DB} already exists"
    read -p "Drop and recreate database? (yes/no): " confirm

    if [ "$confirm" != "yes" ]; then
        log "Restore cancelled by user"
        rm -f "${TEMP_SQL}"
        exit 0
    fi

    log "Dropping database ${TARGET_DB}..."
    PGPASSWORD="${POSTGRES_PASSWORD}" psql \
        -h "${POSTGRES_HOST}" \
        -p "${POSTGRES_PORT}" \
        -U "${POSTGRES_USER}" \
        -d postgres \
        -c "DROP DATABASE ${TARGET_DB};" || error_exit "Failed to drop database"
fi

# Create database
log "Creating database ${TARGET_DB}..."
PGPASSWORD="${POSTGRES_PASSWORD}" psql \
    -h "${POSTGRES_HOST}" \
    -p "${POSTGRES_PORT}" \
    -U "${POSTGRES_USER}" \
    -d postgres \
    -c "CREATE DATABASE ${TARGET_DB};" || error_exit "Failed to create database"

# Restore backup
log "Restoring backup to ${TARGET_DB}..."
if PGPASSWORD="${POSTGRES_PASSWORD}" psql \
    -h "${POSTGRES_HOST}" \
    -p "${POSTGRES_PORT}" \
    -U "${POSTGRES_USER}" \
    -d "${TARGET_DB}" \
    -f "${TEMP_SQL}" 2>&1 | tee /tmp/restore.log; then

    log "Restore completed successfully"
else
    log "WARNING: Restore completed with errors (check /tmp/restore.log)"
fi

# Cleanup
rm -f "${TEMP_SQL}"

log "=== LaunchDB Restore Completed ==="
log "Database ${TARGET_DB} has been restored from ${BACKUP_FILE}"
