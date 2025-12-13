# LaunchDB Architecture Overview

## Table of Contents

- [Introduction](#introduction)
- [High-Level Architecture](#high-level-architecture)
- [Core Design Principles](#core-design-principles)
- [Component Architecture](#component-architecture)
- [PostgREST Per-Project Topology](#postgrest-per-project-topology)
- [Connection Pooling with PgBouncer](#connection-pooling-with-pgbouncer)
- [Manager API Orchestration](#manager-api-orchestration)
- [Data Flow](#data-flow)
- [Security Architecture](#security-architecture)
- [Scalability Considerations](#scalability-considerations)

## Introduction

LaunchDB is a multi-tenant PostgreSQL-as-a-Service platform that provides isolated database instances with automatic RESTful API generation via PostgREST. The architecture is designed for single-VPS deployment in v0.1.x, with emphasis on security isolation, connection efficiency, and operational simplicity.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Requests                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Reverse Proxy (Caddy)                       │
│                     TLS Termination & Routing                    │
└──────┬──────────────────────┬───────────────────────────────────┘
       │                      │
       ▼                      ▼
┌──────────────┐    ┌─────────────────────────────────────────┐
│  Platform    │    │    Per-Project PostgREST Containers     │
│  API (8000)  │    │  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│              │    │  │PostgREST│  │PostgREST│  │PostgREST│ │
│ • Projects   │    │  │  Proj1  │  │  Proj2  │  │  ProjN  │ │
│ • Users      │    │  └────┬────┘  └────┬────┘  └────┬────┘ │
│ • Auth       │    └───────┼────────────┼────────────┼───────┘
└──────┬───────┘            │            │            │
       │                    └────────────┴────────────┘
       │                                 │
       ▼                                 ▼
┌──────────────────────────────────────────────────────────────┐
│                      PgBouncer (6432)                         │
│              Connection Pooling & Transaction Routing         │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   PostgreSQL (5432)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ platform │  │  proj_1  │  │  proj_2  │  │  proj_N  │   │
│  │    DB    │  │    DB    │  │    DB    │  │    DB    │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│             Manager API (Internal, Port 9000)                │
│          Container Lifecycle & PgBouncer Management          │
└─────────────────────────────────────────────────────────────┘
```

## Core Design Principles

### 1. Per-Project Isolation

**Decision:** Each project gets its own PostgreSQL database AND its own PostgREST container.

**Rationale:**
- **Database Isolation:** Each project has a dedicated PostgreSQL database with isolated schemas, users, and data
- **API Isolation:** PostgREST instances read configuration at startup and cannot dynamically switch databases
- **Security:** Complete isolation between tenants - no shared connection strings, no cross-project access
- **Configuration Flexibility:** Each project can have custom PostgREST settings (JWT secrets, schemas, etc.)

**Trade-off:** More containers (~20MB each) vs. architectural impossibility of shared PostgREST instance.

### 2. Connection Pooling Strategy

**Decision:** Single PgBouncer instance in transaction pooling mode for all databases.

**Rationale:**
- **Efficiency:** PostgreSQL connections are expensive; pooling reduces overhead
- **Transaction Mode:** Connections returned to pool after each transaction, enabling high concurrency
- **Centralized Management:** Single point for connection configuration and monitoring
- **Compatibility:** `db-prepared-statements = false` in PostgREST for PgBouncer transaction mode compatibility

**Configuration:**
- Default pool size: 5 connections per project
- Reserve pool: 2 connections per project
- Max PostgreSQL connections: 500 (with ~200 active under normal load)

### 3. Container Orchestration

**Decision:** Manager API handles PostgREST container lifecycle via docker-socket-proxy + dockerode.

**Rationale:**
- **Separation of Concerns:** Platform API handles business logic; Manager API handles infrastructure
- **Security:** Socket-proxy filters Docker API (only CONTAINERS, POST, EXEC allowed)
- **Security:** Internal-only API (not exposed to public internet)
- **Security:** Manager runs as non-root user (nodeuser UID 1001)
- **Atomicity:** Container spawn + PgBouncer registration + config generation in single operation
- **Type Safety:** dockerode library replaces shell scripts (13 calls eliminated)

## Component Architecture

### Platform API (NestJS)

**Responsibilities:**
- User authentication and authorization
- Project CRUD operations
- Database provisioning via Migrations service
- API key management
- Integration with Manager API for PostgREST lifecycle

**Tech Stack:** NestJS, TypeScript, Postgres (via PgBouncer)

**Port:** 8000 (public)

### Manager API (Node.js)

**Responsibilities:**
- PostgREST container lifecycle (spawn, restart, delete)
- PgBouncer configuration management (add/remove databases and users)
- PostgREST configuration generation
- Health checks and monitoring

**Tech Stack:** Express.js, Docker API, Shell scripts

**Port:** 9000 (internal only)

**Key Operations:**
- `POST /internal/postgrest/:projectId/spawn` - Create new PostgREST container
- `POST /internal/postgrest/:projectId/restart` - Reload PostgREST config (SIGHUP)
- `DELETE /internal/postgrest/:projectId` - Remove container and cleanup

### Migrations Service (NestJS)

**Responsibilities:**
- Apply default database schemas (public, storage, auth)
- Execute SQL migrations on project databases
- Database user creation and permission management

**Tech Stack:** NestJS, TypeScript, node-postgres

**Port:** 8002 (internal)

### Auth Service (NestJS)

**Responsibilities:**
- Per-project user authentication (email/password)
- JWT token generation and validation
- Session and refresh token management
- Password reset and email verification

**Tech Stack:** NestJS, TypeScript, Argon2id password hashing

**Port:** 8001 (public)

### Storage Service (NestJS)

**Responsibilities:**
- Per-project file upload and download
- Disk-based file storage with metadata in PostgreSQL
- Bucket-based organization
- Signed URLs for temporary access
- RLS-protected file access control

**Tech Stack:** NestJS, TypeScript, Filesystem storage

**Port:** 8003 (public)

## PostgREST Per-Project Topology

### Why Per-Project Containers?

PostgREST is designed to read configuration at startup and connect to a single database. Key constraints:

1. **Static Configuration:** PostgREST reads `db-uri` and `db-schemas` at startup
2. **No Dynamic Switching:** Cannot change database connection without restart
3. **Schema Cache:** PostgREST builds schema cache for the configured database only
4. **JWT Configuration:** Each project has unique JWT secret, requiring separate PostgREST instances

### Container Naming Convention

```
postgrest-{project_id}
```

Example: `postgrest-proj_a8cc50c5f7212b6e`

### Configuration Management

Each PostgREST container gets a dedicated config file:

```
/etc/postgrest/projects/{project_id}.conf
```

**Generated by:** Manager API during spawn operation

**Key Settings:**
```ini
db-uri = "postgres://proj_xxx_authenticator:password@pgbouncer:6432/proj_xxx"
db-schemas = "public,storage"
db-anon-role = "anon"
db-pool = 10
db-prepared-statements = false  # Required for PgBouncer transaction mode
jwt-secret = "..." # Unique per project
```

### Lifecycle

1. **Creation:**
   - Platform API requests project creation
   - Migrations service creates database and applies schemas
   - Platform API calls Manager API `/spawn`
   - Manager API registers database in PgBouncer
   - Manager API registers user in PgBouncer
   - Manager API generates PostgREST config
   - Manager API spawns Docker container
   - Container performs health check
   - Platform API marks project as "active"

2. **Runtime:**
   - PostgREST serves RESTful API for project database
   - Connects via PgBouncer for connection pooling
   - Automatic schema reflection and OpenAPI docs

3. **Deletion:**
   - Platform API calls Manager API `/delete`
   - Manager API stops and removes container
   - Manager API removes PgBouncer database entry
   - Manager API removes PgBouncer user entry
   - Platform API marks project as "deleted"

## Connection Pooling with PgBouncer

### Configuration

**Pooling Mode:** Transaction

**Why Transaction Mode:**
- Connection returned to pool after each transaction
- Maximizes connection reuse across multiple clients
- Required for high-concurrency multi-tenant architecture

**Trade-off:** Cannot use prepared statements (solved with `db-prepared-statements = false`)

### Connection Limits

```ini
[pgbouncer]
max_client_conn = 1000           # Total client connections allowed
default_pool_size = 25           # Default pool size (overridden per-database)
server_connect_timeout = 30      # Seconds to wait for PostgreSQL connection
server_login_retry = 30          # Seconds to retry failed connections
```

### Per-Database Configuration

Each project database is registered in `pgbouncer.ini`:

```ini
proj_xxx = host=postgres port=5432 dbname=proj_xxx pool_size=5 reserve_pool=2
```

**Capacity Planning:**
- 29 projects × 5 connections = 145 project connections
- Platform database = 25 connections
- Other services = ~30 connections
- **Total: ~200 active connections** (60% reserve capacity with 500 max)

### Concurrency Protection

PgBouncer configuration files are modified by multiple Manager API operations concurrently. Protection mechanisms:

1. **File Locking:** All scripts use `flock` to serialize read-modify-write operations
2. **Atomic Updates:** Modifications via temp files with atomic overwrite
3. **Backup System:** Timestamped backups before each modification

**Implementation:**
```bash
(
  flock -x 200
  TMPFILE=$(mktemp)
  # Modify config
  cat "$TMPFILE" > /etc/pgbouncer/pgbouncer.ini
  rm "$TMPFILE"
) 200>/etc/pgbouncer/pgbouncer.ini.lock
```

## Manager API Orchestration

### Internal API

Manager API is **internal-only** and protected by API key authentication.

**Authentication:**
```http
X-Internal-API-Key: <INTERNAL_API_KEY>
```

### Key Endpoints

#### POST /internal/postgrest/:projectId/spawn

Creates new PostgREST container for project.

**Process:**
1. Validate project exists and has required secrets
2. Register database in PgBouncer (`pgbouncer-add-project.sh`)
3. Register user in PgBouncer (`pgbouncer-add-user.sh`)
4. Generate PostgREST config file
5. Spawn Docker container with proper network and environment
6. Wait for container health check
7. Return success/failure

**Timeout:** 30 seconds

#### POST /internal/postgrest/:projectId/restart

Reloads PostgREST configuration via SIGHUP.

**Use Case:** Update JWT secret or other config without full restart

**Process:**
1. Find running container
2. Send SIGHUP signal (graceful reload)
3. Container reloads config without dropping connections

#### DELETE /internal/postgrest/:projectId

Removes PostgREST container and cleans up resources.

**Process:**
1. Stop Docker container (if exists)
2. Remove Docker container
3. Remove PgBouncer database entry (`pgbouncer-remove-project.sh`)
4. Remove PgBouncer user entry (`pgbouncer-remove-user.sh`)
5. Remove PostgREST config file

**Note:** Cleanup runs even if container doesn't exist (idempotent)

### Docker Operations (v0.2.0+)

Manager API uses `dockerode` library via `docker-socket-proxy`:

```yaml
# docker-compose.yml
docker-socket-proxy:
  image: lscr.io/linuxserver/socket-proxy:latest
  environment:
    CONTAINERS: 1  # Container lifecycle
    POST: 1        # Write operations
    EXEC: 1        # PgBouncer config updates
    NETWORKS: 1    # Network discovery
    IMAGES: 1      # Image pulls
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock:ro
```

**Operations (lib/docker.js):**
- `createPostgrestContainer()` - Spawn PostgREST container
- `stopContainer()` / `removeContainer()` - Container cleanup
- `sendSignal()` - SIGHUP for config reload
- `execInContainer()` - PgBouncer config updates (flock + awk/sed)
- `listPostgrestContainers()` - List all project containers

**Security:** All Docker operations filtered through socket-proxy (no direct socket access)

## Data Flow

### Project Creation Flow

```
1. Client → Platform API: POST /api/projects
2. Platform API → PostgreSQL: Insert project record (status="provisioning")
3. Platform API → Migrations API: POST /internal/migrations/run
4. Migrations API → PostgreSQL: Create database, apply schemas
5. Platform API → Manager API: POST /internal/postgrest/:id/spawn
6. Manager API → PgBouncer: Register database and user
7. Manager API → Docker: Spawn PostgREST container
8. PostgREST → PgBouncer → PostgreSQL: Connect and cache schema
9. Manager API → Platform API: Success response
10. Platform API → PostgreSQL: Update project (status="active")
11. Platform API → Client: 201 Created
```

### API Request Flow (PostgREST)

```
1. Client → Caddy: GET /project/:id/table
2. Caddy → PostgREST Container: Forward request
3. PostgREST → PgBouncer: Get connection from pool
4. PgBouncer → PostgreSQL: Execute SQL query
5. PostgreSQL → PgBouncer → PostgREST: Return results
6. PostgREST → Caddy → Client: JSON response
7. PgBouncer: Return connection to pool
```

## Security Architecture

### Multi-Layer Isolation

1. **Database Level:** Each project has dedicated PostgreSQL database
2. **Connection Level:** PgBouncer enforces database-user mapping
3. **Container Level:** Separate PostgREST containers per project
4. **Network Level:** Docker network isolation
5. **Authentication Level:** JWT tokens unique per project

### Credential Management

**Platform Database:**
- Superuser: `postgres` (administrative tasks only)
- Application user: `postgres` (Platform API, Migrations)

**Project Databases:**
- Authenticator role: `proj_xxx_authenticator` (PostgREST connection)
- Anonymous role: `anon` (unauthenticated API access)
- Authenticated role: `authenticated` (authenticated API access)

**Password Storage:**
- PgBouncer userlist: SCRAM-SHA-256 hashed passwords
- Platform database: Encrypted with AES-256-GCM (master key)

### API Key Security

**Internal API Key:**
- Shared secret between Platform API and Manager API
- Not exposed to public internet
- Rotatable via environment variable

**JWT Secrets:**
- Unique per project
- Generated at project creation
- Stored encrypted in platform database

## Scalability Considerations

### Current Limits (Single VPS)

**PostgreSQL:**
- Max connections: 500
- Active connections: ~200 (60% reserve)
- Per-project pool size: 5

**PgBouncer:**
- Max client connections: 1000
- Supports ~100 active projects comfortably

**Docker:**
- PostgREST container size: ~20MB
- Memory per container: ~50MB
- Can support 50-100 projects on typical VPS

### Future Scaling Options (v0.2.0+)

1. **Horizontal Scaling:**
   - Multiple PostgreSQL instances (sharding by project)
   - Load balancer for PostgREST containers
   - PgBouncer per PostgreSQL instance

2. **Resource Optimization:**
   - Lazy container start/stop (only active projects)
   - Container auto-scaling based on load
   - Connection pool tuning per project tier

3. **Architectural Evolution:**
   - Kubernetes for container orchestration
   - Managed PostgreSQL (RDS, Cloud SQL)
   - CDN for static API responses

### Capacity Planning

**Formula:** `(Projects × Pool Size) + Platform Overhead < PostgreSQL Max Connections`

**Current:**
- 29 projects × 5 = 145
- Platform overhead = 55
- Total = 200
- Limit = 500
- **Headroom = 60%** ✅

**Scaling:**
- To support 50 projects: 250 + 55 = 305 connections (39% headroom)
- To support 80 projects: 400 + 55 = 455 connections (9% headroom)
- To support 90+ projects: Need to increase PostgreSQL max_connections or reduce pool sizes

## Conclusion

LaunchDB's architecture prioritizes:
- **Security through isolation:** Per-project databases and containers
- **Efficiency through pooling:** PgBouncer minimizes PostgreSQL connection overhead
- **Simplicity through orchestration:** Manager API abstracts container complexity
- **Reliability through concurrency protection:** File locking prevents race conditions

This design is production-ready for single-VPS deployment with clear paths for future horizontal scaling.
