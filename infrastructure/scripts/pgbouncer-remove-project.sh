#!/bin/bash
# Remove a project database from PgBouncer configuration
# Usage: ./pgbouncer-remove-project.sh <project_id>

set -e

PROJECT_ID="${1}"

if [ -z "$PROJECT_ID" ]; then
    echo "Error: project_id required"
    echo "Usage: $0 <project_id>"
    exit 1
fi

# Validate PROJECT_ID format (alphanumeric, underscore, hyphen only)
if ! [[ "$PROJECT_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "Error: project_id contains invalid characters (only alphanumeric, underscore, hyphen allowed)"
    exit 1
fi

PGBOUNCER_CONTAINER="launchdb-pgbouncer"
PGBOUNCER_INI="/etc/pgbouncer/pgbouncer.ini"

# Check if PgBouncer container exists
if ! docker ps --format '{{.Names}}' | grep -q "^${PGBOUNCER_CONTAINER}$"; then
    echo "Error: PgBouncer container '${PGBOUNCER_CONTAINER}' is not running"
    exit 1
fi

# Backup current config (inside PgBouncer container)
BACKUP_FILE="${PGBOUNCER_INI}.backup.$(date +%s)"
docker exec --user root "${PGBOUNCER_CONTAINER}" cp "$PGBOUNCER_INI" "$BACKUP_FILE" 2>/dev/null || true
echo "Backed up config to: $BACKUP_FILE"

# Check if project exists
if ! docker exec --user root "${PGBOUNCER_CONTAINER}" grep -q "^${PROJECT_ID} =" "$PGBOUNCER_INI" 2>/dev/null; then
    echo "Warning: Project ${PROJECT_ID} not found in PgBouncer config"
    exit 0
fi

# Remove project database entry using docker exec
# Use grep -v to filter out the entry, then overwrite the file
# Run as root to ensure write permissions to config file
# Use mktemp for concurrency safety (avoid race conditions with fixed paths)
# Use flock for atomic read-modify-write to prevent file corruption
# Simplified quoting to avoid syntax errors in nested sh -c
docker exec --user root "${PGBOUNCER_CONTAINER}" sh -c "
  (
    flock -x 200
    TMPFILE=\$(mktemp)
    grep -v '^${PROJECT_ID} =' ${PGBOUNCER_INI} > \"\${TMPFILE}\"
    cat \"\${TMPFILE}\" > ${PGBOUNCER_INI}
    rm \"\${TMPFILE}\"
  ) 200>${PGBOUNCER_INI}.lock
"

echo "Removed ${PROJECT_ID} from PgBouncer config"

# Reload PgBouncer (send SIGHUP signal to PID 1)
docker exec --user root "${PGBOUNCER_CONTAINER}" kill -HUP 1
echo "Reloaded PgBouncer via docker"

echo "Project ${PROJECT_ID} successfully removed from PgBouncer"
