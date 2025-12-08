# Caddy Reverse Proxy Configuration

## Overview
This Caddyfile configures Caddy as a reverse proxy for LaunchDB services with:
- Automatic HTTPS via Let's Encrypt
- Security headers
- Request ID tracing
- Health checks
- JSON structured logging

## Rate Limiting

The Caddyfile includes **target rate limits** in comments for each service. Rate limiting can be implemented in two ways:

### Option 1: Application-Level Rate Limiting (Recommended for v1)
Implement rate limiting middleware in each service (platform-api, auth-service, etc.) using:
- Express rate-limit (Node.js)
- Flask-Limiter (Python)
- Built-in framework middleware

**Pros:**
- More flexible per-endpoint control
- Can integrate with business logic
- No custom Caddy build required

### Option 2: Caddy Rate-Limit Plugin
Build custom Caddy with rate-limit plugin: https://github.com/mholt/caddy-ratelimit

**Build with xcaddy:**
```bash
xcaddy build --with github.com/mholt/caddy-ratelimit
```

**Example usage in Caddyfile:**
```caddyfile
handle /auth/* {
    rate_limit {
        zone auth {
            key {remote_host}
            events 20
            window 1m
        }
    }
    reverse_proxy auth-service:3002
}
```

## Target Rate Limits (per v1-decisions.md)
- Platform API: 100 req/min per IP
- Auth Service: 20 req/min per IP (brute force protection)
- Auth per project: 10 req/min per IP+project_id
- PostgREST: 60 req/min per IP, 30 req/min per IP+project_id
- Storage: 50 req/min per IP, 25 req/min per IP+project_id
- Dashboard: 120 req/min per IP

## Environment Variables
- `DOMAIN`: Your domain (e.g., `api.example.com`)
- `ACME_EMAIL`: Email for Let's Encrypt notifications

## Testing
Test configuration:
```bash
docker compose exec reverse-proxy caddy validate --config /etc/caddy/Caddyfile
```

Reload after changes:
```bash
docker compose exec reverse-proxy caddy reload --config /etc/caddy/Caddyfile
```
