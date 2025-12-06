# PostgREST Per-Project Architecture - Testing Guide

This document provides comprehensive end-to-end testing procedures for the per-project PostgREST container architecture.

## Prerequisites

- Docker and Docker Compose installed
- LaunchDB services running (`docker-compose up -d`)
- `INTERNAL_API_KEY` environment variable set
- `postgrest-manager` service healthy

## Quick Test Commands

### Verify Manager is Running
```bash
# Check manager health
docker exec launchdb-postgrest-manager curl -f http://localhost:9000/health
# Expected: {"status":"healthy","service":"postgrest-manager"}

# Check manager logs
docker logs launchdb-postgrest-manager --tail 20
```

### List Running PostgREST Containers
```bash
curl http://localhost:9000/internal/postgrest \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}"

# Expected: {"containers":[...]}
```

## End-to-End Test: Spawn → Reload → Destroy

### Step 1: Build Custom PostgREST Image
```bash
# Navigate to infrastructure directory
cd /path/to/launchdb/infrastructure

# Build the image
docker-compose build postgrest-image

# Verify build
docker images | grep launchdb/postgrest
# Expected: launchdb/postgrest  v1  <image-id>  <timestamp>  ~30MB
```

### Step 2: Generate Project Configuration
```bash
# Generate a test project config
docker exec launchdb-postgrest-manager \
  /scripts/postgrest-add-project.sh \
  testproj \
  "test_jwt_secret_must_be_32_chars_min" \
  "test_authenticator_password_here"

# Verify config was created
docker exec launchdb-postgrest-manager \
  cat /etc/postgrest/projects/testproj.conf

# Expected: Config file with db-uri, jwt-secret, etc.
```

### Step 3: Spawn PostgREST Container

#### Option A: Via HTTP API
```bash
# Generate a test password
TEST_PASSWORD="test_password_$(openssl rand -hex 16)"

curl -X POST http://localhost:9000/internal/postgrest/spawn \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
  -d "{\"projectId\": \"testproj\", \"authenticatorPassword\": \"${TEST_PASSWORD}\"}"

# Expected response (201):
# {
#   "projectId": "testproj",
#   "containerId": "postgrest-testproj",
#   "containerName": "postgrest-testproj",
#   "port": 3000,
#   "status": "running"
# }
```

#### Option B: Via Script
```bash
docker exec launchdb-postgrest-manager \
  /scripts/postgrest-spawn.sh testproj

# Expected output:
# Spawning PostgREST container for project: testproj
# Container ID: <container_id>
# Container is healthy!
```

### Step 4: Verify Container is Running
```bash
# Check container exists and is running
docker ps --filter "name=postgrest-testproj"

# Check container health
docker inspect postgrest-testproj --format='{{.State.Health.Status}}'
# Expected: healthy

# Check logs
docker logs postgrest-testproj --tail 20
# Expected: PostgREST startup messages
```

### Step 5: Verify PID File Creation
```bash
# Read PID file from container
docker exec postgrest-testproj cat /var/run/postgrest.pid

# Expected: A process ID number (e.g., 7)

# Verify the process is running
docker exec postgrest-testproj ps aux | grep postgrest
# Expected: postgrest process with matching PID
```

### Step 6: Test PostgREST Endpoint
```bash
# Test OpenAPI spec endpoint (from within Docker network)
docker exec launchdb-platform-api \
  curl -f http://postgrest-testproj:3000/

# Expected: JSON OpenAPI specification

# Test health endpoint
docker exec launchdb-platform-api \
  curl -f http://postgrest-testproj:3000/
# Expected: 200 OK response
```

### Step 7: Test Configuration Reload (SIGHUP)

#### Modify Configuration
```bash
# Make a backup of original config
docker exec launchdb-postgrest-manager \
  cp /etc/postgrest/projects/testproj.conf \
     /etc/postgrest/projects/testproj.conf.bak

# Modify config (example: change max-rows)
docker exec launchdb-postgrest-manager sh -c \
  "echo 'max-rows = 500' >> /etc/postgrest/projects/testproj.conf"
```

