#!/bin/bash
# Spawn a per-project PostgREST container
# Usage: ./postgrest-spawn.sh <project_id>
#
# This creates a dedicated PostgREST container for the project using
# the config file at /etc/postgrest/projects/{project_id}.conf

set -e

PROJECT_ID="${1}"

if [ -z "$PROJECT_ID" ]; then
    echo "Error: project_id required"
    echo "Usage: $0 <project_id>"
    exit 1
fi

CONTAINER_NAME="postgrest-${PROJECT_ID}"
CONFIG_FILE="/etc/postgrest.conf"
IMAGE="launchdb/postgrest:v1"

# Auto-detect network name from PgBouncer container (handles Docker Compose project prefix)
# This ensures PostgREST always joins the same network as PgBouncer
# Can be overridden with LAUNCHDB_NETWORK env var
if [ -n "$LAUNCHDB_NETWORK" ]; then
    NETWORK="$LAUNCHDB_NETWORK"
    echo "Using configured network: ${NETWORK}"
else
    PGBOUNCER_CONTAINER=$(docker ps --filter name=pgbouncer --format '{{.Names}}' | head -1)

    if [ -z "$PGBOUNCER_CONTAINER" ]; then
        echo "Error: PgBouncer container not found"
        echo "Available containers:"
        docker ps --format '{{.Names}}'
        exit 1
    fi

    NETWORK=$(docker inspect "$PGBOUNCER_CONTAINER" --format '{{range $net, $config := .NetworkSettings.Networks}}{{$net}}{{end}}' | head -1)

    if [ -z "$NETWORK" ]; then
        echo "Error: Could not determine network for PgBouncer container"
        exit 1
    fi

    echo "Detected network from PgBouncer: ${NETWORK}"
fi

# Paths inside manager container (mounted from host)
MANAGER_CONFIG_DIR="/etc/postgrest/projects"

# Host paths for Docker daemon (must match docker-compose volume mounts)
# REQUIRED: HOST_CONFIG_DIR must be set as environment variable
# No defaults for portability - fail fast if not configured
if [ -z "$HOST_CONFIG_DIR" ]; then
    echo "Error: HOST_CONFIG_DIR environment variable is required"
    echo ""
    echo "This must point to the absolute path on the Docker host where"
    echo "PostgREST config files are stored (e.g., /opt/launchdb/postgrest/projects)"
    echo ""
    echo "Set this in:"
    echo "  - docker-compose.yml under postgrest-manager environment"
    echo "  - .env file: HOST_CONFIG_DIR=/absolute/path/to/postgrest/projects"
    echo ""
    echo "Example: HOST_CONFIG_DIR=/opt/launchdb/postgrest/projects"
    exit 1
fi

# Check if config file exists (in manager container)
if [ ! -f "${MANAGER_CONFIG_DIR}/${PROJECT_ID}.conf" ]; then
    echo "Error: Config file not found: ${MANAGER_CONFIG_DIR}/${PROJECT_ID}.conf"
    echo "Generate config first using postgrest-add-project.sh"
    exit 1
fi

echo "Using host path for Docker daemon:"
echo "  Config: ${HOST_CONFIG_DIR}/${PROJECT_ID}.conf"
echo "Note: Wrapper script is built into custom launchdb/postgrest:v1 image"

# Check if container already exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Container ${CONTAINER_NAME} already exists"

    # Check if it's running
    if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
        echo "Container is already running"
        exit 0
    else
        echo "Starting existing container..."
        docker start "${CONTAINER_NAME}"
        exit 0
    fi
fi

echo "Spawning PostgREST container for project: ${PROJECT_ID}"

# Get DOMAIN from environment (optional, for openapi-server-proxy-uri)
DOMAIN="${DOMAIN:-}"

# Spawn PostgREST container
# Note: Using custom launchdb/postgrest:v1 image with Alpine + shell + wrapper
# The wrapper script is built into the image, only config needs to be mounted
echo "Using custom PostgREST image: ${IMAGE}"

# Build Docker command using array (safer than eval)
DOCKER_CMD=(
    docker run -d
    --name "${CONTAINER_NAME}"
    --network "${NETWORK}"
    --restart unless-stopped
    -v "${HOST_CONFIG_DIR}/${PROJECT_ID}.conf:${CONFIG_FILE}:ro"
)

# Add DOMAIN env var if set (for openapi-server-proxy-uri expansion in config)
if [ -n "$DOMAIN" ]; then
    DOCKER_CMD+=(-e "DOMAIN=${DOMAIN}")
fi

# Add health check and image
DOCKER_CMD+=(
    --health-cmd 'curl -f http://localhost:3000/ || exit 1'
    --health-interval 30s
    --health-timeout 10s
    --health-retries 3
    --health-start-period 30s
    "${IMAGE}"
    "${CONFIG_FILE}"
)

# Execute docker command (no eval needed with array)
"${DOCKER_CMD[@]}"

echo "PostgREST container spawned: ${CONTAINER_NAME}"
echo "Container ID: $(docker ps -qf name=${CONTAINER_NAME})"
echo "Config file: ${CONFIG_FILE}"

# Wait for container to be healthy
echo "Waiting for container to be healthy..."
TIMEOUT=90
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
    HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "${CONTAINER_NAME}" 2>/dev/null || echo "starting")

    if [ "$HEALTH" = "healthy" ]; then
        echo "Container is healthy!"
        exit 0
    fi

    echo "Status: $HEALTH (${ELAPSED}s/${TIMEOUT}s)"
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

echo "Warning: Container did not become healthy within ${TIMEOUT}s"
echo "Check logs: docker logs ${CONTAINER_NAME}"
exit 1
