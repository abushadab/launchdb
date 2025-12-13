/**
 * RLS Integration Tests
 * Executes YAML-driven Row Level Security policy tests
 *
 * Run with: npm run test:rls
 *
 * Required environment variables:
 *   TEST_PROJECT_ID - Project ID to test against (default: proj_test)
 *   TEST_DB_PASSWORD - Database password for the project authenticator role
 *   PROJECTS_DB_HOST - Database host (default: localhost)
 *   PROJECTS_DB_PORT - Database port (default: 5432)
 *
 * Optional:
 *   KEEP_RLS_DB=1 - Skip cleanup after tests (for debugging)
 */

import { Pool } from 'pg';
import * as path from 'path';
import { loadTestSuites, seedTestData, cleanupTestData } from './rls-test-runner';

const testProjectId = process.env.TEST_PROJECT_ID || 'proj_test';
const testDbPassword = process.env.TEST_DB_PASSWORD;
const projectsDbHost = process.env.PROJECTS_DB_HOST || 'localhost';
const projectsDbPort = parseInt(process.env.PROJECTS_DB_PORT || '5432', 10);

// Create pool at module level so it's available during test registration
// Pool is only created if credentials are provided
const pool: Pool | null = testDbPassword
  ? new Pool({
      host: projectsDbHost,
      port: projectsDbPort,
      database: testProjectId,
      user: `${testProjectId}_authenticator`,
      password: testDbPassword,
      max: 5,
    })
  : null;

// Skip all tests if credentials not provided
const describeOrSkip = testDbPassword ? describe : describe.skip;

describeOrSkip('Row Level Security (RLS) Integration Tests', () => {
  beforeAll(async () => {
    if (!pool) {
      throw new Error('Pool not initialized - TEST_DB_PASSWORD not set');
    }
    // Test connection
    try {
      await pool.query('SELECT 1');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to connect to test database: ${message}`);
    }

    // Seed test data before running tests
    await seedTestData(pool);
  });

  afterAll(async () => {
    if (pool) {
      // Cleanup test data (skipped if KEEP_RLS_DB=1)
      await cleanupTestData(pool);
      await pool.end();
    }
  });

  // Load and run all YAML test suites
  // Pool must exist at registration time (not just at beforeAll time)
  if (pool) {
    loadTestSuites(path.join(__dirname), pool);
  }
});

// Show skip message if credentials missing
if (!testDbPassword) {
  describe('Row Level Security (RLS) Integration Tests', () => {
    it('SKIPPED - TEST_DB_PASSWORD not set', () => {
      console.log(
        '\n  RLS tests skipped: TEST_DB_PASSWORD environment variable not set.\n' +
          'To run RLS tests, set up a test project and export credentials:\n' +
          '  export TEST_PROJECT_ID=proj_xxx\n' +
          '  export TEST_DB_PASSWORD=<project_db_password>\n'
      );
      expect(true).toBe(true);
    });
  });
}
