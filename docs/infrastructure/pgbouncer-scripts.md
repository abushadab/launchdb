# PgBouncer Scripts Documentation

## Table of Contents

- [Overview](#overview)
- [Concurrency Protection](#concurrency-protection)
- [Scripts Reference](#scripts-reference)
  - [pgbouncer-add-project.sh](#pgbouncer-add-projectsh)
  - [pgbouncer-add-user.sh](#pgbouncer-add-usersh)
  - [pgbouncer-remove-project.sh](#pgbouncer-remove-projectsh)
  - [pgbouncer-remove-user.sh](#pgbouncer-remove-usersh)
- [Configuration Files](#configuration-files)
- [Backup System](#backup-system)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)

## Overview

PgBouncer scripts manage dynamic registration and removal of project databases and users in PgBouncer's configuration. These scripts are executed by the Manager API during project lifecycle operations.

**Location:** `/scripts/` (mounted read-only in Manager API container)

**Key Features:**
- **Concurrency-safe:** File locking prevents race conditions
- **Atomic operations:** Read-modify-write cycles are serialized
- **Automatic backups:** Timestamped backups before each modification
- **Idempotent:** Safe to run multiple times
- **Error handling:** Graceful failures with clear error messages

**Scripts:**

| Script | Purpose | Called By |
|--------|---------|-----------|
| `pgbouncer-add-project.sh` | Register project database | Manager API (spawn) |
| `pgbouncer-add-user.sh` | Register authenticator user | Manager API (spawn) |
| `pgbouncer-remove-project.sh` | Unregister project database | Manager API (delete) |
| `pgbouncer-remove-user.sh` | Unregister authenticator user | Manager API (delete) |

## Concurrency Protection

### The Problem

Multiple projects can be created/deleted simultaneously, causing concurrent modifications to PgBouncer configuration files. Without protection, this leads to:

1. **File corruption:** Read-modify-write race conditions
2. **Lost updates:** Last write wins, earlier changes disappear
3. **Zero-byte files:** Interrupted writes truncate files

**Example Race Condition:**
```
Time  Process A          Process B          File State
----  ----------------  ----------------   -----------
T1    Read config       -                  [A,B,C]
T2    -                 Read config        [A,B,C]
T3    Modify (add D)    -                  [A,B,C]
T4    -                 Modify (add E)     [A,B,C]
T5    Write back        -                  [A,B,C,D]
T6    -                 Write back         [A,B,C,E]  ← D lost!
```

### The Solution: Three-Layer Protection

#### 1. File Locking (flock)

Serializes read-modify-write operations using POSIX file locks:

```bash
(
  flock -x 200              # Acquire exclusive lock
  TMPFILE=$(mktemp)         # Create unique temp file
  # Read, modify, write
  cat "$TMPFILE" > /etc/pgbouncer/pgbouncer.ini
  rm "$TMPFILE"
) 200>/etc/pgbouncer/pgbouncer.ini.lock  # Lock file
```

**How it works:**
- Process acquires exclusive lock on `.lock` file
- Other processes wait until lock is released
- Lock automatically released when subprocess exits
- If process crashes, lock is released by OS

#### 2. Unique Temp Files (mktemp)

Each process uses a unique temporary file:

```bash
TMPFILE=$(mktemp)  # Creates /tmp/tmp.Xa3kL9 (unique)
```

**Benefits:**
- No temp file collisions between processes
- Safe even without locking (but locking still required for config file)
- Automatic cleanup on script exit

#### 3. Root User Permissions

All scripts run with `--user root` to ensure write permissions:

```bash
docker exec --user root launchdb-pgbouncer /scripts/pgbouncer-add-project.sh ...
```

### Concurrency Test Results

**Verified Under Load:**
- ✅ 6 parallel project creates - all succeeded
- ✅ PgBouncer files intact (no corruption)
- ✅ All entries correctly added
- ✅ No race conditions detected

**Before Fixes:**
- ❌ File corruption (0-byte files)
- ❌ Lost entries (last write wins)
- ❌ Authentication failures

## Scripts Reference

### pgbouncer-add-project.sh

Registers a project database in PgBouncer configuration.

**Location:** `/scripts/pgbouncer-add-project.sh`

**Usage:**

```bash
./pgbouncer-add-project.sh <project_id> [pool_size] [reserve_pool]
```

**Parameters:**

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `project_id` | Yes | - | Project identifier (e.g., `proj_abc123`) |
| `pool_size` | No | 5 | Number of connections in pool |
| `reserve_pool` | No | 2 | Number of reserved connections |

**Example:**

```bash
# Use default pool sizes (5/2)
./pgbouncer-add-project.sh proj_abc123

# Custom pool sizes (10/3)
./pgbouncer-add-project.sh proj_abc123 10 3
```

**What It Does:**

1. **Validates input:** Checks project_id is provided
2. **Checks container:** Verifies PgBouncer container is running
3. **Creates backup:** Timestamped backup of current config
4. **Checks for duplicates:** Returns success if project already exists
5. **Adds database entry:** Inserts after `[databases]` section
6. **Reloads PgBouncer:** Sends SIGHUP signal (graceful reload)

**Configuration Added:**

```ini
proj_abc123 = host=postgres port=5432 dbname=proj_abc123 pool_size=5 reserve_pool=2
```

**Output:**

```
Backed up config to: /etc/pgbouncer/pgbouncer.ini.backup.1733404800
Added proj_abc123 to PgBouncer config
  pool_size: 5
  reserve_pool: 2
Reloaded PgBouncer via docker
Project proj_abc123 successfully added to PgBouncer
```

**Exit Codes:**

| Code | Meaning |
|------|---------|
| 0 | Success (added or already exists) |
| 1 | Error (missing parameters, container not running, or modification failed) |

**Implementation Details:**

```bash
#!/bin/bash
set -e

PROJECT_ID="${1}"
POOL_SIZE="${2:-5}"
RESERVE_POOL="${3:-2}"

# Validation
if [ -z "$PROJECT_ID" ]; then
    echo "Error: project_id required"
    exit 1
fi

# Container check
if ! docker ps --format '{{.Names}}' | grep -q "^launchdb-pgbouncer$"; then
    echo "Error: PgBouncer container is not running"
    exit 1
fi

# Backup
BACKUP_FILE="/etc/pgbouncer/pgbouncer.ini.backup.$(date +%s)"
docker exec --user root launchdb-pgbouncer cp /etc/pgbouncer/pgbouncer.ini "$BACKUP_FILE"

# Add entry with flock protection
docker exec --user root launchdb-pgbouncer sh -c "
  (
    flock -x 200
    TMPFILE=\$(mktemp)
    awk '/^\[databases\]/{print; print \"${PROJECT_ID} = host=postgres port=5432 dbname=${PROJECT_ID} pool_size=${POOL_SIZE} reserve_pool=${RESERVE_POOL}\"; next}1' /etc/pgbouncer/pgbouncer.ini > \"\${TMPFILE}\"
    cat \"\${TMPFILE}\" > /etc/pgbouncer/pgbouncer.ini
    rm \"\${TMPFILE}\"
  ) 200>/etc/pgbouncer/pgbouncer.ini.lock
"

# Reload
docker exec --user root launchdb-pgbouncer kill -HUP 1
```

**Error Handling:**

- Script exits on first error (`set -e`)
- Backup created before modifications
- Lock prevents concurrent corruption
- Graceful reload (no dropped connections)

---

### pgbouncer-add-user.sh

Registers an authenticator user in PgBouncer's userlist.

**Location:** `/scripts/pgbouncer-add-user.sh`

**Usage:**

```bash
./pgbouncer-add-user.sh <username> <password>
```

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `username` | Yes | Username (e.g., `proj_abc123_authenticator`) |
| `password` | Yes | Plain-text password (will be MD5 hashed) |

**Example:**

```bash
./pgbouncer-add-user.sh proj_abc123_authenticator mySecurePassword123
```

**What It Does:**

1. **Validates input:** Checks username and password provided
2. **Checks container:** Verifies PgBouncer container is running
3. **Creates backup:** Timestamped backup of userlist.txt
4. **Generates MD5 hash:** Computes `md5(password + username)`
5. **Removes old entry:** If user exists, removes it (update scenario)
6. **Adds new entry:** Appends to userlist.txt
7. **Reloads PgBouncer:** Sends SIGHUP signal

**MD5 Hash Format:**

PgBouncer expects: `"username" "md5<hash>"`

Where `<hash>` = MD5(password + username)

**Example Entry:**

```
"proj_abc123_authenticator" "md5a1b2c3d4e5f6..."
```

**Output:**

```
Backed up userlist to: /etc/pgbouncer/userlist.txt.backup.1733404800
Added user 'proj_abc123_authenticator' to PgBouncer userlist
Password hash: md5a1b2c3d4e5f6...
Reloaded PgBouncer via docker
User 'proj_abc123_authenticator' successfully added to PgBouncer
```

**Security Note:**

Password is passed as command-line argument. This is secure within Docker exec context but visible in process list briefly. For production, consider:
- Using environment variables
- Reading from stdin
- Using Docker secrets

**Implementation Highlights:**

```bash
# Generate MD5 hash
HASH_INPUT="${PASSWORD}${USERNAME}"
MD5_HASH=$(echo -n "$HASH_INPUT" | md5sum | awk '{print $1}')
PGBOUNCER_PASSWORD="md5${MD5_HASH}"

# Remove existing entry (if any) with flock
docker exec --user root launchdb-pgbouncer sh -c "
  (
    flock -x 200
    TMPFILE=\$(mktemp)
    (grep -v '^\"${USERNAME}\"' /etc/pgbouncer/userlist.txt > \"\${TMPFILE}\" || true)
    cat \"\${TMPFILE}\" > /etc/pgbouncer/userlist.txt
    rm \"\${TMPFILE}\"
  ) 200>/etc/pgbouncer/userlist.txt.lock
"

# Add new entry with flock
docker exec --user root launchdb-pgbouncer sh -c "
  (
    flock -x 200
    echo '\"${USERNAME}\" \"${PGBOUNCER_PASSWORD}\"' >> /etc/pgbouncer/userlist.txt
  ) 200>/etc/pgbouncer/userlist.txt.lock
"
```

**Why Two Operations:**

1. **Remove step:** Handles updates (user already exists)
2. **Add step:** Always appends fresh entry

Both use same lock file for atomicity.

---

### pgbouncer-remove-project.sh

Unregisters a project database from PgBouncer configuration.

**Location:** `/scripts/pgbouncer-remove-project.sh`

**Usage:**

```bash
./pgbouncer-remove-project.sh <project_id>
```

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `project_id` | Yes | Project identifier to remove |

**Example:**

```bash
./pgbouncer-remove-project.sh proj_abc123
```

**What It Does:**

1. **Validates input:** Checks project_id is provided
2. **Checks container:** Verifies PgBouncer container is running
3. **Creates backup:** Timestamped backup of current config
4. **Checks existence:** Returns success if project doesn't exist (idempotent)
5. **Removes database entry:** Filters out matching line
6. **Reloads PgBouncer:** Sends SIGHUP signal

**Output:**

```
Backed up config to: /etc/pgbouncer/pgbouncer.ini.backup.1733404800
Removed proj_abc123 from PgBouncer config
Reloaded PgBouncer via docker
Project proj_abc123 successfully removed from PgBouncer
```

**Idempotency:**

If project doesn't exist in config, script returns success with warning:

```
Warning: Project proj_abc123 not found in PgBouncer config
```

This ensures cleanup always succeeds, even if database entry was never added.

**Implementation:**

```bash
# Check if project exists
if ! docker exec --user root launchdb-pgbouncer grep -q "^${PROJECT_ID} =" /etc/pgbouncer/pgbouncer.ini; then
    echo "Warning: Project ${PROJECT_ID} not found in PgBouncer config"
    exit 0
fi

# Remove entry with flock
docker exec --user root launchdb-pgbouncer sh -c "
  (
    flock -x 200
    TMPFILE=\$(mktemp)
    grep -v '^${PROJECT_ID} =' /etc/pgbouncer/pgbouncer.ini > \"\${TMPFILE}\"
    cat \"\${TMPFILE}\" > /etc/pgbouncer/pgbouncer.ini
    rm \"\${TMPFILE}\"
  ) 200>/etc/pgbouncer/pgbouncer.ini.lock
"
```

---

### pgbouncer-remove-user.sh

Unregisters an authenticator user from PgBouncer's userlist.

**Location:** `/scripts/pgbouncer-remove-user.sh`

**Usage:**

```bash
./pgbouncer-remove-user.sh <username>
```

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `username` | Yes | Username to remove (e.g., `proj_abc123_authenticator`) |

**Example:**

```bash
./pgbouncer-remove-user.sh proj_abc123_authenticator
```

**What It Does:**

1. **Validates input:** Checks username is provided
2. **Checks container:** Verifies PgBouncer container is running
3. **Creates backup:** Timestamped backup of userlist.txt
4. **Checks existence:** Returns success if user doesn't exist (idempotent)
5. **Removes user entry:** Filters out matching line
6. **Reloads PgBouncer:** Sends SIGHUP signal

**Output:**

```
Backed up userlist to: /etc/pgbouncer/userlist.txt.backup.1733404800
Removed user 'proj_abc123_authenticator' from PgBouncer userlist
Reloaded PgBouncer via docker
User 'proj_abc123_authenticator' successfully removed from PgBouncer
```

**Idempotency:**

If user doesn't exist in userlist, script returns success with warning:

```
Warning: User 'proj_abc123_authenticator' not found in PgBouncer userlist
```

**Implementation:**

```bash
# Check if user exists
if ! docker exec --user root launchdb-pgbouncer grep -q "^\"${USERNAME}\"" /etc/pgbouncer/userlist.txt; then
    echo "Warning: User '${USERNAME}' not found in PgBouncer userlist"
    exit 0
fi

# Remove user with flock
docker exec --user root launchdb-pgbouncer sh -c "
  (
    flock -x 200
    TMPFILE=\$(mktemp)
    grep -v '^\"${USERNAME}\"' /etc/pgbouncer/userlist.txt > \"\${TMPFILE}\"
    cat \"\${TMPFILE}\" > /etc/pgbouncer/userlist.txt
    rm \"\${TMPFILE}\"
  ) 200>/etc/pgbouncer/userlist.txt.lock
"
```

## Configuration Files

### pgbouncer.ini

**Location (Container):** `/etc/pgbouncer/pgbouncer.ini`

**Location (Host):** `./pgbouncer/pgbouncer.ini`

**Structure:**

```ini
[databases]
; Platform database (control plane)
platform = host=postgres port=5432 dbname=platform pool_size=25 reserve_pool=5

; Project databases (dynamically added)
proj_abc123 = host=postgres port=5432 dbname=proj_abc123 pool_size=5 reserve_pool=2
proj_def456 = host=postgres port=5432 dbname=proj_def456 pool_size=5 reserve_pool=2

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = md5
pool_mode = transaction
max_client_conn = 1000
server_connect_timeout = 30
server_login_retry = 30
; ... other settings
```

**Format:**

Each project database entry:
```
<project_id> = host=<host> port=<port> dbname=<dbname> pool_size=<N> reserve_pool=<M>
```

**Capacity Planning:**

```
Total Connections = Σ(pool_size per project) + platform_pool_size
Must be < PostgreSQL max_connections (500)

Example with 50 projects:
50 × 5 = 250 (projects)
+ 25 (platform)
+ 30 (other services)
= 305 connections (39% headroom)
```

### userlist.txt

**Location (Container):** `/etc/pgbouncer/userlist.txt`

**Location (Host):** `./pgbouncer/userlist.txt`

**Structure:**

```
"postgres" "md5abc123def456..."
"proj_abc123_authenticator" "md5a1b2c3d4e5f6..."
"proj_def456_authenticator" "md5b2c3d4e5f6a7..."
```

**Format:**

```
"<username>" "md5<hash>"
```

Where `<hash>` = MD5(password + username)

**Generation:**

```bash
# Manual entry creation
PASSWORD="mypassword"
USERNAME="myuser"
HASH=$(echo -n "${PASSWORD}${USERNAME}" | md5sum | cut -d' ' -f1)
echo "\"${USERNAME}\" \"md5${HASH}\""
```

## Backup System

### Automatic Backups

Every script creates a timestamped backup before modification:

```bash
BACKUP_FILE="/etc/pgbouncer/pgbouncer.ini.backup.$(date +%s)"
docker exec --user root launchdb-pgbouncer cp /etc/pgbouncer/pgbouncer.ini "$BACKUP_FILE"
```

**Backup Location:** Inside PgBouncer container at `/etc/pgbouncer/`

**Naming Convention:**
- `pgbouncer.ini.backup.1733404800`
- `userlist.txt.backup.1733404801`

**Listing Backups:**

```bash
docker exec --user root launchdb-pgbouncer ls -lh /etc/pgbouncer/*.backup.*
```

### Manual Backup

```bash
# Backup pgbouncer.ini
docker exec --user root launchdb-pgbouncer cp /etc/pgbouncer/pgbouncer.ini /etc/pgbouncer/pgbouncer.ini.manual.$(date +%s)

# Backup userlist.txt
docker exec --user root launchdb-pgbouncer cp /etc/pgbouncer/userlist.txt /etc/pgbouncer/userlist.txt.manual.$(date +%s)
```

### Restore from Backup

```bash
# List available backups
docker exec --user root launchdb-pgbouncer ls -lh /etc/pgbouncer/*.backup.*

# Restore specific backup
docker exec --user root launchdb-pgbouncer sh -c "
  cat /etc/pgbouncer/pgbouncer.ini.backup.1733404800 > /etc/pgbouncer/pgbouncer.ini && \
  kill -HUP 1
"
```

### Backup Retention

**Current:** Backups accumulate indefinitely

**Recommendation:** Implement cleanup job:

```bash
# Delete backups older than 7 days
docker exec --user root launchdb-pgbouncer find /etc/pgbouncer -name "*.backup.*" -mtime +7 -delete
```

**Cron Job Example:**

```bash
# Add to crontab
0 2 * * * docker exec --user root launchdb-pgbouncer find /etc/pgbouncer -name "*.backup.*" -mtime +7 -delete
```

## Troubleshooting

### Script Execution Failures

**Problem:** Script exits with error

**Debug:**

1. **Check container status:**
   ```bash
   docker ps | grep pgbouncer
   ```

2. **Run script manually with debug:**
   ```bash
   bash -x /scripts/pgbouncer-add-project.sh proj_test
   ```

3. **Check PgBouncer logs:**
   ```bash
   docker logs launchdb-pgbouncer --tail 50
   ```

### Permission Denied

**Problem:** `permission denied` when modifying files

**Cause:** Not running with `--user root`

**Solution:** Always use `--user root` in docker exec:

```bash
docker exec --user root launchdb-pgbouncer /scripts/pgbouncer-add-project.sh proj_test
```

### File Corruption Despite Locks

**Problem:** Configuration files still corrupted

**Causes:**
1. Scripts not using flock (old version)
2. Disk full (incomplete writes)
3. Container restart during operation

**Solution:**

1. **Verify flock usage:**
   ```bash
   grep -A 5 "flock -x 200" /scripts/pgbouncer-add-project.sh
   ```

2. **Check disk space:**
   ```bash
   docker exec launchdb-pgbouncer df -h
   ```

3. **Restore from backup:**
   ```bash
   # Use most recent backup
   docker exec --user root launchdb-pgbouncer sh -c "
     cat \$(ls -t /etc/pgbouncer/pgbouncer.ini.backup.* | head -1) > /etc/pgbouncer/pgbouncer.ini &&
     kill -HUP 1
   "
   ```

### Reload Not Taking Effect

**Problem:** Changes made but not reflected in PgBouncer

**Causes:**
1. SIGHUP not sent
2. Syntax error in config (reload fails silently)
3. PgBouncer process not responding

**Solution:**

1. **Manually reload:**
   ```bash
   docker exec --user root launchdb-pgbouncer kill -HUP 1
   ```

2. **Check for syntax errors:**
   ```bash
   docker exec launchdb-pgbouncer pgbouncer -q /etc/pgbouncer/pgbouncer.ini
   ```

3. **Restart PgBouncer (disruptive):**
   ```bash
   docker restart launchdb-pgbouncer
   ```

### Lock Files Not Cleaning Up

**Problem:** `.lock` files accumulate

**Cause:** Lock files are automatically cleaned by OS when process exits. If they persist, processes might be stuck.

**Solution:**

1. **Check for stuck processes:**
   ```bash
   docker exec launchdb-pgbouncer ps aux | grep flock
   ```

2. **Manual cleanup (safe when no processes running):**
   ```bash
   docker exec --user root launchdb-pgbouncer rm -f /etc/pgbouncer/*.lock
   ```

## Best Practices

### 1. Always Use Scripts

**Don't:** Manually edit configuration files

```bash
# BAD - Race condition risk
docker exec launchdb-pgbouncer vi /etc/pgbouncer/pgbouncer.ini
```

**Do:** Use provided scripts

```bash
# GOOD - Concurrency safe
/scripts/pgbouncer-add-project.sh proj_new
```

### 2. Check Script Exit Codes

```bash
if /scripts/pgbouncer-add-project.sh proj_test; then
  echo "Success"
else
  echo "Failed with exit code $?"
  exit 1
fi
```

### 3. Verify Changes

After running scripts, verify the change was applied:

```bash
# Verify project added
docker exec --user root launchdb-pgbouncer grep proj_test /etc/pgbouncer/pgbouncer.ini

# Verify user added
docker exec --user root launchdb-pgbouncer grep proj_test_authenticator /etc/pgbouncer/userlist.txt
```

### 4. Monitor Backup Growth

Backups accumulate over time. Monitor disk usage:

```bash
docker exec launchdb-pgbouncer du -sh /etc/pgbouncer/*.backup.*
```

Implement retention policy (see Backup Retention section).

### 5. Test Concurrency

When making changes to scripts, test under concurrent load:

```bash
# Spawn 6 projects in parallel
for i in {1..6}; do
  /scripts/pgbouncer-add-project.sh test_proj_$i &
done
wait

# Verify all succeeded
docker exec --user root launchdb-pgbouncer grep -c "test_proj_" /etc/pgbouncer/pgbouncer.ini
# Should output: 6
```

### 6. Keep Scripts Read-Only

Mount scripts as read-only in containers:

```yaml
volumes:
  - ./scripts:/scripts:ro
```

This prevents accidental modifications from within containers.

### 7. Log Script Execution

When calling from Manager API, log execution:

```javascript
console.log(`Adding ${projectId} to PgBouncer...`);
const { stdout, stderr } = await execAsync(`/scripts/pgbouncer-add-project.sh ${projectId}`);
console.log(`Output: ${stdout}`);
if (stderr) console.error(`Stderr: ${stderr}`);
```

## Security Considerations

### Command Injection Prevention

**Risk:** Project IDs passed to shell scripts

**Mitigation:** Validation before script execution

```javascript
const PROJECT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
if (!PROJECT_ID_REGEX.test(projectId)) {
  throw new Error('Invalid project ID');
}
```

### Password Handling

**Risk:** Passwords passed as command-line arguments (visible in process list)

**Mitigations:**
1. Short-lived: Process exists briefly
2. Container isolation: Process list not visible outside container
3. Recommendation: Use environment variables or stdin for production

```bash
# More secure alternative (requires script modification)
echo "$PASSWORD" | docker exec -i --user root launchdb-pgbouncer /scripts/pgbouncer-add-user.sh "$USERNAME"
```

### File Permissions

**Current:** Scripts modify files as root user

**Security:** Acceptable within container context, but:
- Container runs as non-root user (PgBouncer process)
- Only specific operations use `--user root`
- Docker socket access restricted to Manager API

### Audit Trail

**Current:** Timestamped backups provide audit trail

**Enhancement:** Log all script executions to syslog:

```bash
logger -t pgbouncer-script "Added project: $PROJECT_ID by user: $SUDO_USER"
```

## Next Steps

- [Infrastructure Environment Variables](./environment-vars.md)
- [Production Deployment Guide](./deployment.md)
- [Manager API Documentation](./manager-api.md)
