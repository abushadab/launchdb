# PgBouncer Authentication Troubleshooting Guide

## Overview

PgBouncer is configured to use SCRAM-SHA-256 authentication with dynamic password lookup via `auth_query`. This eliminates the need to maintain a static `userlist.txt` file for project users while providing stronger security than MD5.

## Current Configuration

### PgBouncer (`pgbouncer.ini`)
```ini
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
auth_user = pgbouncer_auth
auth_query = SELECT usename, passwd FROM pgbouncer.get_auth($1)
auth_dbname = platform
```

### PostgreSQL (`docker-compose.yml`)
```yaml
environment:
  - POSTGRES_PASSWORD_ENCRYPTION=scram-sha-256
```

### PostgreSQL (`pg_hba.conf`)
```
# PgBouncer auth_query user needs trust to query pg_shadow
host    all             pgbouncer_auth  172.16.0.0/12           trust
host    all             pgbouncer_auth  192.168.0.0/16          trust

# All other connections use SCRAM-SHA-256
host    all             all             172.16.0.0/12           scram-sha-256
host    all             all             192.168.0.0/16          scram-sha-256
```

## Authentication Flow

1. Client connects to PgBouncer (port 6432)
2. PgBouncer queries: `SELECT usename, passwd FROM pgbouncer.get_auth('username')`
3. The function queries `pg_shadow` with SECURITY DEFINER privileges
4. Function returns native SCRAM-SHA-256 hash from PostgreSQL
5. PgBouncer validates credentials against returned hash
6. If valid, PgBouncer creates connection to PostgreSQL

**Key advantage**: No MD5/SCRAM mismatch - passwords are always retrieved directly from PostgreSQL.

## Common Issues and Solutions

### Issue 1: "password authentication failed" when using PgBouncer

**Cause**: User doesn't exist in PostgreSQL or `pgbouncer.get_auth()` function not created.

**Solution A - Verify user exists**:
```sql
-- Connect directly to Postgres (bypass PgBouncer)
SELECT usename, passwd FROM pg_shadow WHERE usename = 'proj_xxx_authenticator';
```

**Solution B - Check auth function exists**:
```bash
docker exec launchdb-postgres psql -U postgres -d platform -c "\df pgbouncer.get_auth"
```

If missing, run SQL migration to create it:
```sql
CREATE SCHEMA IF NOT EXISTS pgbouncer;

CREATE OR REPLACE FUNCTION pgbouncer.get_auth(p_usename TEXT)
RETURNS TABLE(usename TEXT, passwd TEXT)
LANGUAGE SQL SECURITY DEFINER
AS $$
  SELECT usename::TEXT, passwd::TEXT
  FROM pg_shadow
  WHERE usename = p_usename;
$$;
```

### Issue 2: PgBouncer can't connect to PostgreSQL

**Symptom**: Error "FATAL: no pg_hba.conf entry for user pgbouncer_auth"

**Cause**: `pgbouncer_auth` user not allowed to connect via pg_hba.conf

**Solution**: Verify pg_hba.conf has trust rule for pgbouncer_auth:
```bash
docker exec launchdb-postgres cat /var/lib/postgresql/data/pg_hba.conf | grep pgbouncer_auth
```

Expected:
```
host    all             pgbouncer_auth  172.16.0.0/12           trust
host    all             pgbouncer_auth  192.168.0.0/16          trust
```

### Issue 3: "password authentication failed for user pgbouncer_auth"

**Symptom**: PgBouncer can't authenticate as pgbouncer_auth

