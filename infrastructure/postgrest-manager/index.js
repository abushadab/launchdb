const express = require('express');
const crypto = require('crypto');
const fs = require('fs').promises;
const fsSync = require('fs');
const { getProject, getSecret, closePool } = require('./lib/db');
const { decrypt, validateMasterKey } = require('./lib/crypto');
const { buildConfig } = require('./lib/config-builder');
const {
  containerExists,
  isRunning,
  sendSignal,
  removeContainer,
  createPostgrestContainer,
  execInContainer,
  waitForHealthy,
  PGBOUNCER_CONTAINER,
} = require('./lib/docker');

const app = express();
const PORT = process.env.PORT || 9000;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

// Strict validation: proj_ prefix + exactly 16 lowercase hex chars
const PROJECT_ID_REGEX = /^proj_[a-z0-9]{16}$/;

// Config directory (mounted RW from postgrest-projects volume)
const CONFIG_DIR = '/etc/postgrest/projects';

app.use(express.json());

// Validation middleware for projectId
const validateProjectId = (req, res, next) => {
  const projectId = req.body.projectId || req.params.projectId;

  if (!projectId) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'projectId is required'
    });
  }

  if (!PROJECT_ID_REGEX.test(projectId)) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'Invalid projectId format. Expected: proj_xxxxxxxxxxxxxxxx (16 hex chars)'
    });
  }

  next();
};

// Authentication middleware
const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-internal-key'];

  if (!apiKey) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'X-Internal-Key header required'
    });
  }

  // Use timing-safe comparison to prevent timing attacks
  // Convert strings to buffers for crypto.timingSafeEqual
  const apiKeyBuffer = Buffer.from(apiKey);
  const expectedKeyBuffer = Buffer.from(INTERNAL_API_KEY);

  // Timing-safe authentication: always perform same work regardless of length
  // If lengths differ, compare against dummy buffer to prevent length-based timing leaks
  const lengthMatches = apiKeyBuffer.length === expectedKeyBuffer.length;
  const compareBuffer = lengthMatches ? apiKeyBuffer : Buffer.alloc(expectedKeyBuffer.length);

  // Always perform timing-safe comparison (constant time for content)
  let isValid = false;
  try {
    const contentMatches = crypto.timingSafeEqual(compareBuffer, expectedKeyBuffer);
    // Only valid if BOTH length matches AND content matches
    isValid = lengthMatches && contentMatches;
  } catch (err) {
    // Should not happen with our buffer setup, but handle defensively
    isValid = false;
  }

  if (!isValid) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Invalid API key'
    });
  }

  next();
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'postgrest-manager' });
});

