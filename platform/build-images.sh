#!/bin/bash
# Build all LaunchDB NestJS service images

set -e

cd "$(dirname "$0")"

echo "Building LaunchDB NestJS service images..."
echo "==========================================="

# Build Platform API
echo ""
echo "Building platform-api..."
docker build \
  --build-arg SERVICE_NAME=platform-api \
  -t launchdb/platform-api:latest \
  -f Dockerfile \
  .

# Build Auth Service
echo ""
echo "Building auth-service..."
docker build \
  --build-arg SERVICE_NAME=auth-service \
  -t launchdb/auth-service:latest \
  -f Dockerfile \
  .

# Build Storage Service
echo ""
echo "Building storage-service..."
docker build \
  --build-arg SERVICE_NAME=storage-service \
  -t launchdb/storage-service:latest \
  -f Dockerfile \
  .

# Build Migrations Runner
echo ""
echo "Building migrations-runner..."
docker build \
  --build-arg SERVICE_NAME=migrations-runner \
  -t launchdb/migrations:latest \
  -f Dockerfile \
  .

echo ""
echo "==========================================="
echo "✅ All images built successfully!"
echo ""
echo "Images created:"
docker images | grep launchdb/ | grep latest
