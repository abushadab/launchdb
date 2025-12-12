/**
 * Transaction helper with JWT claims
 * Ensures SET LOCAL is properly scoped within a transaction
 * Per v0.2.x bug fix for SET LOCAL outside transaction blocks
 */

import { Pool, PoolClient } from 'pg';

export interface JwtClaims {
  sub?: string;
  role: 'anon' | 'authenticated' | 'service_role';
  [key: string]: unknown;
}

/**
 * Execute a callback within a transaction with JWT claims set.
 * Uses set_config(..., true) which is LOCAL to the transaction.
 *
 * @param pool - PostgreSQL connection pool
 * @param claims - JWT claims to set (or null for service_role bypass)
 * @param fn - Callback receiving the client within the transaction
 */
export async function withJwtClaimsTx<T>(
  pool: Pool,
  claims: JwtClaims | null,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Use set_config with 'true' for transaction-local setting
    const claimsJson = claims ? JSON.stringify(claims) : '{"role":"service_role"}';
    await client.query(
      `SELECT set_config('request.jwt.claims', $1, true)`,
      [claimsJson]
    );

    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
