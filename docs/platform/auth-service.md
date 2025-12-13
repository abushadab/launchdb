# Auth Service Documentation

The Auth Service provides per-project user authentication and authorization. Each project has its own isolated user database, allowing project owners to manage their own user base independently.

## Base URL

```
http://localhost:8001
```

## Architecture

- **Per-Project Isolation:** Users are stored in per-project databases (`proj_*`)
- **JWT Tokens:** Access tokens (short-lived) + refresh tokens (long-lived)
- **Token Storage:** Refresh tokens stored in project database for revocation
- **Password Security:** Bcrypt hashing with 10 rounds

---

## Authentication Flow

```
1. User signs up → Receive access_token + refresh_token
2. User makes requests with access_token in Authorization header
3. When access_token expires → Use refresh_token to get new tokens
4. User logs out → Revoke refresh_token
```

---

## Endpoints

All Auth Service endpoints are scoped per project: `/auth/:projectId/*`

### Health Check

#### `GET /health`

Health check endpoint for monitoring.

**Authentication:** None required

**Response:**

```json
{
  "status": "ok",
  "service": "auth-service"
}
```

---

## User Management

### Signup

#### `POST /auth/:projectId/signup`

Register a new user for the project.

**Authentication:** None required

**URL Parameters:**
- `projectId`: Project ID (format: `proj_[16 hex chars]`)

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

**Validation:**
- `email`: Must be valid email format
- `password`: Minimum 8 characters, maximum 128 characters
- `password`: Must contain at least one uppercase letter, one lowercase letter, and one number

**Response:** `201 Created`

```json
{
  "user_id": "123e4567-e89b-12d3-a456-426614174000",
  "email": "user@example.com",
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 900
}
```

**Token Details:**
- `access_token`: Valid for 15 minutes (900 seconds)
- `refresh_token`: Valid for 7 days, used to obtain new access tokens

**Error Responses:**

```json
// 400 Bad Request - Validation error
{
  "statusCode": 400,
  "message": [
    "email must be an email",
    "Password must contain at least one uppercase letter, one lowercase letter, and one number"
  ],
  "error": "Bad Request"
}

// 404 Not Found - Project doesn't exist
{
  "statusCode": 404,
  "message": "Project not found",
  "error": "Not Found"
}

// 409 Conflict - Email already registered
{
  "statusCode": 409,
  "message": "User with this email already exists",
  "error": "Conflict"
}
```

---

### Login

#### `POST /auth/:projectId/login`

Authenticate an existing user.

**Authentication:** None required

**URL Parameters:**
- `projectId`: Project ID

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

**Response:** `200 OK`

```json
{
  "user_id": "123e4567-e89b-12d3-a456-426614174000",
  "email": "user@example.com",
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 900
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

// 404 Not Found - Project doesn't exist
{
  "statusCode": 404,
  "message": "Project not found",
  "error": "Not Found"
}
```

---

### Refresh Token

#### `POST /auth/:projectId/refresh`

Obtain a new access token using a refresh token.

**Authentication:** None required (refresh token in body)

**URL Parameters:**
- `projectId`: Project ID

**Request Body:**

```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:** `200 OK`

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 900
}
```

**Note:** Both tokens are rotated (new tokens issued, old refresh token invalidated).

**Error Responses:**

```json
// 401 Unauthorized - Invalid or revoked refresh token
{
  "statusCode": 401,
  "message": "Invalid or expired refresh token",
  "error": "Unauthorized"
}

// 404 Not Found - Project doesn't exist
{
  "statusCode": 404,
  "message": "Project not found",
  "error": "Not Found"
}
```

---

### Logout

#### `POST /auth/:projectId/logout`

Revoke a refresh token (logout user).

**Authentication:** None required (refresh token in body)

**URL Parameters:**
- `projectId`: Project ID

**Request Body:**

```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:** `200 OK`

```json
{
  "message": "Logged out successfully"
}
```

**Error Responses:**

```json
// 401 Unauthorized - Invalid refresh token
{
  "statusCode": 401,
  "message": "Invalid refresh token",
  "error": "Unauthorized"
}

// 404 Not Found - Project doesn't exist
{
  "statusCode": 404,
  "message": "Project not found",
  "error": "Not Found"
}
```

---

### Get User Info

#### `GET /auth/:projectId/user`

Get authenticated user information.

**Authentication:** Required (JWT in Authorization header)

**URL Parameters:**
- `projectId`: Project ID

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:** `200 OK`

```json
{
  "user_id": "123e4567-e89b-12d3-a456-426614174000",
  "email": "user@example.com",
  "created_at": "2025-12-04T10:00:00.000Z"
}
```

**Error Responses:**

```json
// 401 Unauthorized - Missing or invalid token
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}

