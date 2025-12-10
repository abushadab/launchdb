#!/bin/bash
# Stop and remove a per-project PostgREST container
# Usage: ./postgrest-stop.sh <project_id>

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

CONTAINER_NAME="postgrest-${PROJECT_ID}"

# Check if container exists
if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Container ${CONTAINER_NAME} does not exist"
    exit 0
fi

echo "Stopping PostgREST container: ${CONTAINER_NAME}"
docker stop "${CONTAINER_NAME}" 2>/dev/null || true

echo "Removing PostgREST container: ${CONTAINER_NAME}"
docker rm "${CONTAINER_NAME}" 2>/dev/null || true

echo "PostgREST container removed: ${CONTAINER_NAME}"
