/**
 * PostgREST config file builder
 * MUST match platform-api buildConfigFile() exactly
 *
 * Reference: platform/apps/platform-api/src/postgrest/postgrest.service.ts:96-128
 */

/**
 * Build PostgREST config file content
 * @param {Object} params
 * @param {string} params.projectId - Project ID
 * @param {string} params.dbName - Database name
 * @param {string} params.dbPassword - Decrypted database password
 * @param {string} params.jwtSecret - Decrypted JWT secret
 * @param {string} params.host - Database host (default: pgbouncer)
 * @param {number} params.port - Database port (default: 6432)
 * @returns {string} Config file content
 */
function buildConfig({ projectId, dbName, dbPassword, jwtSecret, host = 'pgbouncer', port = 6432 }) {
  // URL-encode password to handle special characters (+/=) from base64
  const encodedPassword = encodeURIComponent(dbPassword);

  // Escape quotes in JWT secret to prevent config corruption
  const escapedJwtSecret = jwtSecret.replace(/"/g, '\\"');

  // Authenticator role follows naming convention
  const authenticatorRole = `${projectId}_authenticator`;

  // MUST match platform-api output exactly
  return `# PostgREST config for ${projectId}
db-uri = "postgres://${authenticatorRole}:${encodedPassword}@${host}:${port}/${dbName}"
db-schemas = "public,storage"
db-anon-role = "anon"
db-pool = 10
db-pool-timeout = 10

# Disable prepared statements for PgBouncer transaction pooling compatibility
# PgBouncer in transaction mode reuses connections across transactions
# Prepared statements would persist and cause "already exists" errors (42P05)
db-prepared-statements = false

jwt-secret = "${escapedJwtSecret}"
jwt-aud = "authenticated"

max-rows = 1000
db-tx-end = "commit"
`;
}

module.exports = { buildConfig };
