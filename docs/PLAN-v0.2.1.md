# v0.2.1 Implementation Plan - Code Quality

**Created:** 14 December 2025
**Target:** Code quality improvements, RLS fixes, centralized error handling

---

## Overview

Based on analysis of Supabase Storage patterns (`/docs/supabase-storage-deep-analysis.md`) and LaunchGuard findings.

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| SET LOCAL → set_config() | P1 | Medium | Fix transaction context bugs |
| Centralized Error Handling | P2 | Medium | ERRORS factory pattern |
| RLS Integration Tests | P3 | High | YAML-driven test framework |
| ESLint no-floating-promises | ✅ Done | - | Already configured |

---

## P1: Fix SET LOCAL Transaction Bugs

### Problem

`SET LOCAL` only works inside explicit transactions. If used outside a transaction block, changes are **lost immediately**.

```typescript
// BUG - SET LOCAL outside transaction (current code)
await client.query(`SET LOCAL request.jwt.claims = '${claims}'`);
await client.query('SELECT * FROM data');  // Claims already gone!
```

### Solution: Use `set_config()` with `true` flag

```typescript
// CORRECT - set_config with is_local=true
await client.query('BEGIN');
await client.query(
  `SELECT set_config('request.jwt.claims', $1, true)`,
  [JSON.stringify(claims)]
);
await client.query('SELECT * FROM data');  // Claims available
await client.query('COMMIT');
```

### Implementation

**Create:** `libs/common/database/src/rls-context.ts`

```typescript
import { Pool, PoolClient } from 'pg';

export interface RlsContext {
  role: string;
  sub?: string;
  claims?: Record<string, unknown>;
}

/**
 * Execute function within RLS context using set_config pattern.
 * Ensures JWT claims are available for PostgreSQL RLS policies.
 */
export async function withRlsContext<T>(
  pool: Pool,
  context: RlsContext,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Set RLS context using set_config (is_local = true)
    await client.query(
      `SELECT
        set_config('role', $1, true),
        set_config('request.jwt.claim.role', $1, true),
        set_config('request.jwt.claim.sub', $2, true),
        set_config('request.jwt.claims', $3, true)`,
      [
        context.role,
        context.sub || '',
        JSON.stringify(context.claims || {}),
      ]
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

/**
 * Execute as superuser, bypassing RLS policies.
 */
export async function asSuperUser<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL role = 'postgres'`);  // OK here - inside transaction
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
```

### Files to Update

| File | Change |
|------|--------|
| `libs/common/database/src/rls-context.ts` | NEW - RLS context utilities |
| `libs/common/database/src/index.ts` | Export new utilities |
| `apps/storage-service/src/storage/storage.service.ts` | Use `withRlsContext()` |
| `apps/auth-service/src/auth/auth.service.ts` | Use `asSuperUser()` for session creation |

### Testing

```typescript
// Test that RLS context is properly set
it('should set JWT claims within transaction', async () => {
  const claims = { sub: 'user-123', role: 'authenticated' };

  await withRlsContext(pool, claims, async (client) => {
    const result = await client.query(
      `SELECT current_setting('request.jwt.claims', true) as claims`
    );
    expect(JSON.parse(result.rows[0].claims)).toEqual(claims);
  });
});
```

---

## P2: Centralized Error Handling

### Problem

- Ad-hoc error handling throughout codebase
- Inconsistent HTTP status codes
- PostgreSQL errors not properly mapped
- No standard error response format

### Solution: ERRORS Factory Pattern

**Create:** `libs/common/errors/src/`

```typescript
// error-codes.ts
export enum ErrorCode {
  // Authentication
  InvalidCredentials = 'InvalidCredentials',
  InvalidToken = 'InvalidToken',
  TokenExpired = 'TokenExpired',

  // Authorization
  AccessDenied = 'AccessDenied',
  InsufficientPermissions = 'InsufficientPermissions',

  // Resources
  NotFound = 'NotFound',
  AlreadyExists = 'AlreadyExists',
  Conflict = 'Conflict',

  // Database
  DatabaseError = 'DatabaseError',
  DatabaseTimeout = 'DatabaseTimeout',
  RlsViolation = 'RlsViolation',
  UniqueViolation = 'UniqueViolation',
  ForeignKeyViolation = 'ForeignKeyViolation',

  // Validation
  ValidationError = 'ValidationError',
  InvalidInput = 'InvalidInput',

  // System
  InternalError = 'InternalError',
  ServiceUnavailable = 'ServiceUnavailable',
}

