# Technical Debt - v0.2.0

Quick fixes applied in v0.1.x that need proper solutions in v0.2.0.

---

## 1. PostgREST Config File Architecture ✅ DONE

**Status:** ✅ **Completed - Option B implemented**

**What was done (13 Dec 2025):**
- PostgREST Manager now fetches secrets directly from platform DB
- Manager decrypts secrets using LAUNCHDB_MASTER_KEY (AES-256-GCM)
- Manager generates config files with exact parity to old platform-api output
- Platform-API simplified to only send `projectId` in spawn request
- Named volume `postgrest-projects` mounted RW in manager
- Created `postgrest_manager_ro` least-privileged role (SELECT only)
- Removed `authenticatorPassword` from wire (security improvement)

**Commits:**
- `9afc8c1` - feat(manager): Implement Option B - manager owns config generation
- `ae04f3d` - fix(manager): Address Codex security review concerns
- `b0a67bc` - refactor(platform): Remove config generation - manager handles it

**Files modified:**
- `infrastructure/postgrest-manager/index.js` - New spawn flow with DB fetch/decrypt
- `infrastructure/postgrest-manager/lib/db.js` - NEW: Database access
- `infrastructure/postgrest-manager/lib/crypto.js` - NEW: AES-256-GCM decryption
- `infrastructure/postgrest-manager/lib/config-builder.js` - NEW: Config generation
- `infrastructure/postgres/init/04_postgrest_manager_role.sql` - NEW: Least-privileged role
- `platform/apps/platform-api/src/postgrest/postgrest-manager.service.ts` - Simplified
- `platform/apps/platform-api/src/projects/project-creator.service.ts` - Simplified
- `docker-compose.yml` - Manager uses read-only DB role

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

## 4. Named Volume Definition ✅ DONE

**Status:** ✅ **Completed as part of Option B**

**What was done:**
- Named volume `postgrest-projects` now used correctly
- Manager mounts volume RW, writes config files
- Spawn script mounts volume by name (not host path)
- No more permission issues

**Resolved in:** Option B implementation (13 Dec 2025)

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
| ~~P1~~ | ~~PostgREST config architecture (Option B)~~ | ~~Medium~~ | ✅ Done 13 Dec 2025 |
| P2 | Remove entrypoint chown workaround | Low | Pending |
| ~~P2~~ | ~~Clean up named volume definition~~ | ~~Low~~ | ✅ Done (Option B) |
| P3 | Docker socket security | High | Pending |

---

## References

- Leadership chat: 12 Dec 2025 - Codex architecture recommendation
- LaunchGuard findings: LG-001 to LG-012
- CodeRabbit v0.1.1 security review
