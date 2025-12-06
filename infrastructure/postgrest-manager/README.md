# PostgREST Manager API

HTTP service for managing per-project PostgREST containers.

## Overview

- **Port**: 9000 (internal network only)
- **Authentication**: All endpoints require `X-Internal-Key` header
- **Container naming**: `postgrest-{projectId}`
- **Network**: `launchdb-internal`

## API Endpoints

### Health Check

```http
GET /health
```

**Response (200):**
```json
{
  "status": "healthy",
  "service": "postgrest-manager"
}
```

---

### Spawn PostgREST Container

Creates a new per-project PostgREST container with PgBouncer integration.

```http
POST /internal/postgrest/spawn
Content-Type: application/json
X-Internal-Key: <internal_api_key>

{
  "projectId": "proj_abc123",
  "authenticatorPassword": "your_password_here"  // Optional but recommended
}
```

**Parameters:**
- `projectId` (required): Project identifier (alphanumeric, hyphens, underscores only)
- `authenticatorPassword` (optional): Database authenticator password for PgBouncer userlist

**What it does:**
1. Validates `projectId` format (prevents command injection)
2. Checks if container already exists
3. **Adds project database to PgBouncer** (`pgbouncer-add-project.sh`)
4. **Adds authenticator user to PgBouncer userlist** (`pgbouncer-add-user.sh`) if password provided
5. Spawns PostgREST container using custom `launchdb/postgrest:v1` image
6. Waits for container to be healthy

**Response (201) - Success:**
```json
{
  "projectId": "proj_abc123",
  "containerId": "postgrest-proj_abc123",
  "containerName": "postgrest-proj_abc123",
  "port": 3000,
  "status": "running"
}
```

**Response (409) - Container already running:**
```json
{
  "error": "container_exists",
  "message": "Container already running"
}
```

**Response (500) - PgBouncer add failed:**
```json
{
  "error": "pgbouncer_add_failed",
  "message": "Failed to add project database to PgBouncer: <details>"
}
```

**Response (500) - PgBouncer user add failed:**
```json
{
  "error": "pgbouncer_user_add_failed",
  "message": "Failed to add authenticator to PgBouncer userlist: <details>"
}
```

**Response (500) - Spawn failed:**
```json
{
  "error": "spawn_failed",
  "message": "<error details>"
}
```

**Important Notes:**
- If `authenticatorPassword` is not provided, a warning is logged and PgBouncer authentication may fail
- Password should be passed as raw string (not URL-encoded)
- Manager handles PgBouncer MD5 hashing internally

---

### Restart PostgREST Container

Reloads PostgREST configuration via SIGHUP signal without restarting the container.

```http
POST /internal/postgrest/{projectId}/restart
X-Internal-Key: <internal_api_key>
```

**Response (200):**
```json
{
  "projectId": "proj_abc123",
  "status": "reloaded",
  "message": "PostgREST configuration reloaded via SIGHUP"
}
```

**Response (404):**
```json
{
  "error": "not_found",
  "message": "Container not running"
}
```

---

### Destroy PostgREST Container

Stops and removes a PostgREST container with PgBouncer cleanup.

```http
DELETE /internal/postgrest/{projectId}
X-Internal-Key: <internal_api_key>
```

**What it does:**
1. Stops and removes PostgREST container
2. **Removes project database from PgBouncer** (`pgbouncer-remove-project.sh`)
3. **Removes authenticator user from PgBouncer userlist** (`pgbouncer-remove-user.sh`)

**Response (200):**
```json
{
  "projectId": "proj_abc123",
  "status": "stopped"
}
```

**Response (404):**
```json
{
  "error": "not_found",
  "message": "Container not running"
}
```

---

### List Running Containers

Lists all running PostgREST containers.

```http
GET /internal/postgrest
X-Internal-Key: <internal_api_key>
```

**Response (200):**
```json
{
  "containers": [
    {
      "projectId": "proj_abc123",
      "containerName": "postgrest-proj_abc123",
      "port": 3000,
      "status": "running"
    }
  ]
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | HTTP port (default: 9000) |
| `INTERNAL_API_KEY` | **Yes** | API authentication key (fails on startup if missing) |
| `HOST_CONFIG_DIR` | **Yes** | Absolute path on Docker host to PostgREST config directory |
| `HOST_SCRIPT_DIR` | **Yes** | Absolute path on Docker host to scripts directory |
| `DOMAIN` | No | Domain for PostgREST OpenAPI spec |

## Integration Example

```javascript
// Platform API creating a project

// 1. Generate credentials
const projectId = 'proj_abc123';
const authenticatorPassword = generateSecurePassword();
const jwtSecret = generateSecurePassword();

// 2. Create database and user
await db.query(`CREATE DATABASE ${projectId}`);
await db.query(`CREATE ROLE ${projectId}_authenticator LOGIN PASSWORD $1`, [authenticatorPassword]);

// 3. Write PostgREST config
const encodedPassword = encodeURIComponent(authenticatorPassword);
await fs.writeFile(`/etc/postgrest/projects/${projectId}.conf`, `
db-uri = "postgres://${projectId}_authenticator:${encodedPassword}@pgbouncer:6432/${projectId}"
db-schemas = "public,storage"
db-anon-role = "anon"
jwt-secret = "${jwtSecret}"
server-port = 3000
`);

// 4. Spawn PostgREST container
const response = await fetch('http://postgrest-manager:9000/internal/postgrest/spawn', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Internal-Key': process.env.INTERNAL_API_KEY
  },
  body: JSON.stringify({
    projectId: projectId,
    authenticatorPassword: authenticatorPassword  // Pass raw password
  })
});

if (!response.ok) {
  throw new Error(`Failed to spawn PostgREST: ${await response.text()}`);
}

// Container is now running and accessible at http://postgrest-{projectId}:3000
```

## Security

- Manager runs as root to access Docker socket
- Protected by internal network isolation (not exposed externally)
- All endpoints require `X-Internal-Key` authentication
- Input validation prevents command injection (alphanumeric + hyphens + underscores only)
- Passwords logged are masked in production logs

## Troubleshooting

### Container fails to start
```bash
# Check manager logs
docker logs launchdb-postgrest-manager

# Check if config exists
docker exec launchdb-postgrest-manager ls -la /etc/postgrest/projects/

# Verify PgBouncer entry
docker exec launchdb-pgbouncer cat /etc/pgbouncer/pgbouncer.ini | grep proj_abc123
```

### Authentication failures
```bash
# Verify INTERNAL_API_KEY matches
docker exec launchdb-postgrest-manager env | grep INTERNAL_API_KEY
docker exec launchdb-platform-api env | grep INTERNAL_API_KEY
```

### PgBouncer connection errors
```bash
# Check PgBouncer userlist
docker exec launchdb-pgbouncer cat /etc/pgbouncer/userlist.txt | grep proj_abc123_authenticator

# Check PgBouncer logs
docker logs launchdb-pgbouncer --tail 50
```
