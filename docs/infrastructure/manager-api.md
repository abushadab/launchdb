# Manager API Documentation

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Base URL](#base-url)
- [Endpoints](#endpoints)
  - [Health Check](#health-check)
  - [Spawn PostgREST Container](#spawn-postgrest-container)
  - [Restart PostgREST Container](#restart-postgrest-container)
  - [Delete PostgREST Container](#delete-postgrest-container)
  - [List PostgREST Containers](#list-postgrest-containers)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)
- [Security Considerations](#security-considerations)

## Overview

The Manager API is an internal-only service responsible for managing PostgREST container lifecycle and PgBouncer configuration. It acts as the orchestration layer between the Platform API and the Docker infrastructure.

**Key Responsibilities:**
- Spawn PostgREST containers for new projects
- Register databases and users in PgBouncer
- Reload PostgREST configuration without downtime
- Clean up containers and PgBouncer entries on project deletion
- List active PostgREST containers

**Technology Stack:**
- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **Port:** 9000 (internal only, not exposed to public internet)

## Authentication

All API endpoints (except `/health`) require authentication via API key.

### Header

```http
X-Internal-Key: <INTERNAL_API_KEY>
```

### Environment Variable

The API key is configured via environment variable:

```bash
INTERNAL_API_KEY=your_32_character_random_key
```

### Example

```bash
curl -X POST http://localhost:9000/internal/postgrest/spawn \
  -H "X-Internal-Key: abc123def456..." \
  -H "Content-Type: application/json" \
  -d '{"projectId": "proj_xxx", "authenticatorPassword": "secret"}'
```

### Authentication Errors

**Missing API Key:**
```json
{
  "error": "unauthorized",
  "message": "X-Internal-Key header required"
}
```
**Status Code:** `401 Unauthorized`

**Invalid API Key:**
```json
{
  "error": "forbidden",
  "message": "Invalid API key"
}
```
**Status Code:** `403 Forbidden`

## Base URL

**Internal (Docker Network):**
```
http://postgrest-manager:9000
```

**Localhost (Host Machine):**
```
http://localhost:9000
```

**Note:** The Manager API is NOT exposed to the public internet. It should only be accessible from:
- Platform API (via Docker network)
- Host machine localhost (for debugging)

## Endpoints

### Health Check

Check if the Manager API is running and healthy.

**Endpoint:** `GET /health`

**Authentication:** None required

**Response:**

```json
{
  "status": "healthy",
  "service": "postgrest-manager"
}
```

**Status Code:** `200 OK`

**Example:**

```bash
curl http://localhost:9000/health
```

---

### Spawn PostgREST Container

Creates a new PostgREST container for a project, including PgBouncer registration.

**Endpoint:** `POST /internal/postgrest/spawn`

**Authentication:** Required (`X-Internal-Key`)

**Request Body:**

```json
{
  "projectId": "proj_a8cc50c5f7212b6e",
  "authenticatorPassword": "secure_random_password"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectId` | string | Yes | Project identifier (alphanumeric, underscore, hyphen only) |
| `authenticatorPassword` | string | Yes | Password for `{projectId}_authenticator` user in PgBouncer |

**Process:**

1. Check if container already exists (returns 409 if running)
2. Remove stopped container if exists (ensures clean state)
3. Add project database to PgBouncer (`pgbouncer-add-project.sh`)
4. Add authenticator user to PgBouncer (`pgbouncer-add-user.sh`)
5. Spawn PostgREST Docker container (`postgrest-spawn.sh`)
6. Container performs health check
7. Return success response

**Success Response:**

```json
{
  "projectId": "proj_a8cc50c5f7212b6e",
  "containerId": "postgrest-proj_a8cc50c5f7212b6e",
  "containerName": "postgrest-proj_a8cc50c5f7212b6e",
  "port": 3000,
  "status": "running"
}
```

**Status Code:** `201 Created`

**Error Responses:**

**Container Already Running:**
```json
{
  "error": "container_exists",
  "message": "Container already running"
}
```
**Status Code:** `409 Conflict`

**Invalid Project ID:**
```json
{
  "error": "bad_request",
  "message": "Invalid projectId format. Only alphanumeric, underscore, and hyphen allowed."
}
```
**Status Code:** `400 Bad Request`

**PgBouncer Add Failed:**
```json
{
  "error": "pgbouncer_add_failed",
  "message": "Failed to add project database to PgBouncer: ..."
}
```
**Status Code:** `500 Internal Server Error`

**Spawn Failed:**
```json
{
  "error": "spawn_failed",
  "message": "..."
}
```
**Status Code:** `500 Internal Server Error`

**Example:**

```bash
curl -X POST http://localhost:9000/internal/postgrest/spawn \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "proj_a8cc50c5f7212b6e",
    "authenticatorPassword": "5f4dcc3b5aa765d61d8327deb882cf99"
  }'
```

**Timeout:** 30 seconds (from spawning to health check success)

---

### Restart PostgREST Container

Reloads PostgREST configuration without downtime using SIGHUP signal.

**Endpoint:** `POST /internal/postgrest/:projectId/restart`

**Authentication:** Required (`X-Internal-Key`)

**URL Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectId` | string | Yes | Project identifier |

**Request Body:** None

**Process:**

1. Check if container is running (returns 404 if not)
2. Send SIGHUP signal to PostgREST process
3. PostgREST gracefully reloads configuration
4. Return success response

**Use Cases:**
- Update JWT secret without restarting container
- Reload schema changes
- Apply configuration updates

**Success Response:**

```json
{
  "projectId": "proj_a8cc50c5f7212b6e",
  "status": "reloaded",
  "message": "PostgREST configuration reloaded via SIGHUP"
}
```

**Status Code:** `200 OK`

**Error Responses:**

**Container Not Running:**
```json
{
  "error": "not_found",
  "message": "Container not running"
}
```
**Status Code:** `404 Not Found`

**Reload Failed:**
```json
{
  "error": "reload_failed",
  "message": "..."
}
```
**Status Code:** `500 Internal Server Error`

**Example:**

```bash
curl -X POST http://localhost:9000/internal/postgrest/proj_a8cc50c5f7212b6e/restart \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
  -H "Content-Type: application/json"
```

**Note:** Reloading is fast (~1 second) and does not drop existing connections.

---

### Delete PostgREST Container

Stops and removes PostgREST container, and cleans up PgBouncer configuration.

**Endpoint:** `DELETE /internal/postgrest/:projectId`

**Authentication:** Required (`X-Internal-Key`)

**URL Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectId` | string | Yes | Project identifier |

**Request Body:** None

**Process:**

1. Check if container exists
2. Stop and remove container if exists
3. **Always** remove PgBouncer database entry (even if container not found)
4. **Always** remove PgBouncer user entry (even if container not found)
5. Return success response

**Idempotency:** This endpoint is idempotent. If the container doesn't exist, it still cleans up PgBouncer entries and returns success. This ensures cleanup always happens even if container spawn failed earlier.

**Success Response (Container Stopped):**

```json
{
  "projectId": "proj_a8cc50c5f7212b6e",
  "status": "stopped",
  "message": "Container stopped and PgBouncer cleaned"
}
```

**Success Response (Container Not Found):**

```json
{
  "projectId": "proj_a8cc50c5f7212b6e",
  "status": "cleaned_up",
  "message": "PgBouncer cleaned (container not found)"
}
```

**Status Code:** `200 OK` (in both cases)

**Error Response:**

**Delete Failed:**
```json
{
  "error": "destroy_failed",
  "message": "..."
}
```
**Status Code:** `500 Internal Server Error`

**Example:**

```bash
curl -X DELETE http://localhost:9000/internal/postgrest/proj_a8cc50c5f7212b6e \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}"
```

**Important:** Always run cleanup even if individual steps fail (container stop, PgBouncer removal). Errors in cleanup steps are logged but don't fail the overall operation.

---

### List PostgREST Containers

Returns list of all running PostgREST containers.

**Endpoint:** `GET /internal/postgrest`

**Authentication:** Required (`X-Internal-Key`)

**Request Body:** None

**Success Response:**

```json
{
  "containers": [
    {
      "projectId": "proj_a8cc50c5f7212b6e",
      "containerName": "postgrest-proj_a8cc50c5f7212b6e",
      "port": 3000,
      "status": "running"
    },
    {
      "projectId": "proj_b1234567890abcde",
      "containerName": "postgrest-proj_b1234567890abcde",
      "port": 3000,
      "status": "running"
    }
  ]
}
```

**Status Code:** `200 OK`

**Error Response:**

**List Failed:**
```json
{
  "error": "list_failed",
  "message": "..."
}
```
**Status Code:** `500 Internal Server Error`

**Example:**

```bash
curl -X GET http://localhost:9000/internal/postgrest \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}"
```

**Note:** Only returns containers with names matching `postgrest-*` pattern.

---

## Error Handling

### Standard Error Response Format

```json
{
  "error": "error_code",
  "message": "Human-readable error description"
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `bad_request` | 400 | Invalid request parameters |
| `unauthorized` | 401 | Missing authentication |
| `forbidden` | 403 | Invalid API key |
| `not_found` | 404 | Container not running |
| `container_exists` | 409 | Container already running |
| `pgbouncer_add_failed` | 500 | Failed to add to PgBouncer |
| `pgbouncer_user_add_failed` | 500 | Failed to add user to PgBouncer |
| `spawn_failed` | 500 | Failed to spawn container |
| `destroy_failed` | 500 | Failed to delete container |
| `reload_failed` | 500 | Failed to reload configuration |
| `list_failed` | 500 | Failed to list containers |

### Error Logging

All errors are logged to stdout/stderr with context:

```
console.error(`Spawn error for ${projectId}:`, error);
console.error(`PgBouncer database add failed for ${projectId}:`, error);
console.error(`Container stop failed (non-fatal): ${error.message}`);
```

Logs can be viewed via:

```bash
docker logs launchdb-postgrest-manager
docker compose logs postgrest-manager -f
```

## Rate Limiting

**Current Implementation:** No rate limiting

**Recommendation for Production:**
- Implement rate limiting middleware (e.g., `express-rate-limit`)
- Limit spawn operations: 10 per minute per IP
- Limit other operations: 60 per minute per IP

**Example Implementation:**

```javascript
const rateLimit = require('express-rate-limit');

const spawnLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: { error: 'too_many_requests', message: 'Rate limit exceeded' }
});

app.post('/internal/postgrest/spawn', authenticate, spawnLimiter, ...);
```

## Security Considerations

### Input Validation

**Project ID Validation:**
- Regex: `/^[a-zA-Z0-9_-]+$/`
- Only alphanumeric, underscore, and hyphen allowed
- Prevents command injection attacks

**Password Handling:**
- Authenticator password passed to shell scripts
- Wrapped in double quotes to prevent injection
- Not logged (security best practice)

### Command Injection Prevention

All shell commands use parameterized execution:

```javascript
await execAsync(`/scripts/pgbouncer-add-project.sh ${projectId}`);
```

**Validated:** `projectId` is validated against regex before use.

### Docker Socket Access

Manager API has read-only access to Docker socket:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

**Implication:** Manager API can inspect and control Docker containers but cannot modify Docker daemon configuration.

### Network Isolation

**Internal Only:** Manager API is NOT exposed to public internet. Access is restricted to:
- Docker internal network: `launchdb-internal`
- Host machine: `127.0.0.1:9000`

**Firewall Rules:** Ensure port 9000 is NOT open to external traffic.

### API Key Rotation

To rotate the internal API key:

1. Generate new key: `openssl rand -hex 32`
2. Update `.env` file: `INTERNAL_API_KEY=new_key`
3. Restart both Manager API and Platform API:
   ```bash
   docker compose restart postgrest-manager platform-api
   ```

### Audit Logging

**Current:** Basic console logging

**Recommendation for Production:**
- Structured logging (e.g., Winston, Pino)
- Log all API calls with timestamps, IP, and results
- Retain logs for 90 days minimum
- Monitor for suspicious patterns (rapid spawns, failed auth attempts)

## Monitoring and Health Checks

### Docker Health Check

Manager API has a Docker health check configured:

```yaml
healthcheck:
  test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://127.0.0.1:9000/health || exit 1"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 20s
```

**Status:** View with `docker ps` or `docker inspect launchdb-postgrest-manager`

### Metrics (Recommended)

Track the following metrics:

- **Spawn Operations:** Count, duration, success/failure rate
- **Active Containers:** Gauge of running PostgREST containers
- **Error Rate:** Percentage of failed API calls
- **Response Time:** P50, P95, P99 latency

**Tools:** Prometheus, Grafana, Datadog

### Alerting (Recommended)

Set up alerts for:
- Manager API down (health check failing)
- High error rate (>5% failed spawns)
- Slow response times (>30s for spawns)
- Repeated authentication failures (potential security issue)

## Usage Examples

### Typical Workflow: Create Project

```bash
# 1. Platform API creates project in database
# 2. Migrations service creates database and applies schemas
# 3. Platform API calls Manager API to spawn container

# Generate authenticator password
AUTH_PASSWORD=$(openssl rand -hex 32)

# Spawn PostgREST container
curl -X POST http://localhost:9000/internal/postgrest/spawn \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectId\": \"proj_abc123\",
    \"authenticatorPassword\": \"${AUTH_PASSWORD}\"
  }"

# Response: {"projectId": "proj_abc123", "status": "running", ...}

# 4. Platform API marks project as active
# 5. Client can now use PostgREST API at /proj_abc123/*
```

### Typical Workflow: Delete Project

```bash
# 1. Platform API marks project as deleting
# 2. Platform API calls Manager API to delete container

curl -X DELETE http://localhost:9000/internal/postgrest/proj_abc123 \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}"

# Response: {"projectId": "proj_abc123", "status": "stopped", ...}

# 3. Platform API marks project as deleted
# 4. Cleanup job can later remove database
```

### Debugging: List All Containers

```bash
curl -X GET http://localhost:9000/internal/postgrest \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}"

# Response: {"containers": [{...}, {...}]}
```

### Debugging: Reload Configuration

```bash
# After updating JWT secret in database
curl -X POST http://localhost:9000/internal/postgrest/proj_abc123/restart \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
  -H "Content-Type: application/json"

# PostgREST reloads config without dropping connections
```

## Troubleshooting

### Spawn Returns 500

**Symptoms:** Container spawn fails with generic error

**Debugging:**

1. Check Manager API logs:
   ```bash
   docker logs launchdb-postgrest-manager --tail 100
   ```

2. Check PgBouncer script output (logged by Manager API)

3. Verify Docker socket accessible:
   ```bash
   docker compose exec postgrest-manager docker ps
   ```

4. Check if project database exists:
   ```bash
   docker compose exec postgres psql -U postgres -l | grep proj_
   ```

### Container Exists But Not Running

**Symptoms:** Spawn returns "Container already running" but it's not

**Solution:**

```bash
# Remove stopped container manually
docker rm postgrest-proj_abc123

# Retry spawn
curl -X POST http://localhost:9000/internal/postgrest/spawn ...
```

### PgBouncer Add Failed

**Symptoms:** `pgbouncer_add_failed` error during spawn

**Causes:**
- PgBouncer container not running
- PgBouncer configuration file locked (concurrent operations)
- Disk full

**Solution:**

1. Check PgBouncer status:
   ```bash
   docker ps | grep pgbouncer
   ```

2. Check PgBouncer logs:
   ```bash
   docker logs launchdb-pgbouncer --tail 50
   ```

3. Verify PgBouncer file permissions:
   ```bash
   docker exec --user root launchdb-pgbouncer ls -la /etc/pgbouncer/
   ```

### Authentication Failures

**Symptoms:** PostgREST container starts but can't connect to database

**Causes:**
- Authenticator user not in PgBouncer userlist
- Password mismatch
- Database not registered in PgBouncer

**Solution:**

1. Check PgBouncer userlist:
   ```bash
   docker exec --user root launchdb-pgbouncer cat /etc/pgbouncer/userlist.txt | grep proj_abc123
   ```

2. Check PgBouncer databases:
   ```bash
   docker exec --user root launchdb-pgbouncer cat /etc/pgbouncer/pgbouncer.ini | grep proj_abc123
   ```

3. Re-register if missing:
   ```bash
   docker exec --user root launchdb-pgbouncer /scripts/pgbouncer-add-user.sh proj_abc123_authenticator password
   ```

## Next Steps

- [PgBouncer Scripts Documentation](./pgbouncer-scripts.md)
- [Production Deployment Guide](./deployment.md)
- [Environment Variables Reference](./environment-vars.md)