// Spawn PostgREST container for a project
app.post('/internal/postgrest/spawn', authenticate, validateProjectId, async (req, res) => {
  const { projectId } = req.body;

  try {
    // 1. Fetch project from platform DB
    const project = await getProject(projectId);
    if (!project) {
      return res.status(404).json({
        error: 'project_not_found',
        message: `Project ${projectId} not found`
      });
    }

    if (project.status !== 'active') {
      return res.status(400).json({
        error: 'project_not_active',
        message: `Project status is ${project.status}, expected active`
      });
    }

    // 2. Fetch and decrypt secrets
    const [jwtSecretEnc, dbPasswordEnc] = await Promise.all([
      getSecret(projectId, 'jwt_secret'),
      getSecret(projectId, 'db_password'),
    ]);

    if (!jwtSecretEnc) {
      return res.status(500).json({
        error: 'secret_not_found',
        message: 'JWT secret not found for project'
      });
    }

    if (!dbPasswordEnc) {
      return res.status(500).json({
        error: 'secret_not_found',
        message: 'Database password not found for project'
      });
    }

    let jwtSecret, dbPassword;
    try {
      jwtSecret = decrypt(jwtSecretEnc);
      dbPassword = decrypt(dbPasswordEnc);
    } catch (err) {
      console.error(`Decryption failed for ${projectId}:`, err.message);
      return res.status(500).json({
        error: 'decryption_failed',
        message: 'Failed to decrypt project secrets'
      });
    }

    // 3. Build config content
    const configContent = buildConfig({
      projectId,
      dbName: project.db_name,
      dbPassword,
      jwtSecret,
      host: 'pgbouncer',
      port: 6432,
    });

    // 4. Calculate config hash for idempotency
    const configHash = crypto.createHash('sha256').update(configContent).digest('hex').slice(0, 16);
    const configPath = `${CONFIG_DIR}/${projectId}.conf`;

    // Check existing config hash
    let existingHash = null;
    let configExists = false;
    try {
      const existing = await fs.readFile(configPath, 'utf8');
      existingHash = crypto.createHash('sha256').update(existing).digest('hex').slice(0, 16);
      configExists = true;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`Error reading config for ${projectId}:`, err.message);
      }
    }

    const configChanged = configHash !== existingHash;

    // 5. Write config if changed
    if (configChanged) {
      await fs.writeFile(configPath, configContent, { mode: 0o600 });
      console.log(`Config written: ${configPath} (hash: ${configHash})`);
    }

    // 6. Check container state
    const containerName = `postgrest-${projectId}`;
    const exists = await containerExists(containerName);

    if (exists) {
      // Check if running
      const running = await isRunning(containerName);

      if (running) {
        if (!configChanged) {
          // Container running, config unchanged - no-op
          return res.status(200).json({
            projectId,
            containerId: `postgrest-${projectId}`,
            containerName: `postgrest-${projectId}`,
            port: 3000,
            status: 'already_running',
            configHash,
          });
        } else {
          // Container running, config changed - reload via SIGHUP
          console.log(`Config changed for running container ${projectId}, sending SIGHUP...`);
          await sendSignal(containerName, 'SIGHUP');
          return res.status(200).json({
            projectId,
            containerId: `postgrest-${projectId}`,
            containerName: `postgrest-${projectId}`,
            port: 3000,
            status: 'reloaded',
            configHash,
          });
        }
      } else {
        // Container stopped - remove and respawn for clean state
        console.log(`Removing stopped container for ${projectId}...`);
        await removeContainer(containerName);
      }
    }

    // 7. Add to PgBouncer using execInContainer
    console.log(`Adding ${projectId} database to PgBouncer...`);
    try {
      const dbName = project.db_name;
      const poolSize = 5;
      const reservePool = 2;

      const command = `
        (
          flock -x 200
          TMPFILE=$(mktemp)
          awk '/^\\[databases\\]/{print; print "${projectId} = host=postgres port=5432 dbname=${dbName} pool_size=${poolSize} reserve_pool=${reservePool}"; next}1' /etc/pgbouncer/pgbouncer.ini > "$TMPFILE"
          cat "$TMPFILE" > /etc/pgbouncer/pgbouncer.ini
          rm "$TMPFILE"
        ) 200>/etc/pgbouncer/pgbouncer.ini.lock
      `;

      await execInContainer(PGBOUNCER_CONTAINER, command, { user: 'root' });

      // Send SIGHUP to reload config
      await execInContainer(PGBOUNCER_CONTAINER, 'kill -HUP 1', { user: 'root' });

      console.log(`PgBouncer database entry added for ${projectId}`);
    } catch (pgbouncerError) {
      console.error(`PgBouncer database add failed for ${projectId}:`, pgbouncerError);
      return res.status(500).json({
        error: 'pgbouncer_add_failed',
        message: `Failed to add project database to PgBouncer: ${pgbouncerError.message}`
      });
    }

    // 8. Spawn container using dockerode
    console.log(`Spawning PostgREST container for ${projectId}...`);
    const result = await createPostgrestContainer(projectId, {
      domain: process.env.DOMAIN,
    });

    console.log(`Container ${result.containerName} created, waiting for healthy status...`);
    await waitForHealthy(containerName);
    console.log(`Container ${result.containerName} is healthy`);

    res.status(201).json({
      projectId,
      containerId: result.containerId,
      containerName: result.containerName,
      port: 3000,
      status: 'running',
      configHash,
    });
  } catch (error) {
    console.error(`Spawn error for ${projectId}:`, error);
    res.status(500).json({
      error: 'spawn_failed',
      message: error.message
    });
  }
});