#### Reload via HTTP API
```bash
curl -X POST http://localhost:9000/internal/postgrest/testproj/restart \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}"

# Expected response (200):
# {
#   "projectId": "testproj",
#   "status": "reloaded",
#   "message": "PostgREST configuration reloaded via SIGHUP"
# }
```

#### Or Reload via Script
```bash
docker exec launchdb-postgrest-manager \
  /scripts/postgrest-reload.sh testproj

# Expected output:
# PostgREST reloaded successfully (PID: 7)
```

#### Verify Reload
```bash
# Check logs for reload message
docker logs postgrest-testproj --tail 10
# Expected: Log entry showing config reload

# Verify container didn't restart
docker inspect postgrest-testproj --format='{{.State.StartedAt}}'
# Expected: Original start time (not changed)

# Verify PID didn't change
docker exec postgrest-testproj cat /var/run/postgrest.pid
# Expected: Same PID as before
```

### Step 8: Destroy Container

#### Via HTTP API
```bash
curl -X DELETE http://localhost:9000/internal/postgrest/testproj \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}"

# Expected response (200):
# {
#   "projectId": "testproj",
#   "status": "stopped"
# }
```

#### Or via Script
```bash
docker exec launchdb-postgrest-manager \
  /scripts/postgrest-stop.sh testproj

# Expected output:
# Stopping and removing container: postgrest-testproj
# Container stopped successfully
```

#### Verify Removal
```bash
# Container should not exist
docker ps -a --filter "name=postgrest-testproj"
# Expected: Empty output

# Config file should still exist (for future spawns)
docker exec launchdb-postgrest-manager \
  ls -la /etc/postgrest/projects/testproj.conf
# Expected: File exists
```

## Test Summary

If all steps passed, you have verified:

- ✅ Custom PostgREST image builds correctly
- ✅ Config generation works
- ✅ Container spawning via HTTP API and scripts
- ✅ PID file creation in container
- ✅ PostgREST endpoints are accessible
- ✅ SIGHUP-based config reload works without restart
- ✅ Container cleanup works properly

## Error Scenarios to Test

### Test 1: Spawn Duplicate Container
```bash
# Spawn container twice with same projectId
curl -X POST http://localhost:9000/internal/postgrest/spawn \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
  -d '{"projectId": "testproj"}'

# Expected: 409 Conflict
# {"error":"container_exists","message":"Container already running"}
```

### Test 2: Spawn Without Config
```bash
# Try to spawn without creating config first
curl -X POST http://localhost:9000/internal/postgrest/spawn \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
  -d '{"projectId": "nonexistent"}'

# Expected: 500 error with "Config file not found" message
```

### Test 3: Invalid Project ID
```bash
# Try SQL injection in projectId
curl -X POST http://localhost:9000/internal/postgrest/spawn \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
  -d '{"projectId": "test; rm -rf /"}'

# Expected: 400 Bad Request
# {"error":"bad_request","message":"Invalid projectId format. Only alphanumeric, underscore, and hyphen allowed."}
```

### Test 4: Unauthorized Access
```bash
# Try without API key
curl -X POST http://localhost:9000/internal/postgrest/spawn \
  -H "Content-Type: application/json" \
  -d '{"projectId": "testproj"}'

# Expected: 401 Unauthorized
# {"error":"unauthorized","message":"X-Internal-Key header required"}

# Try with wrong API key
curl -X POST http://localhost:9000/internal/postgrest/spawn \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: wrong-key" \
  -d '{"projectId": "testproj"}'

# Expected: 403 Forbidden
# {"error":"forbidden","message":"Invalid API key"}
```

### Test 5: Reload Non-Existent Container
```bash
curl -X POST http://localhost:9000/internal/postgrest/nonexistent/restart \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}"

# Expected: 404 Not Found
# {"error":"not_found","message":"Container not running"}
```

## Performance Testing

