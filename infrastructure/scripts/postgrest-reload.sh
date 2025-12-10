#!/bin/bash
# Reload PostgREST configuration by sending SIGHUP signal to a per-project container
# Usage: ./postgrest-reload.sh <project_id>
#
# NOTE: In the per-project PostgREST architecture, each project has its own container.
# This script sends SIGHUP to reload the config without restarting the container.
# Alternative: Use `docker restart postgrest-{projectId}` to fully restart.

set -e

PROJECT_ID="${1}"

if [ -z "$PROJECT_ID" ]; then
    echo "Error: project_id required"
    echo "Usage: $0 <project_id>"
    echo ""
    echo "Example: $0 proj_abc123"
    echo ""
    echo "This will reload the PostgREST container for the specified project."
    exit 1
fi

CONTAINER_NAME="postgrest-${PROJECT_ID}"
PID_FILE="/var/run/postgrest.pid"

# Check if container exists
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Error: Container ${CONTAINER_NAME} is not running"
    echo "Available PostgREST containers:"
    docker ps --filter "name=^postgrest-" --format "  - {{.Names}}"
    exit 1
fi

echo "Reloading PostgREST for project: ${PROJECT_ID}"
echo "Container: ${CONTAINER_NAME}"

# Read PID from file inside container
POSTGREST_PID=$(docker exec "${CONTAINER_NAME}" cat "$PID_FILE" 2>/dev/null || echo "")

if [ -z "$POSTGREST_PID" ]; then
    echo "Error: PID file not found at ${PID_FILE}"
    echo "This may indicate:"
    echo "  - Container is using old image without PID file support"
    echo "  - Wrapper script failed to start properly"
    echo ""
    echo "Solutions:"
    echo "  1. Rebuild with: docker-compose build postgrest-image"
    echo "  2. Restart container: docker restart ${CONTAINER_NAME}"
    echo "  3. Check logs: docker logs ${CONTAINER_NAME}"
    exit 1
fi

# Send SIGHUP to PostgREST process
if docker exec "${CONTAINER_NAME}" kill -HUP "$POSTGREST_PID"; then
    echo "PostgREST reloaded successfully (PID: $POSTGREST_PID)"
    exit 0
else
    echo "Error: Failed to send SIGHUP to PostgREST (PID: $POSTGREST_PID)"
    echo "Process may have crashed. Check logs: docker logs ${CONTAINER_NAME}"
    exit 1
fi
