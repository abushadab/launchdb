# PgBouncer Authentication Troubleshooting Guide

## Overview

PgBouncer is configured to use `md5` authentication, which requires passwords to be stored as MD5 hashes. PostgreSQL 15+ defaults to SCRAM-SHA-256 authentication, which can cause compatibility issues.

## Current Configuration

### PgBouncer (`pgbouncer.ini`)
```ini
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
```

### PostgreSQL (`docker-compose.yml`)
```yaml
command:
  - "postgres"
  - "-c"
  - "password_encryption=md5"  # Forces new passwords to use MD5
```

## Authentication Flow

1. Client connects to PgBouncer (port 6432)
2. PgBouncer checks credentials against `/etc/pgbouncer/userlist.txt`
3. If credentials match, PgBouncer connects to PostgreSQL using the same credentials
4. PostgreSQL validates using `pg_hba.conf` (must allow `md5` auth method)

## Common Issues and Solutions

### Issue 1: "password authentication failed" when using PgBouncer

**Cause**: User passwords in PostgreSQL were created with SCRAM-SHA-256 (default in PG15+), but PgBouncer expects MD5.

**Solution**: Recreate users with MD5 passwords

```sql
-- Connect directly to Postgres (bypass PgBouncer)
-- For each user that needs to authenticate through PgBouncer:
ALTER ROLE username PASSWORD 'password';  -- Will use md5 due to password_encryption=md5
```

### Issue 2: PgBouncer userlist is out of sync

**Cause**: User added to PostgreSQL but not to PgBouncer userlist.

**Solution**: Add user to PgBouncer

```bash
# From host or postgrest-manager container
/scripts/pgbouncer-add-user.sh "username" "password"

# This script:
# 1. Generates MD5 hash: md5(password + username)
# 2. Adds entry to /etc/pgbouncer/userlist.txt
# 3. Reloads PgBouncer with SIGHUP
```

### Issue 3: Existing installation with SCRAM passwords

**Symptom**: Database was initialized before `password_encryption=md5` was set.

**Solution Option A - Reset passwords**:
```sql
-- Connect to Postgres directly (not through PgBouncer)
ALTER ROLE authenticator PASSWORD 'new_password';
ALTER ROLE proj_abc123_authenticator PASSWORD 'new_password';
-- etc for each role
```

Then update PgBouncer userlist:
```bash
docker exec launchdb-postgrest-manager \
  /scripts/pgbouncer-add-user.sh "authenticator" "new_password"
```

**Solution Option B - Recreate database volume** (destructive):
```bash
# WARNING: This deletes all data
docker compose down -v
docker volume rm launchdb_postgres-data
docker compose up -d postgres
# Wait for init scripts to run
```

### Issue 4: pg_hba.conf doesn't allow md5 auth

**Symptom**: Error "no pg_hba.conf entry for host"

**Check current pg_hba.conf**:
```bash
docker exec launchdb-postgres cat /var/lib/postgresql/data/pg_hba.conf
```

**Expected entries**:
```
host    all             all             172.16.0.0/12           md5
host    all             all             192.168.0.0/16          md5
```

**Solution**: For existing installations, update pg_hba.conf manually:
```bash
# Enter the container
docker exec -it launchdb-postgres sh

# Edit pg_hba.conf
vi /var/lib/postgresql/data/pg_hba.conf

# Change lines like:
#   host all all 0.0.0.0/0 scram-sha-256
# To:
#   host all all 0.0.0.0/0 md5

# Reload Postgres
psql -U postgres -c "SELECT pg_reload_conf();"
```

## Verification Steps

### 1. Check password encryption setting
```bash
docker exec launchdb-postgres \
  psql -U postgres -d platform -c "SHOW password_encryption;"
# Expected: md5
```

### 2. Check user password encryption method
```sql
-- Check how a user's password is stored
SELECT rolname, rolpassword
FROM pg_authid
WHERE rolname = 'authenticator';

-- If rolpassword starts with "md5": ✅ MD5 password
-- If rolpassword starts with "SCRAM": ❌ SCRAM password (won't work with PgBouncer md5 auth)
```