### Spawn Multiple Containers
```bash
# Test spawning multiple project containers
for i in {1..5}; do
  PROJECT_ID="proj_test_${i}"

  # Generate config
  docker exec launchdb-postgrest-manager \
    /scripts/postgrest-add-project.sh \
    "$PROJECT_ID" \
    "secret_${i}_must_be_32_chars_minimum" \
    "password_${i}"

  # Spawn container
  curl -X POST http://localhost:9000/internal/postgrest/spawn \
    -H "Content-Type: application/json" \
    -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
    -d "{\"projectId\": \"${PROJECT_ID}\"}"

  echo "Spawned ${PROJECT_ID}"
  sleep 2
done

# Verify all containers are running
docker ps --filter "name=postgrest-proj_test_"

# List via API
curl http://localhost:9000/internal/postgrest \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}"

# Clean up
for i in {1..5}; do
  curl -X DELETE "http://localhost:9000/internal/postgrest/proj_test_${i}" \
    -H "X-Internal-Key: ${INTERNAL_API_KEY}"
done
```

## Troubleshooting Common Issues

### Issue: "Config file not found"
**Cause**: Config wasn't generated before spawning
**Solution**: Run `postgrest-add-project.sh` first

### Issue: "Container already running"
**Cause**: Attempting to spawn duplicate container
**Solution**: Check running containers with `docker ps`, destroy existing container first

### Issue: "exec /usr/local/bin/postgrest-wrapper.sh: no such file or directory"
**Cause**: Using official PostgREST image instead of custom image
**Solution**: Build custom image with `docker-compose build postgrest-image`

### Issue: PID file not created
**Cause**: Wrapper script not executing or lacking permissions
**Solution**:
```bash
# Check wrapper script exists in image
docker run --rm launchdb/postgrest:v1 ls -la /usr/local/bin/

# Check entrypoint
docker inspect launchdb/postgrest:v1 | grep Entrypoint
```

### Issue: SIGHUP not reloading config
**Cause**: PID file contains wrong PID or PostgREST not responding to signal
**Solution**:
```bash
# Verify PID is correct
PID=$(docker exec postgrest-testproj cat /var/run/postgrest.pid)
docker exec postgrest-testproj ps -p $PID

# Check PostgREST version supports SIGHUP
docker exec postgrest-testproj /usr/local/bin/postgrest --version
```

## Automated Test Script

Save this as `test-postgrest-e2e.sh`:

```bash
#!/bin/bash
set -e

PROJECT_ID="e2e_test_$(date +%s)"
echo "Running end-to-end test with project: $PROJECT_ID"

# 1. Build image
echo "Building PostgREST image..."
docker-compose build postgrest-image

# 2. Generate config
echo "Generating config..."
docker exec launchdb-postgrest-manager \
  /scripts/postgrest-add-project.sh \
  "$PROJECT_ID" \
  "$(openssl rand -base64 32)" \
  "$(openssl rand -base64 24)"

# 3. Spawn container
echo "Spawning container..."
curl -X POST http://localhost:9000/internal/postgrest/spawn \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
  -d "{\"projectId\": \"${PROJECT_ID}\"}" \
  -f -s | jq .

# 4. Verify PID file
echo "Checking PID file..."
docker exec "postgrest-${PROJECT_ID}" cat /var/run/postgrest.pid

# 5. Test reload
echo "Testing reload..."
curl -X POST "http://localhost:9000/internal/postgrest/${PROJECT_ID}/restart" \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
  -f -s | jq .

# 6. Cleanup
echo "Cleaning up..."
curl -X DELETE "http://localhost:9000/internal/postgrest/${PROJECT_ID}" \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
  -f -s | jq .

echo "✅ End-to-end test passed!"
```

Run with:
```bash
chmod +x test-postgrest-e2e.sh
./test-postgrest-e2e.sh
```

## Test Results (Reference)

Last successful test run: 2024-12-03

```
Building PostgREST image...
[+] Building 0.8s (10/10) FINISHED
 => [internal] load build definition from Dockerfile
 => => transferring dockerfile: 678B
 => exporting to image
 => => exporting layers
 => => writing image sha256:abc123...
 => => naming to docker.io/launchdb/postgrest:v1

Generating config...
Project testproj PostgREST config successfully created
Spawning PostgREST container for project testproj...
Container ID: def456...
Container is healthy!

Checking PID file...
7

Testing reload...
PostgREST reloaded successfully (PID: 7)

Cleaning up...
Container stopped successfully

✅ All tests passed!
```
