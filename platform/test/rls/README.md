# RLS Integration Tests

YAML-driven Row Level Security (RLS) policy testing framework for LaunchDB.

## Overview

This framework tests PostgreSQL Row Level Security policies to ensure:
- Users can only access their own data
- Anon users have appropriate limited access
- RLS policies prevent unauthorized data access
- INSERT/UPDATE policies validate ownership correctly

## Test Suites

| File | Tests | Assertions | Coverage |
|------|-------|------------|----------|
| `storage-policies.yaml` | 6 | 13 | storage.objects, storage.buckets |
| `auth-policies.yaml` | 7 | 18 | auth.users, auth.sessions, auth.refresh_tokens |
| **Total** | **13** | **31** | **5 tables** |

## Running Tests

### Prerequisites

1. **Test project database** must exist with schemas applied:
   ```bash
   # Create test project via Platform API or manually
   export TEST_PROJECT_ID=proj_test
   ```

2. **Install dependencies** (if not already installed):
   ```bash
   npm install js-yaml @types/js-yaml
   ```

3. **Set environment variables**:
   ```bash
   export TEST_PROJECT_ID=proj_test
   export TEST_DB_PASSWORD=$(psql -U postgres -d platform -t -c \
     "SELECT encrypted_value FROM platform.secrets \
      WHERE project_id='proj_test' AND secret_type='db_password'")
   export PROJECTS_DB_HOST=localhost
   export PROJECTS_DB_PORT=6432
   ```

### Run All RLS Tests

```bash
npm run test:rls
```

### Run Specific Test Suite

```bash
# Storage tests only
npx jest testing/rls/rls.test.ts -t "storage"

# Auth tests only
npx jest testing/rls/rls.test.ts -t "auth"
```

## YAML Test Spec Format

### Policy Definition

```yaml
policies:
  - name: policy_name          # Unique policy identifier
    table: schema.table        # Target table (auth.users, storage.objects, etc.)
    role: authenticated        # PostgreSQL role (authenticated, anon, service_role)
    permission: SELECT         # Permission (SELECT, INSERT, UPDATE, DELETE)
    policy: "USING (...)"      # RLS policy expression
```

### Test Case

```yaml
tests:
  - description: "Test description"
    setup:
      - policy: policy_name    # Policies to create for this test
    asserts:
      - action: SELECT         # SQL action (SELECT, INSERT, UPDATE, DELETE)
        as: { role: authenticated, sub: user-1 }  # JWT claims
        from: schema.table     # Table name
        where: "condition"     # WHERE clause (optional)
        expect: rows           # Expected result (rows, empty, success, error)
        comment: "..."         # Test description
```

### Assertion Types

#### SELECT

```yaml
- action: SELECT
  as: { role: authenticated, sub: user-1 }
  from: storage.objects
  where: "owner_id = 'user-1'"
  expect: rows                # Expect at least 1 row
  rows_count: 5               # Expect exactly 5 rows (optional)
```

#### INSERT

```yaml
- action: INSERT
  as: { role: authenticated, sub: user-1 }
  into: storage.objects
  values:
    id: gen_random_uuid()
    bucket: test-bucket
    path: /file.txt
    owner_id: user-1
  expect: success             # Expect successful insert
```

#### UPDATE

```yaml
- action: UPDATE
  as: { role: authenticated, sub: user-1 }
  table: storage.objects
  set: { size: 2048 }
  where: "owner_id = 'user-1'"
  expect: success
  rows_affected: 1            # Expect exactly 1 row updated (optional)
```

#### DELETE

```yaml
- action: DELETE
  as: { role: authenticated, sub: user-1 }
  from: storage.objects
  where: "owner_id = 'user-1'"
  expect: success
```

#### Error Expectations

```yaml
- action: INSERT
  as: { role: authenticated, sub: user-1 }
  into: storage.objects
  values: { owner_id: user-2 }  # Try to insert with wrong owner_id
  expect: error
  error_pattern: "row-level security policy"  # Expected error message pattern
```

