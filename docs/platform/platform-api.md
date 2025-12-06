# Platform API Documentation

The Platform API is the main HTTP API for managing LaunchDB projects. It provides endpoints for owner authentication, project lifecycle management, and proxying requests to per-project PostgREST instances.

## Base URL

```
http://localhost:8000
```

## Authentication

All endpoints except `/api/owners/*` and `/health` require JWT authentication via the `Authorization` header.

### Header Format

```
Authorization: Bearer <jwt_token>
```

### Obtaining a Token

Tokens are obtained via the login endpoint (see Auth section below).

### Token Claims

```json
{
  "sub": "owner_id",
  "email": "owner@example.com",
  "type": "platform",
  "iat": 1234567890,
  "exp": 1234567890
}
```

---

## Endpoints

### Health Check

#### `GET /health`

Health check endpoint for monitoring.

**Authentication:** None required

**Response:**

```json
{
  "status": "healthy",
  "service": "platform-api",
  "timestamp": "2025-12-04T10:00:00.000Z"
}
```

---

## Owner Management

### Signup

#### `POST /api/owners/signup`

Register a new owner account.

**Authentication:** None required

**Request Body:**

```json
{
  "email": "owner@example.com",
  "password": "secure_password"
}
```

**Validation:**
- `email`: Must be valid email format
- `password`: Minimum 8 characters, maximum 128 characters

**Response:** `201 Created`

```json
{
  "owner_id": "85707669-56fc-46b7-99a8-918d6042d608",
  "email": "owner@example.com",
  "created_at": "2025-12-04T10:00:00.000Z"
}
```

**Error Responses:**

```json
// 400 Bad Request - Validation error
{
  "statusCode": 400,
  "message": ["email must be an email", "password must be at least 8 characters"],
  "error": "Bad Request"
}

// 409 Conflict - Email already exists
{
  "statusCode": 409,
  "message": "Owner with this email already exists",
  "error": "Conflict"
}
```

---

### Login

#### `POST /api/owners/login`

Authenticate and obtain an access token.

**Authentication:** None required

**Request Body:**

```json
{
  "email": "owner@example.com",
  "password": "secure_password"
}
```

**Response:** `200 OK`

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 604800
}
```

**Error Responses:**

```json
// 401 Unauthorized - Invalid credentials
{
  "statusCode": 401,
  "message": "Invalid email or password",
  "error": "Unauthorized"
}
```

---

## Project Management

All project endpoints require authentication.

### Create Project

#### `POST /api/projects`

Create a new project. This triggers an 8-step creation flow that:
1. Creates project record in platform database
2. Creates project database and roles
3. Applies default schema migrations
4. Generates JWT secrets
5. Encrypts and stores secrets
6. Configures PgBouncer connection pooling
7. Generates PostgREST configuration
8. Spawns PostgREST container

**Authentication:** Required

**Request Body:**

```json
{
  "name": "my-project",
  "display_name": "My Project"
}
```

**Validation:**
- `name`: 3-64 characters, alphanumeric and hyphens
- `display_name`: Optional, max 128 characters (defaults to `name`)

**Response:** `201 Created`

```json
{
  "project_id": "proj_802682481788fe51",
  "name": "my-project",
  "display_name": "My Project",
  "status": "active",
  "db_name": "proj_802682481788fe51",
  "created_at": "2025-12-04T10:00:00.000Z"
}
```

**Error Responses:**

```json
// 400 Bad Request - Validation error
{
  "statusCode": 400,
  "message": ["name must be at least 3 characters"],
  "error": "Bad Request"
}

// 401 Unauthorized - Missing/invalid token
{
  "statusCode": 401,
  "message": "Missing or invalid authorization header",
  "error": "Unauthorized"
}

// 409 Conflict - Project name already exists
{
  "statusCode": 409,
  "message": "Project with this name already exists",
  "error": "Conflict"
}

