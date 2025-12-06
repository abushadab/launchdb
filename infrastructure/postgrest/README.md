# PostgREST Configuration Management

## Overview
LaunchDB uses a **per-project PostgREST architecture** where each project gets its own dedicated PostgREST container, managed via an HTTP API. Configuration updates use the **file+SIGHUP reload** pattern.

## Architecture

### Per-Project PostgREST Instances
- **One PostgREST container per project**: `postgrest-{projectId}`
- **Custom Alpine-based image**: `launchdb/postgrest:v1` with shell and PID file support
- **Per-project configs** stored on host at `./postgrest/projects/{projectId}.conf`
- **HTTP Management API**: `postgrest-manager` on port 9000 handles container lifecycle
- **PID file**: Each container writes `/var/run/postgrest.pid` for SIGHUP reload
- **Network**: All containers join `launchdb-internal` Docker network
- **No port mapping**: Containers only accessible via internal network and Caddy reverse proxy

### Custom PostgREST Image
The official PostgREST image is distroless (no shell), which prevents PID file creation. Our custom image:

- **Base**: Alpine Linux 3.19
- **PostgREST**: v11.2.2 static binary from official releases
- **Wrapper script**: Built-in shell wrapper that writes PID file before starting PostgREST
- **Dependencies**: curl (healthchecks), libpq (PostgreSQL), ca-certificates
- **Size**: ~30MB (vs 14MB official distroless)

### Configuration Flow
```
[Platform API]
    ↓ 1. Project created
    ↓ 2. POST /internal/postgrest/spawn
[PostgREST Manager (port 9000)]
    ↓ 3. Generate config at /etc/postgrest/projects/<project_id>.conf
    ↓ 4. Execute postgrest-spawn.sh script
    ↓ 5. Docker daemon spawns container
[postgrest-{projectId}] ← New container starts with dedicated config
```

## Scripts

### 1. `postgrest-add-project.sh`
Generates PostgREST configuration and spawns container for a new project.

**Usage:**
```bash
./postgrest-add-project.sh <project_id> <jwt_secret> <authenticator_password>
```

**Example:**
```bash
./postgrest-add-project.sh proj_abc123 "jwt_secret_here" "db_password_here"
```

**What it does:**
1. Creates config file at `/etc/postgrest/projects/<project_id>.conf`
2. Sets secure permissions (600)
3. Calls `postgrest-spawn.sh` to create container

### 2. `postgrest-spawn.sh`
Spawns a dedicated PostgREST container for a project.

**Usage:**
```bash
./postgrest-spawn.sh <project_id>
```

**What it does:**
1. Validates config exists at `/etc/postgrest/projects/<project_id>.conf`
2. Creates container `postgrest-<project_id>` using custom `launchdb/postgrest:v1` image
3. Mounts only the config file (wrapper script is built into image)
4. Waits for container to be healthy (up to 30 seconds)

**Environment variables:**
- `HOST_CONFIG_DIR`: Absolute path on Docker host to postgrest/projects directory
- `DOMAIN`: Optional, for OpenAPI spec `openapi-server-proxy-uri`

### 3. `postgrest-stop.sh`
Stops and removes a project's PostgREST container.

**Usage:**
```bash
./postgrest-stop.sh <project_id>
```

### 4. `postgrest-reload.sh`
Sends SIGHUP to a project's PostgREST container to reload configuration without restarting.

**Usage:**
```bash
./postgrest-reload.sh <project_id>
```

**What it does:**
1. Checks if container `postgrest-<project_id>` is running
2. Reads PID from `/var/run/postgrest.pid` inside container
3. Sends SIGHUP signal to reload configuration

## Config File Format

Per `interfaces.md` Section 2, each project config includes:

```ini
# Routes through PgBouncer for connection pooling
db-uri = "postgres://<project_id>_authenticator:xxx@pgbouncer:6432/<project_id>"
db-schemas = "public,storage"
db-anon-role = "anon"
jwt-secret = "<per-project-secret>"
jwt-aud = "authenticated"
server-port = 3000
max-rows = 1000
```

**Key Points:**
- Uses **global roles** (`anon`, `authenticated`, `service_role`)
- Authenticator is **per-project**: `{project_id}_authenticator`
- Routes through **PgBouncer** at `pgbouncer:6432`
- Each container listens on port **3000** internally

## HTTP Management API

The `postgrest-manager` service exposes an HTTP API on port 9000 for managing PostgREST containers.

### Authentication
All endpoints require `X-Internal-Key` header matching `INTERNAL_API_KEY` environment variable.

### Endpoints

#### Spawn PostgREST Container
```http
POST /internal/postgrest/spawn
Content-Type: application/json
X-Internal-Key: <internal_api_key>

{
  "projectId": "proj_abc123"
}
```

Response (201):
```json
{
  "projectId": "proj_abc123",
  "containerId": "postgrest-proj_abc123",
  "containerName": "postgrest-proj_abc123",
  "port": 3000,
  "status": "running"
}
```

#### Reload PostgREST Configuration
```http
POST /internal/postgrest/{projectId}/restart
X-Internal-Key: <internal_api_key>
```

Response (200):
```json
{
  "projectId": "proj_abc123",
  "status": "reloaded",
  "message": "PostgREST configuration reloaded via SIGHUP"
}
```

