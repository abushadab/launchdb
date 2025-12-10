#!/bin/bash
# Generate PostgREST configuration for a project
# Usage: ./postgrest-add-project.sh <project_id> <jwt_secret> <authenticator_password>
#
# This script generates a PostgREST config file for a project and stores it
# in /etc/postgrest/projects/<project_id>.conf
#
# Per interfaces.md: PostgREST uses file+SIGHUP reload pattern
# Platform writes config file, then sends SIGHUP to reload

set -e

PROJECT_ID="${1}"
JWT_SECRET="${2}"
AUTHENTICATOR_PASSWORD="${3}"

if [ -z "$PROJECT_ID" ] || [ -z "$JWT_SECRET" ] || [ -z "$AUTHENTICATOR_PASSWORD" ]; then
    echo "Error: Missing required arguments"
    echo "Usage: $0 <project_id> <jwt_secret> <authenticator_password>"
    exit 1
fi

# Validate PROJECT_ID format (alphanumeric, underscore, hyphen only)
if ! [[ "$PROJECT_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "Error: project_id contains invalid characters (only alphanumeric, underscore, hyphen allowed)"
    exit 1
fi

# URL-encode password to handle special characters (+/= from base64)
# This prevents URI parsing issues in PostgREST db-uri
urlencode() {
    local string="${1}"
    local strlen=${#string}
    local encoded=""
    local pos c o

    for (( pos=0 ; pos<strlen ; pos++ )); do
        c=${string:$pos:1}
        case "$c" in
            [-_.~a-zA-Z0-9] ) o="${c}" ;;
            * ) printf -v o '%%%02x' "'$c"
        esac
        encoded+="${o}"
    done
    echo "${encoded}"
}

# Configuration paths
CONFIG_DIR="${POSTGREST_CONFIG_DIR:-/etc/postgrest/projects}"
CONFIG_FILE="${CONFIG_DIR}/${PROJECT_ID}.conf"
BACKUP_FILE="${CONFIG_FILE}.backup.$(date +%s)"

# Ensure config directory exists
mkdir -p "$CONFIG_DIR"

# Backup existing config if present
if [ -f "$CONFIG_FILE" ]; then
    cp "$CONFIG_FILE" "$BACKUP_FILE"
    echo "Backed up existing config to: $BACKUP_FILE"
fi

# Database connection settings (via PgBouncer)
DB_NAME="$PROJECT_ID"
DB_USER="${PROJECT_ID}_authenticator"
# Percent-encode password for use in URI
ENCODED_PASSWORD=$(urlencode "$AUTHENTICATOR_PASSWORD")

# Generate PostgREST config
cat > "$CONFIG_FILE" <<EOF
# PostgREST Configuration for Project: ${PROJECT_ID}
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# See: https://postgrest.org/en/stable/references/configuration.html

# Database connection (via PgBouncer)
# Note: Password is percent-encoded to handle special characters (+/= from base64)
db-uri = "postgres://${DB_USER}:${ENCODED_PASSWORD}@pgbouncer:6432/${DB_NAME}"
db-schemas = "public,storage"
db-anon-role = "anon"
db-pool = 10
db-pool-acquisition-timeout = 10

# JWT settings (per interfaces.md)
jwt-secret = "${JWT_SECRET}"
jwt-aud = "authenticated"

# Server settings
server-port = 3000

# OpenAPI
openapi-server-proxy-uri = "https://\${DOMAIN}/db/${PROJECT_ID}"

# Limits (per interfaces.md)
max-rows = 1000

# Logging
log-level = "info"

# Note: Uses global roles (anon, authenticated, service_role)
# DB connection routed through PgBouncer for connection pooling
EOF

echo "PostgREST config created: $CONFIG_FILE"

# Set secure permissions
chmod 600 "$CONFIG_FILE"
echo "Set permissions to 600 (owner read/write only)"

echo "Project ${PROJECT_ID} PostgREST config successfully created"

# Spawn per-project PostgREST container
# NOTE: In the per-project architecture, each project gets its own container
# No need to reload - the new container starts fresh with this config
echo "Spawning PostgREST container for project ${PROJECT_ID}..."
SPAWN_SCRIPT="$(dirname "$0")/postgrest-spawn.sh"
if [ -f "$SPAWN_SCRIPT" ]; then
    "$SPAWN_SCRIPT" "$PROJECT_ID"
else
    echo "Warning: postgrest-spawn.sh not found at $SPAWN_SCRIPT"
    echo "You can manually spawn the container using:"
    echo "  docker run -d --name postgrest-${PROJECT_ID} --network launchdb-internal \\"
    echo "    -v ${CONFIG_DIR}/${PROJECT_ID}.conf:/etc/postgrest/config:ro \\"
    echo "    postgrest/postgrest:v11.2.2"
fi