// launchdb-error.ts
export class LaunchDBError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly httpStatus: number,
    message: string,
    public readonly originalError?: Error,
    public readonly metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'LaunchDBError';
  }

  render() {
    return {
      error: this.code,
      message: this.message,
      statusCode: this.httpStatus,
    };
  }

  withMetadata(metadata: Record<string, unknown>) {
    return new LaunchDBError(
      this.code,
      this.httpStatus,
      this.message,
      this.originalError,
      { ...this.metadata, ...metadata },
    );
  }
}

// errors.ts - Factory functions
export const ERRORS = {
  // Authentication
  InvalidCredentials: (message = 'Invalid email or password') =>
    new LaunchDBError(ErrorCode.InvalidCredentials, 401, message),

  InvalidToken: (message = 'Invalid or expired token') =>
    new LaunchDBError(ErrorCode.InvalidToken, 401, message),

  // Authorization
  AccessDenied: (resource?: string, e?: Error) =>
    new LaunchDBError(
      ErrorCode.AccessDenied,
      403,
      resource ? `Access denied to ${resource}` : 'Access denied',
      e,
    ),

  // Resources
  NotFound: (resource: string, id?: string) =>
    new LaunchDBError(
      ErrorCode.NotFound,
      404,
      id ? `${resource} '${id}' not found` : `${resource} not found`,
    ),

  AlreadyExists: (resource: string, id?: string) =>
    new LaunchDBError(
      ErrorCode.AlreadyExists,
      409,
      id ? `${resource} '${id}' already exists` : `${resource} already exists`,
    ),

  // Database
  DatabaseError: (message: string, e?: Error) =>
    new LaunchDBError(ErrorCode.DatabaseError, 500, message, e),

  RlsViolation: (e?: Error) =>
    new LaunchDBError(
      ErrorCode.RlsViolation,
      403,
      'Row-level security policy violation',
      e,
    ),

  // Validation
  ValidationError: (message: string, field?: string) =>
    new LaunchDBError(
      ErrorCode.ValidationError,
      400,
      message,
      undefined,
      field ? { field } : undefined,
    ),

  // System
  InternalError: (e?: Error) =>
    new LaunchDBError(
      ErrorCode.InternalError,
      500,
      'An internal error occurred',
      e,
    ),
};

// pg-error-mapper.ts - Map PostgreSQL errors
export function mapPgError(pgError: { code?: string; message?: string }): LaunchDBError {
  switch (pgError.code) {
    case '42501':  // RLS violation
      return ERRORS.RlsViolation(pgError as Error);

    case '23505':  // Unique constraint
      return ERRORS.AlreadyExists('Resource');

    case '23503':  // Foreign key violation
      return ERRORS.NotFound('Related resource');

    case '57014':  // Query canceled (timeout)
      return new LaunchDBError(
        ErrorCode.DatabaseTimeout,
        504,
        'Database query timed out',
        pgError as Error,
      );

    default:
      return ERRORS.DatabaseError(pgError.message || 'Database error', pgError as Error);
  }
}
```

### NestJS Exception Filter

```typescript
// libs/common/errors/src/launchdb-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { LaunchDBError } from './launchdb-error';

@Catch()
export class LaunchDBExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception instanceof LaunchDBError) {
      return response.status(exception.httpStatus).json(exception.render());
    }

    if (exception instanceof HttpException) {
      return response.status(exception.getStatus()).json({
        error: 'HttpException',
        message: exception.message,
        statusCode: exception.getStatus(),
      });
    }

    // Unknown error
    console.error('Unhandled exception:', exception);
    return response.status(500).json({
      error: 'InternalError',
      message: 'An internal error occurred',
      statusCode: 500,
    });
  }
}
```

### Usage Example

```typescript
// Before (inconsistent)
if (!user) {
  throw new NotFoundException('User not found');
}

// After (standardized)
if (!user) {
  throw ERRORS.NotFound('User', userId);
}

// PostgreSQL error handling
try {
  await client.query('INSERT INTO ...');
} catch (e) {
  throw mapPgError(e);  // Automatically maps to correct error
}
```

---

## P3: RLS Integration Tests

### Problem

- No automated testing of RLS policies
- Manual testing is error-prone
- Policy changes can silently break security

### Solution: YAML-Driven RLS Test Framework

**Create:** `testing/rls/`

```yaml
# testing/rls/storage-policies.yaml
policies:
  - name: objects_owner_select
    table: storage.objects
    role: authenticated
    permission: SELECT
    policy: "USING (owner_id = auth.uid())"

  - name: objects_owner_insert
    table: storage.objects
    role: authenticated
    permission: INSERT
    policy: "WITH CHECK (owner_id = auth.uid())"

