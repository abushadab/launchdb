/**
 * Docker operations wrapper using dockerode
 * Connects to docker-socket-proxy for filtered API access
 */

const Docker = require('dockerode');

// Connect via TCP to socket-proxy (not direct socket mount)
const docker = new Docker({
  host: process.env.DOCKER_HOST?.replace('tcp://', '').split(':')[0] || 'docker-socket-proxy',
  port: parseInt(process.env.DOCKER_HOST?.split(':')[2]) || 2375,
  protocol: 'http',
});

// Constants
const POSTGREST_IMAGE = 'launchdb/postgrest:v1';
const POSTGREST_VOLUME = 'launchdb_postgrest-projects';
const PGBOUNCER_CONTAINER = 'launchdb-pgbouncer';

/**
 * Check if a container exists (running or stopped)
 */
async function containerExists(containerName) {
  try {
    const containers = await docker.listContainers({ all: true });
    return containers.some(c => c.Names.includes(`/${containerName}`));
  } catch (err) {
    console.error(`Error checking container existence: ${err.message}`);
    throw err;
  }
}

/**
 * Check if a container is running
 */
async function isRunning(containerName) {
  try {
    const containers = await docker.listContainers(); // Only running
    return containers.some(c => c.Names.includes(`/${containerName}`));
  } catch (err) {
    console.error(`Error checking container status: ${err.message}`);
    throw err;
  }
}

/**
 * Get container health status
 */
async function getContainerHealth(containerName) {
  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    return info.State?.Health?.Status || 'unknown';
  } catch (err) {
    if (err.statusCode === 404) return 'not_found';
    throw err;
  }
}

/**
 * Detect the Docker network from PgBouncer container
 */
async function detectNetwork() {
  try {
    const container = docker.getContainer(PGBOUNCER_CONTAINER);
    const info = await container.inspect();
    const networks = Object.keys(info.NetworkSettings.Networks);
    if (networks.length === 0) {
      throw new Error('PgBouncer has no networks');
    }
    return networks[0]; // Usually 'launchdb_launchdb-internal'
  } catch (err) {
    console.error(`Error detecting network: ${err.message}`);
    throw err;
  }
}

/**
 * Create and start a PostgREST container
 */
async function createPostgrestContainer(projectId, options = {}) {
  const containerName = `postgrest-${projectId}`;
  const configFile = `/etc/postgrest/projects/${projectId}.conf`;
  const network = options.network || await detectNetwork();

  const createOptions = {
    name: containerName,
    Image: POSTGREST_IMAGE,
    Cmd: [configFile],
    Env: options.domain ? [`DOMAIN=${options.domain}`] : [],
    HostConfig: {
      NetworkMode: network,
      RestartPolicy: { Name: 'unless-stopped' },
      Binds: [`${POSTGREST_VOLUME}:/etc/postgrest/projects:ro`],
    },
    Healthcheck: {
      Test: ['CMD', 'curl', '-f', 'http://localhost:3000/'],
      Interval: 30000000000,  // 30s in nanoseconds
      Timeout: 10000000000,   // 10s
      Retries: 3,
      StartPeriod: 30000000000,
    },
  };

  const container = await docker.createContainer(createOptions);
  await container.start();

  return {
    containerId: container.id,
    containerName,
  };
}

/**
 * Start a stopped container
 */
async function startContainer(containerName) {
  const container = docker.getContainer(containerName);
  await container.start();
}

/**
 * Stop a running container
 */
async function stopContainer(containerName) {
  try {
    const container = docker.getContainer(containerName);
    await container.stop();
  } catch (err) {
    if (err.statusCode === 304) {
      // Container already stopped
      return;
    }
    throw err;
  }
}

/**
 * Remove a container
 */
async function removeContainer(containerName) {
  try {
    const container = docker.getContainer(containerName);
    await container.remove();
  } catch (err) {
    if (err.statusCode === 404) {
      // Container doesn't exist
      return;
    }
    throw err;
  }
}

/**
 * Send a signal to a container (e.g., SIGHUP for config reload)
 */
async function sendSignal(containerName, signal = 'SIGHUP') {
  const container = docker.getContainer(containerName);
  await container.kill({ signal });
}

/**
 * List all PostgREST containers
 */
async function listPostgrestContainers() {
  const containers = await docker.listContainers({
    filters: { name: ['postgrest-'] },
  });

  return containers
    .filter(c => c.Names.some(n => n.startsWith('/postgrest-')))
    .map(c => ({
      projectId: c.Names[0].replace('/postgrest-', ''),
      containerName: c.Names[0].replace('/', ''),
      status: c.State,
      health: c.Status,
    }));
}

/**
 * Execute a command inside a container
 * Used for PgBouncer config updates
 *
 * IMPORTANT: Must check exit code, not just stdout/stderr
 */
async function execInContainer(containerName, command, options = {}) {
  const container = docker.getContainer(containerName);

  const exec = await container.exec({
    Cmd: ['sh', '-c', command],
    AttachStdout: true,
    AttachStderr: true,
    User: options.user || 'root',
  });

  return new Promise((resolve, reject) => {
    exec.start({ hijack: true, stdin: false }, async (err, stream) => {
      if (err) return reject(err);

      let stdout = '';
      let stderr = '';

      // Demux the stream (Docker multiplexes stdout/stderr)
      docker.modem.demuxStream(stream,
        { write: (chunk) => stdout += chunk.toString() },
        { write: (chunk) => stderr += chunk.toString() }
      );

      stream.on('end', async () => {
        // CRITICAL: Check exit code - stderr alone is not sufficient
        const inspectData = await exec.inspect();
        const exitCode = inspectData.ExitCode;

        if (exitCode !== 0) {
          reject(new Error(`Command failed with exit code ${exitCode}: ${stderr || stdout}`));
          return;
        }

        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode });
      });

      stream.on('error', reject);
    });
  });
}

/**
 * Wait for container to become healthy
 */
async function waitForHealthy(containerName, timeoutMs = 90000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const health = await getContainerHealth(containerName);

    if (health === 'healthy') {
      return true;
    }

    if (health === 'unhealthy') {
      throw new Error(`Container ${containerName} is unhealthy`);
    }

    // Wait 2 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  throw new Error(`Container ${containerName} did not become healthy within ${timeoutMs}ms`);
}

module.exports = {
  docker,
  containerExists,
  isRunning,
  getContainerHealth,
  detectNetwork,
  createPostgrestContainer,
  startContainer,
  stopContainer,
  removeContainer,
  sendSignal,
  listPostgrestContainers,
  execInContainer,
  waitForHealthy,
  PGBOUNCER_CONTAINER,
};
