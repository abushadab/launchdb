# LaunchDB Roadmap

**Last Updated:** 14 December 2025
**Target:** Supabase-compatible, VPS-first platform

---

## Completed (v0.1.x)

- [x] Platform API (owner authentication, project management)
- [x] Per-project PostgreSQL databases with RLS
- [x] Per-project authentication service (signup/login/refresh)
- [x] PostgREST proxy for database API
- [x] Storage service (disk-based, signed URLs)
- [x] Project provisioning with role separation (anon, authenticated, service_role)
- [x] Docker Compose deployment
- [x] Caddy reverse proxy with automatic HTTPS
- [x] Basic test suite
- [x] **PostgREST config architecture (Option B)** - Manager owns config generation
- [x] Least-privileged DB roles for internal services
- [x] LaunchGuard security scanning

---

## Completed (v0.2.0) - Security Release

**Released:** 14 December 2025
**GitHub:** https://github.com/abushadab/launchdb/releases/tag/v0.2.0

### P3 Docker Socket Security
- [x] **docker-socket-proxy** - Filter Docker API access (CONTAINERS, POST, EXEC, NETWORKS, IMAGES only)
- [x] **dockerode migration** - Replace all shell scripts with Node.js library (13 shell calls eliminated)
- [x] **Non-root user** - postgrest-manager runs as nodeuser (UID 1001)
- [x] **Shell scripts removed** - 6 obsolete scripts deleted
- [x] **docker-cli removed** - No longer installed in container
- [x] **Security review** - LaunchGuard approved (9.5/10, 0 critical/high findings)

### Technical Debt Cleared
- [x] Entrypoint permission fix (Option B architecture)
- [x] Named volume definition cleanup
- [x] JWT environment variables standardization (v0.1.9)

---

## In Progress (v0.2.1)

### Code Quality
- [ ] Fix SET LOCAL transaction bugs (use `set_config()` pattern)
- [ ] Centralized error handling (ERRORS factory pattern)
- [ ] ESLint `no-floating-promises` rule
- [ ] Connection retry logic with `async-retry`

### Testing
- [ ] RLS integration tests (YAML-driven)
- [ ] Comprehensive API test coverage

---

## Near-Term (v0.3.x)

### Code Quality
- [ ] `withRlsContext()` utility for all services
- [ ] `asSuperUser()` pattern across database layer
- [ ] Comprehensive API test coverage
- [ ] Code reviewer agent for CI

### Features
- [ ] Email verification flow
- [ ] Password reset flow
- [ ] Rate limiting per project
- [ ] Usage metrics/analytics

### Operations
- [ ] Health check endpoints for all services
- [ ] Prometheus metrics export
- [ ] Log aggregation setup

---

## Future (v0.4.x+)

### Storage Enhancements
- [ ] **S3 backend support** (AWS S3, MinIO, R2, DigitalOcean Spaces)
  - Configurable via `STORAGE_BACKEND=s3|file`
  - S3-compatible API (optional)
  - Keep disk storage for VPS-first deployments
- [ ] Resumable uploads (TUS protocol)
- [ ] Image transformations (resize, crop, format)
- [ ] CDN integration

### Database
- [ ] Read replicas support
- [ ] Connection pooling improvements (PgBouncer tuning)
- [ ] Database branching (preview environments)
- [ ] Point-in-time recovery

### Auth
- [ ] OAuth providers (Google, GitHub, etc.)
- [ ] Magic link authentication
- [ ] Multi-factor authentication (MFA)
- [ ] SAML/SSO for enterprise

### Platform
- [ ] Multi-tenant dashboard UI
- [ ] CLI tool for project management
- [ ] Webhooks for events
- [ ] Custom domains per project

### Enterprise
- [ ] Multi-region deployment
- [ ] High availability setup guide
- [ ] Kubernetes deployment option
- [ ] Audit logging

---

## Design Principles

1. **VPS-First**: Single server deployment must always work
2. **Supabase-Compatible**: API compatibility where possible
3. **Self-Hosted Friendly**: No hard dependencies on cloud services
4. **Progressive Complexity**: Simple by default, scalable when needed

---

## Non-Goals (For Now)

- Realtime subscriptions (complex, evaluate later)
- Edge functions (requires runtime infrastructure)
- Vector/AI embeddings (specialized use case)
- Managed cloud offering (focus on self-hosted first)

---

## Contributing

Priorities are tracked in this file. For implementation details, see:
- `/docs/supabase-storage-deep-analysis.md` - Patterns to adopt
- `/testing/` - Test scripts

---

*Maintained by LaunchDB Team*
