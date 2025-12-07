# LaunchDB

A self-hosted, VPS-first Backend-as-a-Service platform that provides instant PostgreSQL databases with auto-generated REST APIs via PostgREST.

## Features

- **Instant Database APIs**: Auto-generate RESTful APIs from your PostgreSQL schema using PostgREST
- **Multi-tenant Architecture**: Isolated per-project databases with connection pooling via PgBouncer
- **Built-in Services**: Authentication, file storage, and database migrations out of the box
- **Single-VPS Deployment**: Designed for simple, cost-effective hosting on a single server
- **Production Ready**: TLS termination, backup/restore, health monitoring included

## Quick Start

### One-Command Installation

```bash
curl -fsSL https://launchdb.io/install.sh | sudo bash
```

The installer will:
- Install Docker if needed
- Auto-generate all secrets
- Handle port conflicts (offers alternate ports or Cloudflare Tunnel)
- Configure TLS with Let's Encrypt
- Start all services

**Access LaunchDB:** `https://your-domain.com`

For advanced installation options, manual setup, or port configuration, see the [detailed installation guide](docs/infrastructure/setup.md).

### Prerequisites

- Ubuntu 20.04+ or Debian 11+
- 4-8 GB RAM, 2-4 vCPU minimum
- Domain with DNS pointing to your server (optional with Cloudflare Tunnel)

## Architecture

```
Client Request
      |
      v
+-------------+
|    Caddy    |  TLS termination & routing
+------+------+
       |
   +---+---+
   |       |
   v       v
Platform  PostgREST
  API     Containers
   |         |
   +----+----+
        |
        v
   +---------+
   |PgBouncer|  Connection pooling
   +----+----+
        |
        v
   +---------+
   |PostgreSQL|
   +---------+
```

**Key Components:**

| Component | Description |
|-----------|-------------|
| Platform API | Project management, authentication, routing |
| PostgREST | Per-project auto-generated REST API (~20MB each) |
| PgBouncer | Connection pooling with transaction mode |
| Manager API | PostgREST container lifecycle management |
| Auth Service | Multi-tenant user authentication |
| Storage Service | File uploads with signed URLs |
| Migrations | Per-project schema management |

## Documentation

### Platform Services
- [Platform API](docs/platform/platform-api.md) - REST endpoints for project management
- [Auth Service](docs/platform/auth-service.md) - User authentication and JWT tokens
- [Storage Service](docs/platform/storage-service.md) - File storage and signed URLs
- [Migrations Service](docs/platform/migrations-service.md) - Database schema management
- [Database Schema](docs/platform/database-schema.md) - Complete schema reference
- [Environment Variables](docs/platform/platform-env-vars.md) - NestJS service configuration

### Infrastructure
- [Architecture Overview](docs/architecture.md) - System design and topology
- [Setup Guide](docs/infrastructure/setup.md) - Docker and deployment setup
- [Manager API](docs/infrastructure/manager-api.md) - Container orchestration API
- [PgBouncer Scripts](docs/infrastructure/pgbouncer-scripts.md) - Connection pool management
- [Environment Variables](docs/infrastructure/environment-vars.md) - Infrastructure configuration
- [Deployment Guide](docs/infrastructure/deployment.md) - Production deployment steps

## Project Structure

```
launchdb/
├── docker-compose.yml       # Service orchestration
├── .env.example             # Environment template
├── platform/                # Platform services (NestJS)
│   ├── apps/
│   │   ├── platform-api/    # Main API service
│   │   ├── auth-service/    # Authentication service
│   │   ├── storage-service/ # File storage service
│   │   └── migrations-runner/ # Migration runner
│   └── libs/                # Shared libraries
├── infrastructure/          # Infrastructure & Docker
│   ├── pgbouncer/           # Connection pooling config
│   ├── postgrest/           # PostgREST templates
│   ├── postgrest-manager/   # Container management API
│   ├── scripts/             # Management scripts
│   ├── caddy/               # Reverse proxy config
│   └── backup/              # Backup scripts
├── docs/                    # Documentation
│   ├── architecture.md      # System architecture
│   ├── platform/            # Platform service docs
│   └── infrastructure/      # Infrastructure docs
├── LICENSE                  # MIT License
└── README.md                # This file
```

## Environment Variables

Key variables (see `.env.example` for complete list):

| Variable | Description |
|----------|-------------|
| `POSTGRES_SUPERUSER_PASSWORD` | PostgreSQL admin password |
| `LAUNCHDB_MASTER_KEY` | Encryption master key (32 bytes, base64) |
| `PLATFORM_JWT_SECRET` | JWT signing secret |
| `DOMAIN` | Your domain (e.g., api.example.com) |
| `ACME_EMAIL` | Let's Encrypt email |
| `HOST_SCRIPT_DIR` | Absolute path to scripts directory |
| `HOST_CONFIG_DIR` | Absolute path to PostgREST configs |

## API Usage

### Create a Project

```bash
curl -X POST https://your-domain.com/api/projects \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project"}'
```

### Query Project Database

```bash
curl https://your-domain.com/db/proj_xxx/users \
  -H "Authorization: Bearer $PROJECT_JWT"
```

### Upload a File

```bash
curl -X POST https://your-domain.com/storage/proj_xxx/avatars/photo.jpg \
  -H "Authorization: Bearer $PROJECT_JWT" \
  -F "file=@photo.jpg"
```

## Scaling

| Projects | RAM | vCPU | Disk |
|----------|-----|------|------|
| 1-3 | 8 GB | 4 | 50 GB |
| 4-10 | 16 GB | 6 | 100 GB |
| 11-25 | 32 GB | 8 | 200 GB |

## Security

- All traffic encrypted via TLS (Caddy + Let's Encrypt)
- Per-project database isolation
- Row-Level Security (RLS) policies
- JWT-based authentication
- Connection pooling prevents credential exposure
- Encrypted backups

## Contributing

Contributions are welcome! Please read the documentation and follow the existing code patterns.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- [GitHub Issues](https://github.com/your-org/launchdb/issues)
- [Documentation](docs/)