#### Destroy PostgREST Container
```http
DELETE /internal/postgrest/{projectId}
X-Internal-Key: <internal_api_key>
```

Response (200):
```json
{
  "projectId": "proj_abc123",
  "status": "stopped"
}
```

#### List Running Containers
```http
GET /internal/postgrest
X-Internal-Key: <internal_api_key>
```

Response (200):
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

## Integration with Platform API

The platform-api should call the HTTP management API during project lifecycle:

### Project Creation
```javascript
// After creating project database and secrets
const response = await fetch('http://postgrest-manager:9000/internal/postgrest/spawn', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Internal-Key': process.env.INTERNAL_API_KEY
  },
  body: JSON.stringify({ projectId: 'proj_abc123' })
});
```

### Project Deletion
```javascript
await fetch(`http://postgrest-manager:9000/internal/postgrest/${projectId}`, {
  method: 'DELETE',
  headers: { 'X-Internal-Key': process.env.INTERNAL_API_KEY }
});
```

### Secret Rotation
```javascript
// 1. Update config file with new secrets
// 2. Reload PostgREST
await fetch(`http://postgrest-manager:9000/internal/postgrest/${projectId}/restart`, {
  method: 'POST',
  headers: { 'X-Internal-Key': process.env.INTERNAL_API_KEY }
});
```

## Building the Custom PostgREST Image

The custom image is defined in `./postgrest/Dockerfile` and built via docker-compose:

```bash
# Build the image
docker-compose build postgrest-image

# Or build with docker directly
docker build -t launchdb/postgrest:v1 ./postgrest

# Push to registry (for distribution)
docker push launchdb/postgrest:v1
```

The image is used by the `postgrest-manager` when spawning per-project containers.

## Security Considerations

1. **JWT Secrets**: Never log or expose in plaintext
2. **Config Files**: Permissions set to 600 (owner read/write only)
3. **Database Passwords**: Retrieved from encrypted platform.secrets table
4. **SIGHUP Access**: Only platform-api should trigger reloads

## Testing

### End-to-End Test (Spawn → Reload → Destroy)

```bash
# 1. Build the custom PostgREST image
docker-compose build postgrest-image

# 2. Generate config for test project
./scripts/postgrest-add-project.sh proj_test "test_jwt_secret_32_chars_min" "test_db_password"

# Verify config was created
cat ./postgrest/projects/proj_test.conf

# 3. Spawn container via HTTP API
curl -X POST http://localhost:9000/internal/postgrest/spawn \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}" \
  -d '{"projectId": "proj_test"}'

# Or via script directly
docker exec launchdb-postgrest-manager /scripts/postgrest-spawn.sh proj_test

# 4. Verify container is running
docker ps --filter "name=postgrest-proj_test"

# 5. Verify PID file was created
docker exec postgrest-proj_test cat /var/run/postgrest.pid

# 6. Test PostgREST OpenAPI endpoint
curl http://postgrest-proj_test:3000/
# Should return OpenAPI spec (access from within Docker network)

# 7. Modify config file (simulate secret rotation)
# Edit ./postgrest/projects/proj_test.conf

# 8. Reload config via SIGHUP
curl -X POST http://localhost:9000/internal/postgrest/proj_test/restart \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}"

# Or via script
docker exec launchdb-postgrest-manager /scripts/postgrest-reload.sh proj_test

# 9. Check logs for reload confirmation
docker logs postgrest-proj_test --tail 20

# 10. Destroy container
curl -X DELETE http://localhost:9000/internal/postgrest/proj_test \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}"

# Or via script
docker exec launchdb-postgrest-manager /scripts/postgrest-stop.sh proj_test

# 11. Verify container removed
docker ps -a --filter "name=postgrest-proj_test"
# Should return nothing
```

### List All PostgREST Containers
```bash
curl http://localhost:9000/internal/postgrest \
  -H "X-Internal-Key: ${INTERNAL_API_KEY}"
```

## Troubleshooting

### Container fails to start
- Check logs: `docker logs postgrest-{projectId}`
- Verify config syntax: `docker exec postgrest-{projectId} cat /etc/postgrest.conf`
- Check if config file exists on host: `ls -la ./postgrest/projects/{projectId}.conf`

### Config not reloading
- Verify PID file exists: `docker exec postgrest-{projectId} cat /var/run/postgrest.pid`
- Check SIGHUP signal was received: `docker logs postgrest-{projectId} --tail 20`
- Verify PostgREST process is running: `docker exec postgrest-{projectId} ps aux`

### Connection errors
- Verify database exists: `docker exec launchdb-postgres psql -U postgres -l`
- Check authenticator role: `docker exec launchdb-postgres psql -U postgres -c "\du"`
- Test PgBouncer connection: `docker exec launchdb-pgbouncer psql -h 127.0.0.1 -p 6432 -U postgres -l`

### HTTP API authentication failures
- Verify `INTERNAL_API_KEY` matches between platform-api and postgrest-manager
- Check manager logs: `docker logs launchdb-postgrest-manager`

### Container not accessible from Caddy
- Verify container is on `launchdb-internal` network: `docker inspect postgrest-{projectId} | grep NetworkMode`
- Check Caddy configuration includes reverse proxy rules for the project
