/**
 * RLS Integration Test Runner
 * YAML-driven Row Level Security policy testing framework
 *
 * Usage:
 *   npm run test:rls
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Pool, PoolClient } from 'pg';
import { withJwtClaimsTx, JwtClaims } from '@launchdb/common/database';

// ============================================================
// Test Data UUIDs (shared between seed and tests)
// ============================================================

export const TEST_UUIDS = {
  USER1: '00000000-0000-0000-0000-000000000001',
  USER2: '00000000-0000-0000-0000-000000000002',
};

// ============================================================
// Types
// ============================================================

interface AssertSpec {
  action: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  as: JwtClaims | { role: string };
  from?: string;
  into?: string;
  table?: string;
  where?: string;
  values?: Record<string, any>;
  set?: Record<string, any>;
  expect: 'rows' | 'empty' | 'success' | 'error';
  rows_count?: number;
  rows_affected?: number;
  error_pattern?: string;
  comment?: string;
}

interface TestCase {
  description: string;
  asserts: AssertSpec[];
}

interface RlsTestSpec {
  tests: TestCase[];
}

// ============================================================
// Seed Data Management
// ============================================================

/**
 * Seeds test data into the database.
 * Uses service_role (null claims) to bypass RLS.
 */
export async function seedTestData(pool: Pool): Promise<void> {
  // Use null claims to get service_role access (bypasses RLS)
  await withJwtClaimsTx(pool, null, async (client: PoolClient) => {
    // Seed auth.users
    await client.query(`
      INSERT INTO auth.users (id, email, password_hash)
      VALUES
        ('${TEST_UUIDS.USER1}', 'user1@example.com', 'test-hash-not-real'),
        ('${TEST_UUIDS.USER2}', 'user2@example.com', 'test-hash-not-real')
      ON CONFLICT (id) DO NOTHING
    `);

    // Seed storage.buckets
    await client.query(`
      INSERT INTO storage.buckets (name, public, owner_id)
      VALUES
        ('public-bucket',  true,  '${TEST_UUIDS.USER1}'),
        ('private-bucket', false, '${TEST_UUIDS.USER1}')
      ON CONFLICT (name) DO NOTHING
    `);

    // Seed storage.objects
    await client.query(`
      INSERT INTO storage.objects (bucket, path, owner_id, size, content_type)
      VALUES
        ('public-bucket',  'pub/user1.txt',  '${TEST_UUIDS.USER1}', 123, 'text/plain'),
        ('private-bucket', 'priv/user1.txt', '${TEST_UUIDS.USER1}', 456, 'text/plain'),
        ('private-bucket', 'priv/user2.txt', '${TEST_UUIDS.USER2}', 789, 'text/plain')
      ON CONFLICT (bucket, path) DO NOTHING
    `);
  });
}

/**
 * Cleans up test data from the database.
 * Uses service_role (null claims) to bypass RLS.
 * Can be skipped with KEEP_RLS_DB=1 env var for debugging.
 */
export async function cleanupTestData(pool: Pool): Promise<void> {
  if (process.env.KEEP_RLS_DB === '1') {
    console.log('KEEP_RLS_DB=1: Skipping test data cleanup');
    return;
  }

  // Use null claims to get service_role access (bypasses RLS)
  await withJwtClaimsTx(pool, null, async (client: PoolClient) => {
    // Delete in correct order (foreign key constraints)
    await client.query(`
      DELETE FROM storage.objects
      WHERE owner_id IN ('${TEST_UUIDS.USER1}', '${TEST_UUIDS.USER2}')
    `);

    await client.query(`
      DELETE FROM storage.buckets
      WHERE owner_id IN ('${TEST_UUIDS.USER1}', '${TEST_UUIDS.USER2}')
    `);

    await client.query(`
      DELETE FROM auth.refresh_tokens
      WHERE user_id IN ('${TEST_UUIDS.USER1}', '${TEST_UUIDS.USER2}')
    `);

    await client.query(`
      DELETE FROM auth.sessions
      WHERE user_id IN ('${TEST_UUIDS.USER1}', '${TEST_UUIDS.USER2}')
    `);

    await client.query(`
      DELETE FROM auth.users
      WHERE id IN ('${TEST_UUIDS.USER1}', '${TEST_UUIDS.USER2}')
    `);
  });
}

