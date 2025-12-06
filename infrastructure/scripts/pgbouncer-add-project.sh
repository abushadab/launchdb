#!/bin/bash
# Add a project database to PgBouncer configuration
# Usage: ./pgbouncer-add-project.sh <project_id> <pool_size> <reserve_pool>

set -e

PROJECT_ID="${1}"
POOL_SIZE="${2:-5}"
RESERVE_POOL="${3:-2}"

if [ -z "$PROJECT_ID" ]; then
    echo "Error: project_id required"
    echo "Usage: $0 <project_id> [pool_size] [reserve_pool]"
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

# Check if project already exists
if docker exec --user root "${PGBOUNCER_CONTAINER}" grep -q "^${PROJECT_ID} =" "$PGBOUNCER_INI" 2>/dev/null; then
    echo "Warning: Project ${PROJECT_ID} already exists in PgBouncer config"
    exit 0
fi

# Add project database entry using docker exec
# Insert after the [databases] section header
# Use awk to read, insert, and write to temp file, then overwrite original
# Run as root to ensure write permissions to config file
# Use mktemp for concurrency safety (avoid race conditions with fixed paths)
# Use flock for atomic read-modify-write to prevent file corruption
# Simplified quoting to avoid syntax errors in nested sh -c
docker exec --user root "${PGBOUNCER_CONTAINER}" sh -c "
  (
    flock -x 200
    TMPFILE=\$(mktemp)
    awk '/^\[databases\]/{print; print \"${PROJECT_ID} = host=postgres port=5432 dbname=${PROJECT_ID} pool_size=${POOL_SIZE} reserve_pool=${RESERVE_POOL}\"; next}1' ${PGBOUNCER_INI} > \"\${TMPFILE}\"
    cat \"\${TMPFILE}\" > ${PGBOUNCER_INI}
    rm \"\${TMPFILE}\"
  ) 200>${PGBOUNCER_INI}.lock
"

echo "Added ${PROJECT_ID} to PgBouncer config"
echo "  pool_size: ${POOL_SIZE}"
echo "  reserve_pool: ${RESERVE_POOL}"

# Reload PgBouncer (send SIGHUP signal to PID 1)
docker exec --user root "${PGBOUNCER_CONTAINER}" kill -HUP 1
echo "Reloaded PgBouncer via docker"

echo "Project ${PROJECT_ID} successfully added to PgBouncer"
