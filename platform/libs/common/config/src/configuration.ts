/**
 * LaunchDB Configuration
 * Environment variables configuration per nestjs-plan.md Section 0
 */

export default () => ({
  // Database Configuration
  platformDbDsn: process.env.PLATFORM_DB_DSN,
  adminDbDsn: process.env.ADMIN_DB_DSN,
  projectsDbHost: process.env.PROJECTS_DB_HOST || 'pgbouncer',
  projectsDbPort: parseInt(process.env.PROJECTS_DB_PORT || '6432', 10),

  // Secrets & Keys (REQUIRED - no defaults for security)
  masterKey: process.env.LAUNCHDB_MASTER_KEY, // Base64-encoded 32 bytes, REQUIRED
  internalApiKey: process.env.INTERNAL_API_KEY, // REQUIRED for service-to-service auth
  platformJwtSecret: process.env.PLATFORM_JWT_SECRET, // REQUIRED for platform owner tokens

  // PostgREST Configuration
  postgrestConfigDir: process.env.POSTGREST_CONFIG_DIR || '/etc/postgrest/projects',
  postgrestPidFile: process.env.POSTGREST_PID_FILE || '/var/run/postgrest.pid',

  // Storage Configuration
  storageBasePath: process.env.STORAGE_BASE_PATH || '/data',
  baseUrl: process.env.BASE_URL || 'http://localhost:8003',

  // Service Ports (per nestjs-plan.md Section 0)
  platformApiPort: parseInt(process.env.PLATFORM_API_PORT || '8000', 10),
  authServicePort: parseInt(process.env.AUTH_SERVICE_PORT || '8001', 10),
  storageServicePort: parseInt(process.env.STORAGE_SERVICE_PORT || '8003', 10),
  migrationsRunnerPort: parseInt(process.env.MIGRATIONS_RUNNER_PORT || '8002', 10),

  // Service URLs (for connection info response)
  migrationsRunnerUrl: process.env.MIGRATIONS_RUNNER_URL || 'http://migrations-runner:8002',
  postgrestUrl: process.env.POSTGREST_URL || 'http://localhost:3000',
  authServiceUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:8001',
  storageServiceUrl: process.env.STORAGE_SERVICE_URL || 'http://localhost:8003',
  postgrestManagerUrl: process.env.POSTGREST_MANAGER_URL || 'http://postgrest-manager:9000',
});
