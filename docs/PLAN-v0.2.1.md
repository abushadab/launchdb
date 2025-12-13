# v0.2.1 Implementation Plan - Code Quality

**Created:** 14 December 2025
**Updated:** 14 December 2025 (post-Codex review)
**Target:** RLS integration tests (code quality items already implemented)

---

## Overview

Based on Codex's architecture review, most planned items are **already implemented**. Only RLS integration tests remain.

| Task | Priority | Status | Location |
|------|----------|--------|----------|
| SET LOCAL → set_config() | P1 | **DONE** | `libs/common/database/src/with-jwt-claims-tx.ts` |
| Centralized Error Handling | P2 | **DONE** | `libs/common/errors/src/` |
| RLS Integration Tests | P3 | **TODO** | To be created in `testing/rls/` |
| ESLint no-floating-promises | P4 | **DONE** | `.eslintrc.js` |

---

## P1: SET LOCAL → set_config() - ALREADY IMPLEMENTED

**File:** `libs/common/database/src/with-jwt-claims-tx.ts`

The `withJwtClaimsTx()` function already uses the correct `set_config()` pattern:

```typescript
export async function withJwtClaimsTx<T>(
  pool: Pool,
  claims: JwtClaims | null,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimsJson = claims ? JSON.stringify(claims) : '{"role":"service_role"}';
    await client.query(
      `SELECT set_config('request.jwt.claims', $1, true)`,  // <-- Correct pattern!
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
```

**Status:** No action needed.

---

## P2: Centralized Error Handling - ALREADY IMPLEMENTED

**Directory:** `libs/common/errors/src/`

### Files:
- `errors-factory.ts` - ERRORS factory with 18+ error types
- `launchdb-error.ts` - LaunchDBError base class
- `launchdb-error.filter.ts` - NestJS exception filter

### Existing Error Types:
```typescript
export const ERRORS = {
  InvalidCredentials: () => ...,
  InvalidRefreshToken: () => ...,
  RefreshTokenExpired: () => ...,
  UserNotFound: () => ...,
  UserAlreadyExists: () => ...,
  ProjectNotFound: () => ...,
  BucketNotFound: () => ...,
  ObjectNotFound: () => ...,
  RlsViolation: () => ...,
  ValidationError: () => ...,
  Unauthorized: () => ...,
  Forbidden: () => ...,
  InternalError: () => ...,
  // ... and more
};
```

**Status:** No action needed.

---

## P3: RLS Integration Tests - TODO

This is the **only remaining item** for v0.2.1.

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
import { withJwtClaimsTx } from '@launchdb/common/database';

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
          const result = await withJwtClaimsTx(pool, assert.as, async (client) => {
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

### Implementation Steps

1. Create `testing/rls/` directory
2. Implement YAML test spec parser
3. Create test runner using existing `withJwtClaimsTx()`
4. Write initial test specs for storage and auth
5. Add to CI pipeline

---

## P4: ESLint no-floating-promises - ALREADY CONFIGURED

**File:** `.eslintrc.js`

```javascript
rules: {
  '@typescript-eslint/no-floating-promises': 'error',
}
```

Current lint shows 1 error (unused variable), 16 warnings (any types) - no floating promises.

**Status:** No action needed.

---

## Success Criteria for v0.2.1

- [x] `withJwtClaimsTx()` utility using set_config pattern
- [x] ERRORS factory with 18+ error types
- [x] LaunchDBExceptionFilter for NestJS apps
- [x] ESLint no-floating-promises configured
- [ ] **RLS test framework with 10+ test cases**
- [ ] **RLS tests added to CI pipeline**

---

## References

- `/docs/supabase-storage-deep-analysis.md` - Patterns source
- `libs/common/database/src/with-jwt-claims-tx.ts` - Existing RLS context
- `libs/common/errors/src/` - Existing error handling

---

*Plan updated after Codex architecture review*
*Created by Opus (Operations Lead)*
