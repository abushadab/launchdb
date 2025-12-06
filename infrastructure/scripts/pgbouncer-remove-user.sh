#!/bin/bash
# Remove a user from PgBouncer userlist.txt
# Usage: ./pgbouncer-remove-user.sh <username>

set -e

USERNAME="${1}"

if [ -z "$USERNAME" ]; then
    echo "Error: username required"
    echo "Usage: $0 <username>"
    exit 1
fi

PGBOUNCER_CONTAINER="launchdb-pgbouncer"
USERLIST="/etc/pgbouncer/userlist.txt"

# Check if PgBouncer container exists
if ! docker ps --format '{{.Names}}' | grep -q "^${PGBOUNCER_CONTAINER}$"; then
    echo "Error: PgBouncer container '${PGBOUNCER_CONTAINER}' is not running"
    exit 1
fi

# Backup current userlist (inside PgBouncer container)
BACKUP_FILE="${USERLIST}.backup.$(date +%s)"
docker exec --user root "${PGBOUNCER_CONTAINER}" cp "$USERLIST" "$BACKUP_FILE" 2>/dev/null || true
echo "Backed up userlist to: $BACKUP_FILE"

# Check if user exists
if ! docker exec --user root "${PGBOUNCER_CONTAINER}" grep -q "^\"${USERNAME}\"" "$USERLIST" 2>/dev/null; then
    echo "Warning: User '${USERNAME}' not found in PgBouncer userlist"
    exit 0
fi

# Remove user entry using docker exec
# Use grep -v to filter out the entry, then overwrite the file
# Run as root to ensure write permissions to userlist file
# Use mktemp for concurrency safety (avoid race conditions with fixed paths)
# Use flock for atomic read-modify-write to prevent file corruption
# Simplified quoting to avoid syntax errors in nested sh -c
docker exec --user root "${PGBOUNCER_CONTAINER}" sh -c "
  (
    flock -x 200
    TMPFILE=\$(mktemp)
    grep -v '^\"${USERNAME}\"' ${USERLIST} > \"\${TMPFILE}\"
    cat \"\${TMPFILE}\" > ${USERLIST}
    rm \"\${TMPFILE}\"
  ) 200>${USERLIST}.lock
"

echo "Removed user '${USERNAME}' from PgBouncer userlist"

# Reload PgBouncer (send SIGHUP signal to PID 1)
docker exec --user root "${PGBOUNCER_CONTAINER}" kill -HUP 1
echo "Reloaded PgBouncer via docker"

echo "User '${USERNAME}' successfully removed from PgBouncer"