**Cause**: `pgbouncer_auth` not in userlist.txt (chicken-and-egg - auth_user can't use auth_query to authenticate itself)

**Solution**: Add pgbouncer_auth to userlist.txt manually:
```bash
# Get SCRAM hash from PostgreSQL
docker exec launchdb-postgres psql -U postgres -d platform -c \
  "SELECT passwd FROM pg_shadow WHERE usename = 'pgbouncer_auth';"

# Output looks like: SCRAM-SHA-256$4096:...

# Add to userlist.txt (replace <hash> with actual hash)
docker exec launchdb-pgbouncer sh -c \
  'echo "\"pgbouncer_auth\" \"<hash>\"" >> /etc/pgbouncer/userlist.txt'

# Reload PgBouncer
docker exec launchdb-pgbouncer kill -HUP 1
```

### Issue 4: New project user can't authenticate

**Symptom**: `proj_xxx_authenticator` gets "password authentication failed"

**Cause**: User might not exist in PostgreSQL, or password doesn't match

**Solution**: Verify user and re-create if needed
```sql
-- Check if user exists
SELECT usename FROM pg_shadow WHERE usename = 'proj_xxx_authenticator';

-- Re-create user with correct password
DROP ROLE IF EXISTS proj_xxx_authenticator;
CREATE ROLE proj_xxx_authenticator LOGIN PASSWORD 'your_password_here';
```

**Note**: No need to update userlist.txt - auth_query handles authentication dynamically!

### Issue 5: Admin users (postgres, pgbouncer_admin) can't connect

**Symptom**: Admin users get authentication errors through PgBouncer

**Cause**: Admin users need to be in userlist.txt (not handled by auth_query for security)

**Solution**: Add to userlist.txt:
```bash
# Get hash from PostgreSQL
docker exec launchdb-postgres psql -U postgres -c \
  "SELECT passwd FROM pg_shadow WHERE usename = 'postgres';"

# Add to userlist.txt
docker exec launchdb-pgbouncer sh -c \
  'echo "\"postgres\" \"SCRAM-SHA-256\$...\"" >> /etc/pgbouncer/userlist.txt'

# Reload
docker exec launchdb-pgbouncer kill -HUP 1
```

## Verification Steps

### 1. Check password encryption setting
```bash
docker exec launchdb-postgres \
  psql -U postgres -d platform -c "SHOW password_encryption;"
# Expected: scram-sha-256
```

### 2. Check user password format
```sql
-- Check how a user's password is stored
SELECT rolname, LEFT(rolpassword, 20)
FROM pg_authid
WHERE rolname = 'proj_xxx_authenticator';

-- If starts with "SCRAM-SHA-256": ✅ Correct
-- If starts with "md5": ❌ Wrong encryption (shouldn't happen with current setup)
```

### 3. Check PgBouncer userlist
```bash
docker exec launchdb-pgbouncer cat /etc/pgbouncer/userlist.txt

# Expected: Only admin users (pgbouncer_auth, postgres, pgbouncer_admin)
# Project authenticators NOT in this file (use auth_query)
```

### 4. Test auth_query function
```bash
docker exec launchdb-postgres psql -U postgres -d platform -c \
  "SELECT * FROM pgbouncer.get_auth('proj_xxx_authenticator');"

# Should return: usename | passwd
#                proj_xxx_authenticator | SCRAM-SHA-256$...
```

### 5. Test connection through PgBouncer
```bash
# From within Docker network
docker exec launchdb-platform-api \
  psql -h pgbouncer -p 6432 -U proj_xxx_authenticator -d proj_xxx -c "SELECT 1;"

# If successful: ✅ PgBouncer authentication working
# If "password authentication failed": ❌ Check solutions above
```

## Best Practices

### 1. Always use platform-api for user creation
Platform-api handles the full workflow:
- Creates PostgreSQL user with SCRAM password
- Writes PostgREST config with URL-encoded password
- Calls postgrest-manager API to spawn container
- No manual PgBouncer userlist.txt updates needed!

### 2. For new projects
```bash
# Managed by platform-api (reference implementation)
PROJECT_ID="proj_abc123"
PASSWORD=$(openssl rand -base64 32)

# 1. Create PostgreSQL user
psql -h postgres -U postgres -c \
  "CREATE ROLE ${PROJECT_ID}_authenticator LOGIN PASSWORD '$PASSWORD'"

# 2. Add project to PgBouncer (database routing only)
/scripts/pgbouncer-add-project.sh "$PROJECT_ID"

# 3. Add user to PgBouncer (triggers reload, but no userlist.txt update with SCRAM)
/scripts/pgbouncer-add-user.sh "${PROJECT_ID}_authenticator"

# 4. Authentication works automatically via auth_query! ✅
```

### 3. Monitoring authentication
```bash
# PgBouncer logs
docker logs launchdb-pgbouncer --tail 50

# Check for auth errors
docker logs launchdb-pgbouncer 2>&1 | grep -i "auth\|password\|login"
```

## Technical Details

### SCRAM-SHA-256 vs MD5

| Aspect | MD5 (old) | SCRAM-SHA-256 (current) |
|--------|-----------|-------------------------|
| Security | Weak (deprecated) | Strong (NIST approved) |
| Salt | Username as salt | Random salt per password |
| Hash storage | `md5<hash>` | `SCRAM-SHA-256$4096:...` |
| PgBouncer support | Native | Requires auth_query |
| userlist.txt | All users | Only admin users |

### auth_query Function

The `pgbouncer.get_auth()` function:
- Runs with `SECURITY DEFINER` (executes as function owner, not caller)
- Queries `pg_shadow` system catalog (requires superuser privileges)
- Returns native PostgreSQL password hash (SCRAM format)
- Allows PgBouncer to validate SCRAM credentials

### userlist.txt in SCRAM Mode

**Who needs to be in userlist.txt:**
- `pgbouncer_auth` (the auth_user that queries pg_shadow)
- `postgres` (superuser for admin access)
- `pgbouncer_admin` (admin user, optional)

**Who does NOT need to be in userlist.txt:**
- Project authenticators (`proj_xxx_authenticator`) - use auth_query
- Application users - use auth_query
- Any user created by platform-api - use auth_query

### Container Names

| Service | Container Name | Purpose |
|---------|----------------|---------|
| PgBouncer | `launchdb-pgbouncer` | Connection pooler |
| PostgreSQL | `launchdb-postgres` | Database server |
| Platform API | `launchdb-platform-api` | Control plane API |
| PostgREST Manager | `launchdb-postgrest-manager` | PostgREST lifecycle |
| PostgREST (per-project) | `postgrest-proj_xxx` | Per-project REST API |

## Migration from MD5 (if applicable)

If you previously used MD5 authentication:

**Step 1: Update configuration**
- Already done in current setup ✅

**Step 2: Recreate pgbouncer.get_auth() function**
- Run SQL migration (Sonnet A's migration 004)

**Step 3: Update userlist.txt**
- Remove all project authenticator users
- Keep only pgbouncer_auth, postgres, pgbouncer_admin
- Update their hashes to SCRAM format from pg_shadow

**Step 4: Reload PgBouncer**
```bash
docker exec launchdb-pgbouncer kill -HUP 1
```

**Step 5: Test**
```bash
# Should work immediately (auth_query retrieves SCRAM hashes)
docker exec launchdb-platform-api \
  psql -h pgbouncer -p 6432 -U proj_xxx_authenticator -d proj_xxx -c "SELECT 1;"
```

## References

- [PgBouncer Authentication Docs](https://www.pgbouncer.org/config.html#authentication-settings)
- [PostgreSQL SCRAM Authentication](https://www.postgresql.org/docs/current/auth-password.html)
- [PostgreSQL Password Encryption](https://www.postgresql.org/docs/current/runtime-config-connection.html#GUC-PASSWORD-ENCRYPTION)
- [PgBouncer auth_query Examples](https://www.pgbouncer.org/config.html#auth_query)