// 500 Internal Server Error - Creation failed
{
  "statusCode": 500,
  "message": "Internal server error"
}
```

---

### List Projects

#### `GET /api/projects`

List all projects for the authenticated owner.

**Authentication:** Required

**Response:** `200 OK`

```json
{
  "projects": [
    {
      "id": "proj_802682481788fe51",
      "name": "my-project",
      "display_name": "My Project",
      "db_name": "proj_802682481788fe51",
      "status": "active",
      "created_at": "2025-12-04T10:00:00.000Z",
      "updated_at": "2025-12-04T10:00:00.000Z"
    }
  ]
}
```

**Error Responses:**

```json
// 401 Unauthorized
{
  "statusCode": 401,
  "message": "Missing or invalid authorization header",
  "error": "Unauthorized"
}
```

---

### Get Project

#### `GET /api/projects/:projectId`

Get details for a specific project.

**Authentication:** Required

**URL Parameters:**
- `projectId`: Project ID (format: `proj_[16 hex chars]`)

**Response:** `200 OK`

```json
{
  "id": "proj_802682481788fe51",
  "owner_id": "85707669-56fc-46b7-99a8-918d6042d608",
  "name": "my-project",
  "display_name": "My Project",
  "db_name": "proj_802682481788fe51",
  "status": "active",
  "created_at": "2025-12-04T10:00:00.000Z",
  "updated_at": "2025-12-04T10:00:00.000Z"
}
```

**Error Responses:**

```json
// 401 Unauthorized
{
  "statusCode": 401,
  "message": "Missing or invalid authorization header",
  "error": "Unauthorized"
}

// 403 Forbidden - Not the owner
{
  "statusCode": 403,
  "message": "Access denied",
  "error": "Forbidden"
}

// 404 Not Found
{
  "statusCode": 404,
  "message": "Project not found",
  "error": "Not Found"
}
```

---

### Get Connection Info

#### `GET /api/projects/:projectId/connection`

Get connection credentials and service URLs for a project.

**Authentication:** Required

**URL Parameters:**
- `projectId`: Project ID

**Response:** `200 OK`

```json
{
  "project_id": "proj_802682481788fe51",
  "db_uri": "postgresql://proj_802682481788fe51_authenticator:***@pgbouncer:6432/proj_802682481788fe51",
  "db_uri_pooler": "postgresql://proj_802682481788fe51_authenticator:***@pgbouncer:6432/proj_802682481788fe51",
  "anon_key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "service_role_key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "postgrest_url": "http://localhost:8000/db/proj_802682481788fe51",
  "auth_url": "http://localhost:3001/auth/proj_802682481788fe51",
  "storage_url": "http://localhost:3002/storage/proj_802682481788fe51"
}
```

**Field Descriptions:**
- `db_uri`: Direct PostgreSQL connection string (via PgBouncer)
- `db_uri_pooler`: Connection pooler URI (same as `db_uri` for v1)
- `anon_key`: JWT token with `anon` role for client-side auth
- `service_role_key`: JWT token with `service_role` for server-side operations
- `postgrest_url`: PostgREST API endpoint (proxied through Platform API)
- `auth_url`: Authentication service endpoint
- `storage_url`: Storage service endpoint

**Error Responses:**

```json
// 401 Unauthorized
{
  "statusCode": 401,
  "message": "Missing or invalid authorization header",
  "error": "Unauthorized"
}

// 403 Forbidden - Not the owner
{
  "statusCode": 403,
  "message": "Access denied",
  "error": "Forbidden"
}

// 404 Not Found
{
  "statusCode": 404,
  "message": "Project not found",
  "error": "Not Found"
}
```

---

### Delete Project

#### `DELETE /api/projects/:projectId`

Delete a project. This triggers an 8-step deletion flow that:
1. Marks project as deleted (soft delete)
2. Revokes API keys (v1.1)
3. Invalidates caches (v1.1)
4. Deletes storage files (v1.1)
5. Destroys PostgREST container
6. Deletes PostgREST configuration
7. Drops database and roles (v1.1 - manual cleanup required)
8. Deletes project record (v1.1)

**Note:** v1 implements immediate cleanup of container, config, and PgBouncer entries. Database and role cleanup is deferred to v1.1.

**Authentication:** Required

**URL Parameters:**
- `projectId`: Project ID

**Response:** `200 OK`

```json
{
  "message": "Project deleted"
}
```

**Error Responses:**

```json
// 401 Unauthorized
{
  "statusCode": 401,
  "message": "Missing or invalid authorization header",
  "error": "Unauthorized"
}

// 403 Forbidden - Not the owner
{
  "statusCode": 403,
  "message": "Access denied",
  "error": "Forbidden"
}

