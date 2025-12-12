/**
 * Integration tests for withJwtClaimsTx helper
 * Validates that JWT claims are correctly set within transaction scope
 */

import { Pool } from 'pg';
import { withJwtClaimsTx, JwtClaims } from './with-jwt-claims-tx';

describe('withJwtClaimsTx', () => {
  let pool: Pool;

  beforeAll(() => {
    // Mock pool for testing - in real integration tests this would connect to test DB
    pool = {
      connect: jest.fn().mockResolvedValue({
        query: jest.fn(),
        release: jest.fn(),
      }),
    } as any;
  });

  it('should execute callback within transaction with service_role claims when claims is null', async () => {
    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    };

    (pool.connect as jest.Mock).mockResolvedValue(mockClient);

    const callback = jest.fn().mockResolvedValue('test-result');

    const result = await withJwtClaimsTx(pool, null, callback);

    // Verify transaction started
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');

    // Verify service_role claims set when null
    expect(mockClient.query).toHaveBeenCalledWith(
      `SELECT set_config('request.jwt.claims', $1, true)`,
      ['{"role":"service_role"}']
    );

    // Verify callback was called with client
    expect(callback).toHaveBeenCalledWith(mockClient);

    // Verify transaction committed
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');

    // Verify client released
    expect(mockClient.release).toHaveBeenCalled();

    // Verify result returned
    expect(result).toBe('test-result');
  });

  it('should execute callback with custom JWT claims', async () => {
    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    };

    (pool.connect as jest.Mock).mockResolvedValue(mockClient);

    const claims: JwtClaims = {
      sub: 'user-123',
      role: 'authenticated',
      project_id: 'proj_abc',
    };

    const callback = jest.fn().mockResolvedValue('custom-result');

    const result = await withJwtClaimsTx(pool, claims, callback);

    // Verify custom claims set
    expect(mockClient.query).toHaveBeenCalledWith(
      `SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify(claims)]
    );

    expect(result).toBe('custom-result');
  });

  it('should rollback transaction and rethrow error on callback failure', async () => {
    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    };

    (pool.connect as jest.Mock).mockResolvedValue(mockClient);

    const testError = new Error('Callback failed');
    const callback = jest.fn().mockRejectedValue(testError);

    await expect(
      withJwtClaimsTx(pool, null, callback)
    ).rejects.toThrow('Callback failed');

    // Verify BEGIN was called
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');

    // Verify ROLLBACK was called
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');

    // Verify COMMIT was NOT called
    expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');

    // Verify client was still released
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('should release client even if rollback fails', async () => {
    const mockClient = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // set_config
        .mockRejectedValueOnce(new Error('Callback error')) // callback throws
        .mockRejectedValueOnce(new Error('ROLLBACK failed')), // ROLLBACK fails
      release: jest.fn(),
    };

    (pool.connect as jest.Mock).mockResolvedValue(mockClient);

    const callback = jest.fn().mockRejectedValue(new Error('Callback error'));

    await expect(
      withJwtClaimsTx(pool, null, callback)
    ).rejects.toThrow('Callback error');

    // Verify client was released despite rollback failure
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('should use set_config with transaction-local scope (third parameter true)', async () => {
    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn(),
    };

    (pool.connect as jest.Mock).mockResolvedValue(mockClient);

    const callback = jest.fn().mockResolvedValue('result');

    await withJwtClaimsTx(pool, null, callback);

    // Verify set_config uses transaction-local scope (not session-wide)
    const setConfigCall = mockClient.query.mock.calls.find(
      (call: any[]) => call[0].includes('set_config')
    );

    expect(setConfigCall).toBeDefined();
    expect(setConfigCall[0]).toContain('set_config(');
    expect(setConfigCall[0]).toContain(', true)'); // Third parameter ensures transaction-local
  });
});
