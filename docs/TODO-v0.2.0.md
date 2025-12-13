# Technical Debt - v0.2.0

Quick fixes applied in v0.1.x that need proper solutions in v0.2.0.

---

## 1. PostgREST Config File Architecture

**Current (Quick Fix):**
- platform-api writes config files to bind mount
- Spawn script mounts from host path
- Permission issues with non-root container writing to root-owned host directory

**Problem:**
- Named volumes don't work because spawn script runs on HOST
- Bind mounts have permission issues (nodejs UID 1001 vs root)
- Entrypoint chown is a workaround, not a solution

**Long-Term Solution (Codex-approved):**
1. Move config materialization to `postgrest-manager`
   - platform-api sends config data via API call
   - postgrest-manager validates and writes `.conf` file
   - Separation of concerns: manager owns PostgREST lifecycle

2. Use named volume mounted by volume NAME in spawn script:
   ```bash
   # Instead of host path:
   -v /opt/launchdb/infrastructure/postgrest/projects/xxx.conf:/etc/postgrest.conf:ro

   # Use volume name directly:
   -v launchdb-postgrest-projects:/etc/postgrest/projects:ro
   ```

3. Store canonical config in platform DB
   - postgrest-manager reconciles volume on boot
   - Volume is cache, DB is source of truth
   - Enables recovery if volume lost

**Files to modify:**
- `platform/apps/platform-api/src/projects/project-creator.service.ts`
- `infrastructure/postgrest-manager/index.js`
- `infrastructure/scripts/postgrest-spawn.sh`

---

## 2. JWT Environment Variables ✅ DONE in v0.1.9

**Status:** ✅ **Completed in v0.1.9**

**What was done:**
- Updated source `docker-compose.yml` to include `JWT_SECRET` env var
- Standardized env var name from `platformJwtSecret` to `JWT_SECRET` across all services
- All platform docs updated to reflect correct variable name

**Files modified:**
- `docker-compose.yml` - Added JWT_SECRET to platform-api, auth-service, storage-service
- All platform documentation updated in docs audit (v0.1.9)

---

## 3. Entrypoint Permission Fix

**Current (Quick Fix):**
- `platform/entrypoint.sh` runs `chown` at container startup
- Container starts as root, fixes permissions, drops to nodejs

**Problem:**
- Running as root (even briefly) is not ideal
- Entrypoint runs on every restart, unnecessary overhead

**Long-Term Solution:**
- install.sh creates directories with correct ownership (UID 1001)
- Or use Codex's architecture where postgrest-manager owns the volume
- Remove entrypoint chown once proper solution in place

**Files to modify:**
- `install.sh` - add directory creation with correct ownership
- `platform/entrypoint.sh` - can be simplified once install.sh fixed
- `platform/Dockerfile` - can remove su-exec once not needed

---

## 4. Named Volume Definition

**Current (Quick Fix):**
- Added `postgrest-projects` named volume but reverted to bind mount due to spawn script incompatibility

**Problem:**
- Named volume is defined but not used
- Inconsistency between source and production configs

**Long-Term Solution:**
- Either remove named volume definition (if using bind mount approach)
- Or implement Codex's solution (spawn script uses volume name)

**Files to modify:**
- `docker-compose.yml` - volumes section

---

## 5. Docker Socket Security (Deferred from v0.1.1)

**Current:**
- postgrest-manager has Docker socket access
- Runs as root
- Documented in `infrastructure/postgrest-manager/SECURITY.md`

**Long-Term Solution:**
- Migrate to Docker HTTP API (remove docker-cli dependency)
- Run as non-root user with Docker group permissions
- Implement principle of least privilege

**Files to modify:**
- `infrastructure/postgrest-manager/index.js`
- `infrastructure/postgrest-manager/Dockerfile`

---

## Priority Order for v0.2.0

| Priority | Item | Effort | Status |
|----------|------|--------|--------|
| ~~P1~~ | ~~JWT env vars in docker-compose.yml~~ | ~~Low~~ | ✅ Done v0.1.9 |
| P1 | PostgREST config architecture (Codex solution) | Medium | Pending |
| P2 | Remove entrypoint chown workaround | Low | Pending |
| P2 | Clean up named volume definition | Low | Pending |
| P3 | Docker socket security | High | Pending |

---

## References

- Leadership chat: 12 Dec 2025 - Codex architecture recommendation
- LaunchGuard findings: LG-001 to LG-012
- CodeRabbit v0.1.1 security review