// Destroy PostgREST container for a project
app.delete('/internal/postgrest/:projectId', authenticate, validateProjectId, async (req, res) => {
  const { projectId } = req.params;

  try {
    let containerStopped = false;
    const containerName = `postgrest-${projectId}`;

    // Check if container exists and stop it if it does
    const exists = await containerExists(containerName);

    if (exists) {
      // Stop and remove container using dockerode
      try {
        await stopContainer(containerName);
        await removeContainer(containerName);
        console.log(`Container ${containerName} stopped and removed`);
        containerStopped = true;
      } catch (stopError) {
        console.error(`Container stop failed (non-fatal): ${stopError.message}`);
      }
    } else {
      console.log(`Container not found for ${projectId}, skipping container stop`);
    }

    // ALWAYS remove project database from PgBouncer (cleanup)
    // This must run even if container doesn't exist, because PgBouncer entries
    // were added during project creation (before container spawn could fail)
    console.log(`Removing ${projectId} database from PgBouncer...`);
    try {
      const command = `
        (
          flock -x 200
          sed -i "/^${projectId} = /d" /etc/pgbouncer/pgbouncer.ini
        ) 200>/etc/pgbouncer/pgbouncer.ini.lock
      `;
      await execInContainer(PGBOUNCER_CONTAINER, command, { user: 'root' });

      // Send SIGHUP to reload config
      await execInContainer(PGBOUNCER_CONTAINER, 'kill -HUP 1', { user: 'root' });

      console.log(`PgBouncer database entry removed for ${projectId}`);
    } catch (pgbouncerError) {
      // Don't fail the destroy if PgBouncer removal fails
      console.error(`PgBouncer database removal failed (non-fatal): ${pgbouncerError.message}`);
    }

    // ALWAYS remove authenticator user from PgBouncer userlist (cleanup)
    const authenticatorUser = `${projectId}_authenticator`;
    console.log(`Removing ${authenticatorUser} from PgBouncer userlist...`);
    try {
      const userCommand = `
        (
          flock -x 200
          sed -i "/^\\"${authenticatorUser}\\" /d" /etc/pgbouncer/userlist.txt
        ) 200>/etc/pgbouncer/userlist.txt.lock
      `;
      await execInContainer(PGBOUNCER_CONTAINER, userCommand, { user: 'root' });

      // Send SIGHUP to reload user list
      await execInContainer(PGBOUNCER_CONTAINER, 'kill -HUP 1', { user: 'root' });

      console.log(`PgBouncer user ${authenticatorUser} removed`);
    } catch (userError) {
      // Don't fail the destroy if user removal fails
      console.error(`PgBouncer user removal failed (non-fatal): ${userError.message}`);
    }

    res.status(200).json({
      projectId,
      status: containerStopped ? 'stopped' : 'cleaned_up',
      message: containerStopped ? 'Container stopped and PgBouncer cleaned' : 'PgBouncer cleaned (container not found)'
    });
  } catch (error) {
    console.error(`Destroy error for ${projectId}:`, error);
    res.status(500).json({
      error: 'destroy_failed',
      message: error.message
    });
  }
});

// Restart/reload PostgREST container for a project (sends SIGHUP)
app.post('/internal/postgrest/:projectId/restart', authenticate, validateProjectId, async (req, res) => {
  const { projectId } = req.params;

  try {
    const containerName = `postgrest-${projectId}`;

    // Check if container is running
    const running = await isRunning(containerName);

    if (!running) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Container not running'
      });
    }

    // Reload config using SIGHUP signal
    await sendSignal(containerName, 'SIGHUP');
    console.log(`SIGHUP sent to ${containerName}`);

    res.status(200).json({
      projectId,
      status: 'reloaded',
      message: 'PostgREST configuration reloaded via SIGHUP'
    });
  } catch (error) {
    console.error(`Reload error for ${projectId}:`, error);
    res.status(500).json({
      error: 'reload_failed',
      message: error.message
    });
  }
});

// List running PostgREST containers
app.get('/internal/postgrest', authenticate, async (req, res) => {
  try {
    const containers = await listPostgrestContainers();
    res.json({ containers });
  } catch (error) {
    console.error('List error:', error);
    res.status(500).json({
      error: 'list_failed',
      message: error.message
    });
  }
});

// Validate required configuration before starting server
const missingEnv = [];
if (!INTERNAL_API_KEY) missingEnv.push('INTERNAL_API_KEY');
if (!process.env.PLATFORM_DB_DSN) missingEnv.push('PLATFORM_DB_DSN');
if (!process.env.LAUNCHDB_MASTER_KEY) missingEnv.push('LAUNCHDB_MASTER_KEY');

if (missingEnv.length > 0) {
  console.error('ERROR: Missing required environment variables:');
  missingEnv.forEach(v => console.error(`  - ${v}`));
  console.error('');
  console.error('PostgREST Manager cannot start without these configuration values.');
  process.exit(1);
}

// Validate master key format at boot (fail fast)
try {
  validateMasterKey();
} catch (err) {
  console.error(`ERROR: Invalid LAUNCHDB_MASTER_KEY: ${err.message}`);
  process.exit(1);
}

// Ensure config directory exists
try {
  fsSync.mkdirSync(CONFIG_DIR, { recursive: true });
} catch (err) {
  console.error(`ERROR: Cannot create config directory ${CONFIG_DIR}: ${err.message}`);
  process.exit(1);
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database pool...');
  await closePool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing database pool...');
  await closePool();
  process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PostgREST Manager listening on port ${PORT}`);
  console.log(`Internal API Key: [SET]`);
});
