/**
 * Database access for postgrest-manager
 * Fetches project config and secrets from platform DB
 */

const { Pool } = require('pg');

let pool = null;

/**
 * Get or create connection pool
 * Lazy initialization - pool created on first use
 */
function getPool() {
  if (!pool) {
    const dsn = process.env.PLATFORM_DB_DSN;
    if (!dsn) {
      throw new Error('PLATFORM_DB_DSN environment variable required');
    }

    pool = new Pool({
      connectionString: dsn,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Log connection errors (don't crash)
    pool.on('error', (err) => {
      console.error('Database pool error:', err.message);
    });
  }
  return pool;
}

/**
 * Fetch project by ID
 * @param {string} projectId - Project ID (proj_xxx format)
 * @returns {Promise<{id: string, db_name: string, status: string} | null>}
 */
async function getProject(projectId) {
  const { rows } = await getPool().query(
    'SELECT id, db_name, status FROM platform.projects WHERE id = $1',
    [projectId]
  );
  return rows[0] || null;
}

/**
 * Fetch encrypted secret for project
 * @param {string} projectId - Project ID
 * @param {string} secretType - 'jwt_secret' or 'db_password'
 * @returns {Promise<Buffer | null>} - Encrypted value as Buffer
 */
async function getSecret(projectId, secretType) {
  const { rows } = await getPool().query(
    'SELECT encrypted_value FROM platform.secrets WHERE project_id = $1 AND secret_type = $2 ORDER BY key_version DESC LIMIT 1',
    [projectId, secretType]
  );
  return rows[0]?.encrypted_value || null;
}

/**
 * Close pool (for graceful shutdown)
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  getProject,
  getSecret,
  closePool,
};