// 404 Not Found - User deleted or project doesn't exist
{
  "statusCode": 404,
  "message": "User not found",
  "error": "Not Found"
}
```

---

## JWT Token Format

### Access Token

**Type:** Short-lived (15 minutes)

**Claims:**

```json
{
  "sub": "user_id",
  "email": "user@example.com",
  "project_id": "proj_802682481788fe51",
  "type": "access",
  "iat": 1733317200,
  "exp": 1733320800
}
```

**Usage:** Include in `Authorization: Bearer <token>` header for all authenticated requests.

---

### Refresh Token

**Type:** Long-lived (7 days)

**Claims:**

```json
{
  "sub": "user_id",
  "jti": "token_id",
  "project_id": "proj_802682481788fe51",
  "type": "refresh",
  "iat": 1733317200,
  "exp": 1733922000
}
```

**Usage:** Store securely, use only for `/auth/:projectId/refresh` endpoint.

**Security:** Refresh tokens are stored in database and can be revoked.

---

## Integration with Platform API

The Auth Service integrates with the Platform API for JWT secret management:

1. **Project Creation:** Platform API generates JWT secret for each project
2. **Secret Storage:** JWT secret encrypted and stored in platform database
3. **Secret Retrieval:** Auth Service retrieves JWT secret when validating tokens
4. **Per-Project Isolation:** Each project uses its own JWT secret

---

## Database Schema

Users are stored in the per-project database in the `auth` schema:

```sql
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE auth.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_activity_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE auth.refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES auth.sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Security Considerations

1. **Password Requirements:**
   - Minimum 8 characters
   - At least one uppercase letter
   - At least one lowercase letter
   - At least one number
   - Hashed using Argon2id (timeCost: 2, memoryCost: 64MB)

2. **Token Security:**
   - Access tokens are short-lived (1 hour)
   - Refresh tokens are long-lived but revocable
   - Refresh token rotation on every refresh
   - Tokens stored hashed in database

3. **HTTPS Required:**
   - Always use HTTPS in production
   - Tokens transmitted in headers (not URL parameters)

4. **Error Handling:**
   - Uses centralized ERRORS factory for consistent error responses
   - LaunchDbErrorFilter registered for proper HTTP status codes
   - All errors return standardized LaunchDbError format

5. **Rate Limiting:**
   - Consider rate limiting login/signup endpoints
   - Implement account lockout after failed attempts (v1.1)

6. **Email Verification:**
   - v1 does not implement email verification
   - Consider adding email verification in production (v1.1)

---

## Environment Variables

**Required:**
- `PLATFORM_DB_DSN`: PostgreSQL connection string for platform database
- `CORS_ORIGIN`: Allowed CORS origin for client applications
- `AUTH_SERVICE_PORT`: Service port (default: 8001)

**Optional:**
- `JWT_SECRET`: Global JWT secret (per-project secrets override this)

See [Environment Variables Documentation](./platform-env-vars.md) for full reference.

---

## Error Handling

The Auth Service uses the centralized `@launchdb/common/errors` library for consistent error responses.

**Error Factory Pattern:**
```typescript
import { ERRORS } from '@launchdb/common/errors';

// User already exists
throw ERRORS.UserAlreadyExists(email);

// Invalid credentials
throw ERRORS.InvalidCredentials();

// Token invalid/expired
throw ERRORS.TokenInvalid();

// User not found
throw ERRORS.UserNotFound(userId);

// Project not found
throw ERRORS.ProjectNotFound(projectId);
```

**LaunchDbErrorFilter:**
The service registers `LaunchDbErrorFilter` globally to convert LaunchDbError instances to proper HTTP responses with correct status codes.

**Common Error Codes:**
- 400: Validation errors, malformed requests
- 401: Invalid credentials, expired/revoked tokens
- 404: Project not found, user not found
- 409: Email already registered
- 500: Internal server errors

---

## Client Implementation Example

### JavaScript/TypeScript