// ============================================================
// Query Execution
// ============================================================

async function executeAssert(client: PoolClient, assert: AssertSpec): Promise<any> {
  let sql: string;
  const params: any[] = [];

  switch (assert.action) {
    case 'SELECT':
      sql = `SELECT * FROM ${assert.from}`;
      if (assert.where) {
        sql += ` WHERE ${assert.where}`;
      }
      break;

    case 'INSERT':
      if (!assert.into || !assert.values) {
        throw new Error('INSERT requires "into" and "values" fields');
      }
      const columns = Object.keys(assert.values).join(', ');
      const placeholders = Object.keys(assert.values)
        .map((_, i) => `$${i + 1}`)
        .join(', ');
      const values = Object.values(assert.values).map((v) =>
        v === 'gen_random_uuid()' ? null : v
      );

      sql = `INSERT INTO ${assert.into} (${columns}) VALUES (${placeholders})`;
      // Handle gen_random_uuid() function calls
      sql = sql.replace(/'\$(\d+)'/g, (match, num) => {
        if (assert.values && Object.values(assert.values)[parseInt(num) - 1] === 'gen_random_uuid()') {
          return 'gen_random_uuid()';
        }
        return match;
      });
      params.push(...values.filter((v) => v !== null));
      break;

    case 'UPDATE':
      if (!assert.table || !assert.set) {
        throw new Error('UPDATE requires "table" and "set" fields');
      }
      const setClauses = Object.keys(assert.set)
        .map((key, i) => `${key} = $${i + 1}`)
        .join(', ');
      sql = `UPDATE ${assert.table} SET ${setClauses}`;
      if (assert.where) {
        sql += ` WHERE ${assert.where}`;
      }
      params.push(...Object.values(assert.set));
      break;

    case 'DELETE':
      sql = `DELETE FROM ${assert.from}`;
      if (assert.where) {
        sql += ` WHERE ${assert.where}`;
      }
      break;

    default:
      throw new Error(`Unknown action: ${assert.action}`);
  }

  return await client.query(sql, params.length > 0 ? params : undefined);
}

// ============================================================
// Test Runner
// ============================================================

export async function runRlsTests(specPath: string, pool: Pool): Promise<void> {
  const fileContent = fs.readFileSync(specPath, 'utf8');
  const spec = yaml.load(fileContent) as RlsTestSpec;

  for (const test of spec.tests) {
    describe(test.description, () => {
      for (const assert of test.asserts) {
        const testName = assert.comment || `${assert.action} as ${(assert.as as any).role || 'authenticated'}`;

        it(testName, async () => {
          try {
            const result = await withJwtClaimsTx(pool, assert.as as JwtClaims, async (client) => {
              return await executeAssert(client, assert);
            });

            // Validate expectations
            if (assert.expect === 'rows') {
              expect(result.rowCount).toBeGreaterThan(0);
              if (assert.rows_count !== undefined) {
                expect(result.rowCount).toBe(assert.rows_count);
              }
            } else if (assert.expect === 'empty') {
              expect(result.rowCount).toBe(0);
            } else if (assert.expect === 'success') {
              expect(result).toBeDefined();
              if (assert.rows_affected !== undefined) {
                expect(result.rowCount).toBe(assert.rows_affected);
              }
            } else if (assert.expect === 'error') {
              // Should not reach here - error should have been thrown
              fail(`Expected error but query succeeded: ${JSON.stringify(result)}`);
            }
          } catch (error: any) {
            if (assert.expect === 'error') {
              // Expected error
              expect(error).toBeDefined();
              if (assert.error_pattern) {
                expect(error.message).toMatch(new RegExp(assert.error_pattern, 'i'));
              }
            } else {
              // Unexpected error
              throw error;
            }
          }
        });
      }
    });
  }
}

// ============================================================
// Test Suite Loader
// ============================================================

export function loadTestSuites(directory: string, pool: Pool): void {
  const files = fs.readdirSync(directory).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

  for (const file of files) {
    const filePath = path.join(directory, file);
    const suiteName = path.basename(file, path.extname(file));

    describe(`RLS: ${suiteName}`, () => {
      runRlsTests(filePath, pool);
    });
  }
}