### Expect Values

| Value | Meaning |
|-------|---------|
| `rows` | Query should return at least 1 row |
| `empty` | Query should return 0 rows (RLS filtered) |
| `success` | Query should succeed (INSERT/UPDATE/DELETE) |
| `error` | Query should fail with error |

## How It Works

1. **Setup Phase** (beforeAll):
   - Creates RLS policies specified in `test.setup`
   - Policies are applied to actual project database tables

2. **Test Execution**:
   - Each assertion runs in a transaction with `withJwtClaimsTx()`
   - JWT claims (`role`, `sub`) are set via `set_config('request.jwt.claims', ...)`
   - RLS policies evaluate based on `auth.uid()` and `auth.role()` functions
   - Query results validated against `expect` criteria

3. **Teardown Phase** (afterAll):
   - Drops all policies created in setup
   - Leaves database in clean state

## Architecture

```
testing/rls/
├── rls-test-runner.ts       # Core test framework
│   ├── loadTestSuites()     # Auto-loads all YAML files
│   ├── runRlsTests()        # Executes single test suite
│   ├── createPolicy()       # CREATE POLICY wrapper
│   ├── dropPolicy()         # DROP POLICY wrapper
│   └── executeAssert()      # Executes SQL with RLS context
├── rls.test.ts              # Jest entry point
├── storage-policies.yaml    # Storage RLS tests
├── auth-policies.yaml       # Auth RLS tests
└── README.md                # This file
```

## Adding New Tests

### 1. Create YAML File

```bash
touch testing/rls/custom-policies.yaml
```

### 2. Define Policies and Tests

```yaml
policies:
  - name: my_policy
    table: public.posts
    role: authenticated
    permission: SELECT
    policy: "USING (user_id = auth.uid())"

tests:
  - description: "Users can only see own posts"
    setup:
      - policy: my_policy
    asserts:
      - action: SELECT
        as: { role: authenticated, sub: user-1 }
        from: public.posts
        where: "user_id = 'user-1'"
        expect: rows
```

### 3. Run Tests

```bash
npm run test:rls
```

Tests are auto-discovered and executed!

## Troubleshooting

### "Failed to connect to test database"

- Ensure TEST_DB_PASSWORD is set correctly
- Verify test project exists in platform database
- Check PgBouncer is running and accessible

### "Policy already exists"

- Previous test run didn't clean up policies
- Manually drop policies:
  ```sql
  DROP POLICY IF EXISTS "policy_name" ON schema.table;
  ```

### "Permission denied for table"

- Ensure authenticated/anon roles have GRANT permissions
- Check migration `003_public_baseline.sql` applied correctly

### "function auth.uid() does not exist"

- Ensure migration `001_auth_schema.sql` applied to test project
- Check test project has auth schema initialized

## Best Practices

1. **Test Isolation**: Each test case creates and drops its own policies
2. **JWT Claims**: Use consistent user IDs (user-1, user-2) across tests
3. **Comments**: Add descriptive comments to explain what each assertion tests
4. **Error Patterns**: Use specific error patterns to validate RLS violations
5. **Setup Order**: List policies in logical order (SELECT before INSERT/UPDATE/DELETE)

## CI Integration

Add to GitHub Actions workflow:

```yaml
- name: Run RLS Integration Tests
  run: |
    export TEST_PROJECT_ID=proj_ci_test
    export TEST_DB_PASSWORD=${{ secrets.TEST_DB_PASSWORD }}
    npm run test:rls
```

## References

- [PostgreSQL RLS Documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [Supabase RLS Guide](https://supabase.com/docs/guides/auth/row-level-security)
- `libs/common/database/src/with-jwt-claims-tx.ts` - RLS context utility
- `libs/sql/project_migrations/001_auth_schema.sql` - auth.uid() helper
- `docs/PLAN-v0.2.1.md` - Implementation plan

<!-- CI workflow test trigger -->