// 404 Not Found
{
  "statusCode": 404,
  "message": "Project not found",
  "error": "Not Found"
}
```

---

## PostgREST Proxy

### Proxy to PostgREST

#### `ALL /db/:projectId/*`

Proxy all requests to the per-project PostgREST container. This endpoint validates the project is active and forwards requests to the PostgREST instance running at `http://postgrest-{projectId}:3000`.

**Authentication:** None (handled by PostgREST using project's anon_key or service_role_key)

**URL Parameters:**
- `projectId`: Project ID
- `*`: Any PostgREST path (e.g., `/table_name`, `/rpc/function_name`)

**Headers:**
- `Authorization`: PostgREST JWT token (anon_key or service_role_key)
- `Content-Type`: Request content type
- `Prefer`: PostgREST preferences (e.g., `return=representation`)

**Example Request:**

```bash
curl -X GET http://localhost:8000/db/proj_802682481788fe51/users \
  -H "Authorization: Bearer <anon_key>" \
  -H "Content-Type: application/json"
```

**Response:** Varies based on PostgREST operation

**Error Responses:**

```json
// 404 Not Found - Invalid project ID format
{
  "statusCode": 404,
  "message": "Project not found",
  "error": "Not Found"
}

// 403 Forbidden - Project not active
{
  "statusCode": 403,
  "message": "Project not accessible (status: deleted)",
  "error": "Forbidden"
}

// 503 Service Unavailable - Container not running
{
  "error": "Service Unavailable",
  "message": "PostgREST container is not running"
}

// 504 Gateway Timeout - Request timeout
{
  "error": "Gateway Timeout",
  "message": "Request to PostgREST timed out"
}

// 502 Bad Gateway - Proxy error
{
  "error": "Bad Gateway",
  "message": "Failed to proxy request to PostgREST"
}
```

---

## Error Codes Reference

| Status Code | Error | Description |
|-------------|-------|-------------|
| 400 | Bad Request | Invalid request body or parameters |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Access denied (not the owner or project inactive) |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Resource already exists (email or project name) |
| 500 | Internal Server Error | Server error during operation |
| 502 | Bad Gateway | PostgREST proxy error |
| 503 | Service Unavailable | PostgREST container not running |
| 504 | Gateway Timeout | PostgREST request timeout |

---

## Project Status Values

| Status | Description |
|--------|-------------|
| `active` | Project is running and accessible |
| `deleted` | Project has been soft-deleted |
| `creating` | Project is being created (transient state) |
| `failed` | Project creation failed |

---

## Rate Limiting

v1 does not implement rate limiting. Consider adding rate limiting in production deployments using:
- Nginx/HAProxy rate limiting
- API gateway (Kong, Tyk)
- Application-level rate limiting middleware

---

## CORS

CORS is not configured in v1. Configure CORS in production using:
- NestJS CORS configuration in `main.ts`
- Reverse proxy CORS headers

---

## Security Considerations

1. **HTTPS Required:** Always use HTTPS in production
2. **Token Storage:** Store JWT tokens securely (HttpOnly cookies or secure storage)
3. **Token Expiration:** Tokens expire after 7 days (604800 seconds)
4. **Password Security:** Passwords are hashed using bcrypt (10 rounds)
5. **Connection Credentials:** Service role keys grant admin access - store securely
6. **PostgREST Auth:** Use anon_key for client-side, service_role_key for server-side only

---

## Development

### Local Setup

```bash
# Platform API runs on port 8000
curl http://localhost:8000/health
```

### Testing Authentication

```bash
# 1. Signup
curl -X POST http://localhost:8000/api/owners/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# 2. Login
TOKEN=$(curl -X POST http://localhost:8000/api/owners/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' \
  | jq -r '.access_token')

# 3. Create Project
curl -X POST http://localhost:8000/api/projects \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"test-project"}'
```

---

## See Also

- [Auth Service Documentation](./auth-service.md) - Per-project authentication
- [Storage Service Documentation](./storage-service.md) - Per-project file storage
- [Migrations Service Documentation](./migrations-service.md) - Schema management
- [Database Schema](./database-schema.md) - Platform and project database schemas
- [Environment Variables](./platform-env-vars.md) - Configuration reference