```typescript
class AuthClient {
  private baseUrl: string;
  private projectId: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor(baseUrl: string, projectId: string) {
    this.baseUrl = baseUrl;
    this.projectId = projectId;
  }

  async signup(email: string, password: string) {
    const response = await fetch(
      `${this.baseUrl}/auth/${this.projectId}/signup`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }
    );

    if (!response.ok) {
      throw new Error('Signup failed');
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;

    // Store tokens securely (e.g., HttpOnly cookies or secure storage)
    localStorage.setItem('refresh_token', this.refreshToken);

    return data;
  }

  async login(email: string, password: string) {
    const response = await fetch(
      `${this.baseUrl}/auth/${this.projectId}/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }
    );

    if (!response.ok) {
      throw new Error('Login failed');
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;

    localStorage.setItem('refresh_token', this.refreshToken);

    return data;
  }

  async refresh() {
    const refreshToken = this.refreshToken || localStorage.getItem('refresh_token');

    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch(
      `${this.baseUrl}/auth/${this.projectId}/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }
    );

    if (!response.ok) {
      // Refresh token invalid/expired - redirect to login
      this.logout();
      throw new Error('Session expired');
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    this.refreshToken = data.refresh_token;

    localStorage.setItem('refresh_token', this.refreshToken);

    return data;
  }

  async logout() {
    const refreshToken = this.refreshToken || localStorage.getItem('refresh_token');

    if (refreshToken) {
      await fetch(`${this.baseUrl}/auth/${this.projectId}/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    }

    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('refresh_token');
  }

  async getUser() {
    const response = await fetch(
      `${this.baseUrl}/auth/${this.projectId}/user`,
      {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      }
    );

    if (response.status === 401) {
      // Try refreshing token
      await this.refresh();

      // Retry request
      return this.getUser();
    }

    if (!response.ok) {
      throw new Error('Failed to get user');
    }

    return response.json();
  }

  // Authenticated fetch wrapper
  async fetch(url: string, options: RequestInit = {}) {
    options.headers = {
      ...options.headers,
      'Authorization': `Bearer ${this.accessToken}`,
    };

    let response = await fetch(url, options);

    // Auto-refresh on 401
    if (response.status === 401) {
      await this.refresh();

      options.headers['Authorization'] = `Bearer ${this.accessToken}`;
      response = await fetch(url, options);
    }

    return response;
  }
}

// Usage
const auth = new AuthClient('http://localhost:8001', 'proj_802682481788fe51');

// Signup
await auth.signup('user@example.com', 'SecurePass123');

// Login
await auth.login('user@example.com', 'SecurePass123');

// Get user info
const user = await auth.getUser();

// Make authenticated request
const response = await auth.fetch('http://localhost:8000/db/proj_802682481788fe51/users');

// Logout
await auth.logout();
```

---

## Testing

### Local Development

```bash
# Auth Service runs on port 8001
curl http://localhost:8001/health
```

### Test Flow

```bash
# 1. Signup
curl -X POST http://localhost:8001/auth/proj_802682481788fe51/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123"}'

# Response includes access_token and refresh_token

# 2. Get user info
curl -X GET http://localhost:8001/auth/proj_802682481788fe51/user \
  -H "Authorization: Bearer <access_token>"

# 3. Refresh token (after access_token expires)
curl -X POST http://localhost:8001/auth/proj_802682481788fe51/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"<refresh_token>"}'

# 4. Logout
curl -X POST http://localhost:8001/auth/proj_802682481788fe51/logout \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"<refresh_token>"}'
```

---

## Error Codes Reference

| Status Code | Error | Description |
|-------------|-------|-------------|
| 400 | Bad Request | Invalid request body or validation failed |
| 401 | Unauthorized | Invalid credentials or expired/revoked token |
| 404 | Not Found | Project or user not found |
| 409 | Conflict | Email already registered |
| 500 | Internal Server Error | Server error during operation |

---

## Future Enhancements (v1.1)

1. **Email Verification:** Require email verification before allowing login
2. **Password Reset:** Forgot password flow with email tokens
3. **Account Lockout:** Lock accounts after N failed login attempts
4. **Two-Factor Authentication:** TOTP-based 2FA
5. **OAuth Providers:** Google, GitHub, etc. authentication
6. **Session Management:** List and revoke active sessions
7. **Audit Logging:** Track authentication events

---

## See Also

- [Platform API Documentation](./platform-api.md) - Project management and proxy
- [Storage Service Documentation](./storage-service.md) - Per-project file storage
- [Database Schema](./database-schema.md) - Platform and project database schemas
- [Environment Variables](./platform-env-vars.md) - Configuration reference
