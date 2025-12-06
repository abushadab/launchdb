const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 9000;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

// Strict validation regex for projectId to prevent command injection
const PROJECT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

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
      message: 'Invalid projectId format. Only alphanumeric, underscore, and hyphen allowed.'
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

  // Check length first (timingSafeEqual requires same length)
  // Use a timing-safe length check to avoid leaking length information
  let isValid = apiKeyBuffer.length === expectedKeyBuffer.length;

  if (isValid) {
    try {
      isValid = crypto.timingSafeEqual(apiKeyBuffer, expectedKeyBuffer);
    } catch (err) {
      // timingSafeEqual can throw if buffers are different lengths
      // This should not happen due to our length check above, but handle it anyway
      isValid = false;
    }
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
  const { projectId, authenticatorPassword } = req.body;

  try {
    // Check if container already exists
    const { stdout: existsCheck } = await execAsync(
      `docker ps -a --format '{{.Names}}' | grep -q '^postgrest-${projectId}$' && echo 'exists' || echo 'not_exists'`
    );

    if (existsCheck.trim() === 'exists') {
      // Check if it's running
      const { stdout: runningCheck } = await execAsync(
        `docker ps --format '{{.Names}}' | grep -q '^postgrest-${projectId}$' && echo 'running' || echo 'stopped'`
      );

      if (runningCheck.trim() === 'running') {
        return res.status(409).json({
          error: 'container_exists',
          message: 'Container already running'
        });
      }

      // Container exists but stopped - remove it to ensure clean state
      // This ensures PgBouncer registration and fresh spawn happen
      console.log(`Removing stopped container for ${projectId}...`);
      await execAsync(`docker rm postgrest-${projectId}`);
      console.log(`Container removed, will create fresh container with PgBouncer setup`);
      // Fall through to PgBouncer registration and fresh container spawn
    }

    // Add project database to PgBouncer first
    // PostgREST needs PgBouncer entry to connect to the database
    console.log(`Adding ${projectId} database to PgBouncer...`);
    try {
      const { stdout: pgbouncerOut, stderr: pgbouncerErr } = await execAsync(
        `/scripts/pgbouncer-add-project.sh ${projectId}`,
        { cwd: '/app' }
      );
      console.log(`PgBouncer database entry: ${pgbouncerOut}`);
      if (pgbouncerErr) console.error(`PgBouncer stderr: ${pgbouncerErr}`);
    } catch (pgbouncerError) {
      console.error(`PgBouncer database add failed for ${projectId}:`, pgbouncerError);
      return res.status(500).json({
        error: 'pgbouncer_add_failed',
        message: `Failed to add project database to PgBouncer: ${pgbouncerError.message}`
      });
    }

    // Add authenticator user to PgBouncer userlist if password provided
    // This is required for PgBouncer to authenticate the PostgREST connection
    if (authenticatorPassword) {
      const authenticatorUser = `${projectId}_authenticator`;
      console.log(`Adding ${authenticatorUser} to PgBouncer userlist...`);
      try {
        const { stdout: userOut, stderr: userErr } = await execAsync(
          `/scripts/pgbouncer-add-user.sh "${authenticatorUser}" "${authenticatorPassword}"`,
          { cwd: '/app' }
        );
        console.log(`PgBouncer user add: ${userOut}`);
        if (userErr) console.error(`PgBouncer user stderr: ${userErr}`);
      } catch (userError) {
        console.error(`PgBouncer user add failed for ${authenticatorUser}:`, userError);
        return res.status(500).json({
          error: 'pgbouncer_user_add_failed',
          message: `Failed to add authenticator to PgBouncer userlist: ${userError.message}`
        });
      }
    } else {
      console.warn(`No authenticatorPassword provided for ${projectId} - PgBouncer auth may fail`);
    }

    // Spawn new container using spawn script
    const { stdout, stderr } = await execAsync(
      `/scripts/postgrest-spawn.sh ${projectId}`,
      { cwd: '/app' }
    );

    console.log(`Spawn output: ${stdout}`);
    if (stderr) console.error(`Spawn stderr: ${stderr}`);

    res.status(201).json({
      projectId,
      containerId: `postgrest-${projectId}`,
      containerName: `postgrest-${projectId}`,
      port: 3000,
      status: 'running'
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

    // Check if container exists and stop it if it does
    const { stdout: existsCheck } = await execAsync(
      `docker ps -a --format '{{.Names}}' | grep -q '^postgrest-${projectId}$' && echo 'exists' || echo 'not_exists'`
    );

    if (existsCheck.trim() === 'exists') {
      // Stop and remove container using stop script
      try {
        const { stdout, stderr } = await execAsync(
          `/scripts/postgrest-stop.sh ${projectId}`,
          { cwd: '/app' }
        );

        console.log(`Stop output: ${stdout}`);
        if (stderr) console.error(`Stop stderr: ${stderr}`);
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
      const { stdout: pgbouncerOut, stderr: pgbouncerErr } = await execAsync(
        `/scripts/pgbouncer-remove-project.sh ${projectId}`,
        { cwd: '/app' }
      );
      console.log(`PgBouncer database removal: ${pgbouncerOut}`);
      if (pgbouncerErr) console.error(`PgBouncer database stderr: ${pgbouncerErr}`);
    } catch (pgbouncerError) {
      // Don't fail the destroy if PgBouncer removal fails
      console.error(`PgBouncer database removal failed (non-fatal): ${pgbouncerError.message}`);
    }

    // ALWAYS remove authenticator user from PgBouncer userlist (cleanup)
    const authenticatorUser = `${projectId}_authenticator`;
    console.log(`Removing ${authenticatorUser} from PgBouncer userlist...`);
    try {
      const { stdout: userOut, stderr: userErr } = await execAsync(
        `/scripts/pgbouncer-remove-user.sh "${authenticatorUser}"`,
        { cwd: '/app' }
      );
      console.log(`PgBouncer user removal: ${userOut}`);
      if (userErr) console.error(`PgBouncer user stderr: ${userErr}`);
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
    // Check if container is running
    const { stdout: runningCheck } = await execAsync(
      `docker ps --format '{{.Names}}' | grep -q '^postgrest-${projectId}$' && echo 'running' || echo 'not_running'`
    );

    if (runningCheck.trim() === 'not_running') {
      return res.status(404).json({
        error: 'not_found',
        message: 'Container not running'
      });
    }

    // Reload config using SIGHUP signal
    const { stdout, stderr } = await execAsync(
      `/scripts/postgrest-reload.sh ${projectId}`,
      { cwd: '/app' }
    );

    console.log(`Reload output: ${stdout}`);
    if (stderr) console.error(`Reload stderr: ${stderr}`);

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
    const { stdout } = await execAsync(
      `docker ps --filter "name=^postgrest-" --format "{{.Names}}"`
    );

    const containers = stdout
      .trim()
      .split('\n')
      .filter(name => name.startsWith('postgrest-'))
      .map(name => ({
        projectId: name.replace('postgrest-', ''),
        containerName: name,
        port: 3000,
        status: 'running'
      }));

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
if (!INTERNAL_API_KEY) {
  console.error('ERROR: INTERNAL_API_KEY environment variable is required');
  console.error('');
  console.error('PostgREST Manager cannot start without authentication.');
  console.error('Set INTERNAL_API_KEY in docker-compose.yml or .env file:');
  console.error('  INTERNAL_API_KEY=<your-secret-key>');
  console.error('');
  console.error('Generate a secure key with:');
  console.error('  openssl rand -hex 32');
  process.exit(1);
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`PostgREST Manager listening on port ${PORT}`);
  console.log(`Internal API Key: [SET]`);
});
