#!/bin/bash
# Add a user to PgBouncer userlist.txt with MD5 hashed password
# Usage: PGBOUNCER_USER_PASSWORD=<password> ./pgbouncer-add-user.sh <username>

set -e

USERNAME="${1}"
PASSWORD="${PGBOUNCER_USER_PASSWORD}"

if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
    echo "Error: username and password required"
    echo "Usage: PGBOUNCER_USER_PASSWORD=<password> $0 <username>"
    exit 1
fi

# Validate USERNAME format (alphanumeric, underscore, hyphen only)
if ! [[ "$USERNAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "Error: username contains invalid characters (only alphanumeric, underscore, hyphen allowed)"
    exit 1
fi

# Validate PASSWORD length and characters (avoid shell metacharacters)
# Only allow safe characters to prevent injection in nested shell commands
if [ ${#PASSWORD} -lt 8 ]; then
    echo "Error: password must be at least 8 characters"
    exit 1
fi

if ! [[ "$PASSWORD" =~ ^[a-zA-Z0-9@#%_+=!.-]+$ ]]; then
    echo "Error: password contains invalid characters"
    echo "Allowed characters: A-Z a-z 0-9 @ # % _ + = ! . -"
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

# Generate MD5 hash: md5(password + username)
# PgBouncer expects format: "username" "md5<hash>"
HASH_INPUT="${PASSWORD}${USERNAME}"
MD5_HASH=$(echo -n "$HASH_INPUT" | md5sum | awk '{print $1}')
PGBOUNCER_PASSWORD="md5${MD5_HASH}"

# Remove existing entry if present (using docker exec)
# Use grep -v to filter out the old entry, then overwrite the file
# Run as root to ensure write permissions to userlist file
# Use mktemp for concurrency safety (avoid race conditions with fixed paths)
# Use flock for atomic read-modify-write to prevent file corruption
# Simplified quoting to avoid syntax errors in nested sh -c
docker exec --user root "${PGBOUNCER_CONTAINER}" sh -c "
  (
    flock -x 200
    TMPFILE=\$(mktemp)
    (grep -v '^\"${USERNAME}\"' ${USERLIST} > \"\${TMPFILE}\" || true)
    cat \"\${TMPFILE}\" > ${USERLIST}
    rm \"\${TMPFILE}\"
  ) 200>${USERLIST}.lock
"

# Add new entry (using docker exec with flock for atomic append)
docker exec --user root "${PGBOUNCER_CONTAINER}" sh -c "
  (
    flock -x 200
    echo '\"${USERNAME}\" \"${PGBOUNCER_PASSWORD}\"' >> ${USERLIST}
  ) 200>${USERLIST}.lock
"

echo "Added user '${USERNAME}' to PgBouncer userlist"
echo "Password hash: ${PGBOUNCER_PASSWORD}"

# Reload PgBouncer (send SIGHUP signal to PID 1)
docker exec --user root "${PGBOUNCER_CONTAINER}" kill -HUP 1
echo "Reloaded PgBouncer via docker"

echo "User '${USERNAME}' successfully added to PgBouncer"
