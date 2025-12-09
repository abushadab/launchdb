#!/bin/bash
# Configure user for PgBouncer with SCRAM-SHA-256 auth_query
# Usage: ./pgbouncer-add-user.sh <username>
# Note: Password is NOT required - PgBouncer uses auth_query to fetch SCRAM hash from pg_shadow

set -e

USERNAME="${1}"

if [ -z "$USERNAME" ]; then
    echo "Error: username required"
    echo "Usage: $0 <username>"
    exit 1
fi

# Validate USERNAME format (alphanumeric, underscore, hyphen only)
if ! [[ "$USERNAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "Error: username contains invalid characters (only alphanumeric, underscore, hyphen allowed)"
    exit 1
fi

PGBOUNCER_CONTAINER="launchdb-pgbouncer"

# Check if PgBouncer container exists
if ! docker ps --format '{{.Names}}' | grep -q "^${PGBOUNCER_CONTAINER}$"; then
    echo "Error: PgBouncer container '${PGBOUNCER_CONTAINER}' is not running"
    exit 1
fi

# With SCRAM-SHA-256 auth_query, passwords are dynamically retrieved from pg_shadow
# This script only needs to reload PgBouncer to pick up new users
# The PostgreSQL user is created by platform-api before this script runs

echo "User '${USERNAME}' authentication configured"
echo "PgBouncer will use auth_query to retrieve SCRAM-SHA-256 hash from PostgreSQL"

# Reload PgBouncer (send SIGHUP signal to PID 1)
docker exec --user root "${PGBOUNCER_CONTAINER}" kill -HUP 1
echo "Reloaded PgBouncer via docker"

echo "User '${USERNAME}' successfully added to PgBouncer"
