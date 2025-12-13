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
// Types
// ============================================================

interface PolicyDef {
  name: string;
  table: string;
  role: string;
  permission: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  policy: string;
}

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
  setup: Array<{ policy: string }>;
  asserts: AssertSpec[];
}

interface RlsTestSpec {
  policies: PolicyDef[];
  tests: TestCase[];
}

// ============================================================
// Policy Management
// ============================================================

async function createPolicy(pool: Pool, policy: PolicyDef): Promise<void> {
  const client = await pool.connect();
  try {
    const policyClause = policy.policy.startsWith('USING')
      ? policy.policy
      : policy.policy.startsWith('WITH CHECK')
      ? policy.policy
      : `USING ${policy.policy}`;

    const sql = `
      CREATE POLICY "${policy.name}"
      ON ${policy.table}
      FOR ${policy.permission}
      TO ${policy.role}
      ${policyClause}
    `;

    await client.query(sql);
  } finally {
    client.release();
  }
}

async function dropPolicy(pool: Pool, policyName: string, tableName: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`DROP POLICY IF EXISTS "${policyName}" ON ${tableName}`);
  } finally {
    client.release();
  }
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
      const policyNames = test.setup.map((s) => s.policy);
      const policies = policyNames.map((name) => {
        const policy = spec.policies.find((p) => p.name === name);
        if (!policy) {
          throw new Error(`Policy "${name}" not found in spec`);
        }
        return policy;
      });

      beforeAll(async () => {
        // Create policies for this test
        for (const policy of policies) {
          await createPolicy(pool, policy);
        }
      });

      afterAll(async () => {
        // Drop policies
        for (const policy of policies) {
          await dropPolicy(pool, policy.name, policy.table);
        }
      });

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

// ============================================================
// Example Usage
// ============================================================

if (require.main === module) {
  // Run tests if executed directly
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.TEST_DB_DSN || 'postgresql://postgres:postgres@localhost:5432/test_db',
  });

  loadTestSuites(__dirname, pool);

  afterAll(async () => {
    await pool.end();
  });
}
