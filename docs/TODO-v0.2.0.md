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

## 3. Entrypoint Permission Fix ✅ DONE

**Status:** ✅ **Completed - Option B eliminates the issue**

**What was done (v0.2.0):**
- Option B implementation: postgrest-manager owns the `postgrest-projects` volume
- Platform services no longer need to write to shared config directory
- entrypoint.sh simplified to just `su-exec nodejs "$@"` (no runtime chown)
- Dockerfile sets correct ownership at build time via `--chown=nodejs:nodejs`

**Current architecture:**
- postgrest-manager writes configs directly to named volume (RW mount)
- Platform containers use proper non-root user (nodejs UID 1001)
- su-exec retained for privilege drop (minimal overhead)

**Files unchanged (already correct):**
- `platform/entrypoint.sh` - Already simplified
- `platform/Dockerfile` - Uses `--chown` at build time

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

## 5. Docker Socket Security ✅ DONE

**Status:** ✅ **Completed - P3 Docker Socket Security (14 Dec 2025)**

**What was done:**
- Added `docker-socket-proxy` to filter Docker API access
- Migrated all shell scripts to `dockerode` library (13 calls eliminated)
- Removed `docker-cli` from Dockerfile
- Added non-root user (nodeuser UID 1001)
- Updated `SECURITY.md` with v0.2.0 implementation

**Security improvements:**
| Metric | Before | After |
|--------|--------|-------|
| Docker socket | Direct mount | Socket-proxy filtered |
| User | root | nodeuser (UID 1001) |
| Shell scripts | 6 files | 0 files |
| Shell commands | 13 calls | 0 calls |
| docker-cli | Installed | Removed |
| API filtering | None | CONTAINERS, POST, EXEC only |

**Security review:** LaunchGuard approved (9.5/10, 0 critical/high findings)

**Files modified:**
- `docker-compose.yml` - Added socket-proxy service
- `infrastructure/postgrest-manager/lib/docker.js` - NEW dockerode wrapper
- `infrastructure/postgrest-manager/index.js` - All endpoints migrated
- `infrastructure/postgrest-manager/Dockerfile` - Non-root user
- `infrastructure/postgrest-manager/SECURITY.md` - Updated docs

**Release:** v0.2.0 - https://github.com/abushadab/launchdb/releases/tag/v0.2.0

---

## Priority Order for v0.2.0

| Priority | Item | Effort | Status |
|----------|------|--------|--------|
| ~~P1~~ | ~~JWT env vars in docker-compose.yml~~ | ~~Low~~ | ✅ Done v0.1.9 |
| ~~P1~~ | ~~PostgREST config architecture (Option B)~~ | ~~Medium~~ | ✅ Done 13 Dec 2025 |
| ~~P2~~ | ~~Remove entrypoint chown workaround~~ | ~~Low~~ | ✅ Done (Option B) |
| ~~P2~~ | ~~Clean up named volume definition~~ | ~~Low~~ | ✅ Done (Option B) |
| ~~P3~~ | ~~Docker socket security~~ | ~~High~~ | ✅ Done 14 Dec 2025 |

**🎉 All v0.2.0 technical debt items complete!**

---

## References

- Leadership chat: 12 Dec 2025 - Codex architecture recommendation
- LaunchGuard findings: LG-001 to LG-012
- CodeRabbit v0.1.1 security review