tests:
  - description: "Authenticated user can only read own objects"
    setup:
      - policy: objects_owner_select
    asserts:
      - action: SELECT
        as: { role: authenticated, sub: user-1 }
        from: storage.objects
        where: "owner_id = 'user-1'"
        expect: rows  # Should return rows

      - action: SELECT
        as: { role: authenticated, sub: user-1 }
        from: storage.objects
        where: "owner_id = 'user-2'"
        expect: empty  # RLS should filter

  - description: "Authenticated user can insert own objects"
    setup:
      - policy: objects_owner_insert
    asserts:
      - action: INSERT
        as: { role: authenticated, sub: user-1 }
        into: storage.objects
        values: { owner_id: user-1, name: test }
        expect: success

      - action: INSERT
        as: { role: authenticated, sub: user-1 }
        into: storage.objects
        values: { owner_id: user-2, name: test }
        expect: error
        error: "row-level security"
```

### Test Runner

```typescript
// testing/rls/rls-test-runner.ts
import * as yaml from 'js-yaml';
import { Pool } from 'pg';
import { withRlsContext } from '@launchdb/common/database';

interface RlsTestSpec {
  policies: PolicyDef[];
  tests: TestCase[];
}

export async function runRlsTests(specPath: string, pool: Pool) {
  const spec = yaml.load(fs.readFileSync(specPath, 'utf8')) as RlsTestSpec;

  for (const test of spec.tests) {
    describe(test.description, () => {
      beforeAll(async () => {
        // Create policies for this test
        for (const policyName of test.setup.map(s => s.policy)) {
          const policy = spec.policies.find(p => p.name === policyName);
          await createPolicy(pool, policy);
        }
      });

      afterAll(async () => {
        // Drop policies
        for (const policyName of test.setup.map(s => s.policy)) {
          await dropPolicy(pool, policyName);
        }
      });

      for (const assert of test.asserts) {
        it(`${assert.action} as ${assert.as.role}`, async () => {
          const result = await withRlsContext(pool, assert.as, async (client) => {
            return executeAssert(client, assert);
          });

          if (assert.expect === 'rows') {
            expect(result.rowCount).toBeGreaterThan(0);
          } else if (assert.expect === 'empty') {
            expect(result.rowCount).toBe(0);
          } else if (assert.expect === 'success') {
            expect(result).toBeDefined();
          } else if (assert.expect === 'error') {
            // Error should have been thrown
            fail('Expected error but query succeeded');
          }
        });
      }
    });
  }
}
```

---

## P4: ESLint no-floating-promises

**Status:** ✅ Already configured in `.eslintrc.js`

```javascript
rules: {
  '@typescript-eslint/no-floating-promises': 'error',
}
```

Current lint shows 1 error (unused variable), 16 warnings (any types) - no floating promises.

---

## Implementation Order

### Phase 1: RLS Context (3-4 hours)
1. Create `libs/common/database/src/rls-context.ts`
2. Add tests for `withRlsContext()` and `asSuperUser()`
3. Update storage-service to use new pattern
4. Update auth-service session creation

### Phase 2: Error Handling (4-5 hours)
1. Create `libs/common/errors/` module
2. Implement `LaunchDBError`, `ERRORS`, `mapPgError()`
3. Create `LaunchDBExceptionFilter`
4. Migrate services to use new error patterns
5. Update error responses across all endpoints

### Phase 3: RLS Tests (5-6 hours)
1. Create `testing/rls/` directory
2. Implement YAML test spec parser
3. Create test runner with policy creation/cleanup
4. Write initial test specs for storage and auth
5. Add to CI pipeline

### Phase 4: Cleanup (1-2 hours)
1. Fix remaining `any` type warnings
2. Fix unused variable error
3. Run full lint check
4. Update documentation

---

## Success Criteria

- [ ] `withRlsContext()` utility created and tested
- [ ] All storage/auth DB operations use new RLS pattern
- [ ] `ERRORS` factory with 15+ error types
- [ ] `LaunchDBExceptionFilter` applied to all apps
- [ ] PostgreSQL errors mapped to application errors
- [ ] RLS test framework with 10+ test cases
- [ ] ESLint passes with 0 errors
- [ ] All tests pass

---

## References

- `/docs/supabase-storage-deep-analysis.md` - Patterns source
- `/agents/launchguard/guidelines/code-quality.md` - Quality checklist
- `/agents/launchguard/findings/` - Security findings

---

*Plan created by Opus (Operations Lead)*