### 3. Check PgBouncer userlist
```bash
docker exec launchdb-pgbouncer cat /etc/pgbouncer/userlist.txt

# Expected format:
# "username" "md5<32-char-hex-hash>"
```

### 4. Test connection through PgBouncer
```bash
# From within Docker network
docker exec launchdb-platform-api \
  psql -h pgbouncer -p 6432 -U authenticator -d platform -c "SELECT 1;"

# If successful: ✅ PgBouncer authentication working
# If "password authentication failed": ❌ Auth issue (see solutions above)
```

## Best Practices

1. **Always use scripts for user management**:
   - Create DB user: `CREATE ROLE ... PASSWORD ...`
   - Add to PgBouncer: `/scripts/pgbouncer-add-user.sh`
   - Keep both in sync

2. **For new projects**:
   ```bash
   # Platform API creates project database and user
   PROJECT_ID="proj_abc123"
   PASSWORD=$(openssl rand -base64 32)

   # 1. Create PostgreSQL user (will use md5 due to password_encryption=md5)
   psql -h postgres -U postgres -c "CREATE ROLE ${PROJECT_ID}_authenticator LOGIN PASSWORD '$PASSWORD'"

   # 2. Write PostgREST config with URL-encoded password
   ENCODED_PASSWORD=$(urlencode "$PASSWORD")
   echo "db-uri = \"postgres://${PROJECT_ID}_authenticator:${ENCODED_PASSWORD}@pgbouncer:6432/${PROJECT_ID}\"" > config.conf

   # 3. Add to PgBouncer userlist (pass raw password, script generates md5 hash)
   /scripts/pgbouncer-add-user.sh "${PROJECT_ID}_authenticator" "$PASSWORD"

   # 4. Spawn PostgREST container
   curl -X POST http://postgrest-manager:9000/internal/postgrest/spawn \
     -H "X-Internal-Key: $INTERNAL_API_KEY" \
     -d "{\"projectId\": \"$PROJECT_ID\", \"authenticatorPassword\": \"$PASSWORD\"}"
   ```

3. **Store the pg_hba.conf reference**:
   - Reference file: `/postgres/pg_hba.conf`
   - For new installations, this can be copied during setup
   - For existing installations, manual update required

## Technical Details

### MD5 Hash Format in PgBouncer

PgBouncer userlist format:
```
"username" "md5<hash>"
```

Where `<hash>` is:
```
md5( <password> + <username> )
```

Example:
```bash
# Username: testuser
# Password: testpass
echo -n "testpasstestuser" | md5sum
# Output: 12345abcdef... (32 hex chars)
# Userlist entry: "testuser" "md512345abcdef..."
```

This is the same format PostgreSQL uses for md5 passwords in `pg_authid.rolpassword`.

### Why MD5 Instead of SCRAM?

**Limitation**: PgBouncer doesn't support SCRAM-SHA-256 authentication with `auth_type = md5`.

**Options**:
1. Use `auth_type = md5` (current setup)
   - Pros: Simple, works with auth_file
   - Cons: MD5 is cryptographically weaker than SCRAM

2. Use `auth_type = scram-sha-256`
   - Pros: More secure
   - Cons: Requires auth_query and PgBouncer can't cache passwords
   - Note: May require PgBouncer 1.21+ with proper SCRAM support

**Current Choice**: We use `md5` for simplicity and to support the userlist.txt approach, which the scripts manage. For production deployments requiring stronger auth, consider migrating to SCRAM with auth_query.

## References

- [PgBouncer Authentication Docs](https://www.pgbouncer.org/config.html#authentication-settings)
- [PostgreSQL Authentication Methods](https://www.postgresql.org/docs/current/auth-methods.html)
- [PostgreSQL Password Encryption](https://www.postgresql.org/docs/current/runtime-config-connection.html#GUC-PASSWORD-ENCRYPTION)
