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
 *   PROJECTS_DB_PORT - Database port (default: 6432 for PgBouncer)
 */

import { Pool } from 'pg';
import * as path from 'path';
import { loadTestSuites } from './rls-test-runner';

const testProjectId = process.env.TEST_PROJECT_ID || 'proj_test';
const testDbPassword = process.env.TEST_DB_PASSWORD;
const projectsDbHost = process.env.PROJECTS_DB_HOST || 'localhost';
const projectsDbPort = parseInt(process.env.PROJECTS_DB_PORT || '6432', 10);

// Skip all tests if credentials not provided
const describeOrSkip = testDbPassword ? describe : describe.skip;

describeOrSkip('Row Level Security (RLS) Integration Tests', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      host: projectsDbHost,
      port: projectsDbPort,
      database: testProjectId,
      user: `${testProjectId}_authenticator`,
      password: testDbPassword,
      max: 5,
    });

    // Test connection
    try {
      await pool.query('SELECT 1');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to connect to test database: ${message}`);
    }
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  // Load and run all YAML test suites
  loadTestSuites(path.join(__dirname), pool);
});

// Show skip message if credentials missing
if (!testDbPassword) {
  describe('Row Level Security (RLS) Integration Tests', () => {
    it('SKIPPED - TEST_DB_PASSWORD not set', () => {
      console.log(
        '\n⚠️  RLS tests skipped: TEST_DB_PASSWORD environment variable not set.\n' +
          'To run RLS tests, set up a test project and export credentials:\n' +
          '  export TEST_PROJECT_ID=proj_xxx\n' +
          '  export TEST_DB_PASSWORD=<project_db_password>\n'
      );
      expect(true).toBe(true);
    });
  });
}
