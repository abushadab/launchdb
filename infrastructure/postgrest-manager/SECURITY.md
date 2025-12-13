# Security Considerations

## Docker Socket Security

**Current Implementation (v0.2.0+):**
- Uses `docker-socket-proxy` to filter Docker API endpoints
- Only allows: CONTAINERS, POST, EXEC, NETWORKS, IMAGES operations
- All other operations disabled (VOLUMES, SYSTEM, SWARM, etc.)
- postgrest-manager runs as non-root user (UID 1001)
- No direct `/var/run/docker.sock` mount
- Pure dockerode library (no shell scripts)

**Before (v0.1.x):**
- Direct docker.sock mount (full root access)
- Shell script dependencies
- Container breakout = full Docker control

**Risk Reduction:**
- Eliminated: Unrestricted Docker API access
- Eliminated: Shell injection vulnerabilities
- Eliminated: Root privilege escalation via docker commands
- Added: API-level access control (socket-proxy)
- Added: Least-privilege principle (non-root user)

## Authentication

This service requires `X-Internal-Key` authentication for all API endpoints. Ensure:
- Use a strong, randomly generated key (minimum 32 characters)
- Rotate the key periodically
- Store securely in environment variables
- Never commit keys to version control

## Network Security

The postgrest-manager service should:
- Only be accessible from the internal Docker network (`launchdb-internal`)
- Never be exposed to the public internet
- Only communicate with trusted services (platform-api)

## Best Practices

1. **Keep Docker Updated:** Regularly update Docker Engine to patch security vulnerabilities
2. **Monitor Logs:** Review postgrest-manager logs for unusual container creation/deletion activity
3. **Limit Scope:** Only grant access to services that absolutely need to spawn PostgREST containers
4. **Audit Access:** Track all API calls to spawn/destroy endpoints
5. **Container Isolation:** Spawned PostgREST containers run with minimal privileges and isolated networks

## Reporting Security Issues

If you discover a security vulnerability, please report it to:
- GitHub Security Advisory: https://github.com/launchdb/launchdb/security/advisories
- Email: security@launchdb.io (if available)

Do not open public issues for security vulnerabilities.
