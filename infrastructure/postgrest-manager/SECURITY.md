# Security Considerations

## Docker Socket Access

⚠️ **Security Notice:** This service requires Docker socket access and runs as root.

### Current Architecture (v0.1.9)
- Requires: `/var/run/docker.sock` mounted
- Runs as: `root` user
- Risk: Container escape vector if service is compromised

### Planned Improvements (v0.2.0)
- Migrate to Docker HTTP API (remove docker-cli dependency)
- Run as non-root user with Docker group permissions
- Implement principle of least privilege

### Mitigation for v0.1.9
- Keep postgrest-manager on internal Docker network only
- Do not expose to internet
- Regular security updates
- Monitor container logs for suspicious activity

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
