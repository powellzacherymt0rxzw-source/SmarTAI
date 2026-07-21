# Claude Collaboration Handoff

## Current Task

Fix the three failed GitHub Actions jobs for commit
`62b46893481c45493d660dcb6193b1c4ad5097ba` on branch
`codex/normalized-learning-workflow-code-only`.

The user explicitly requested that terminal Claude Code implement the fix.
Do not commit, push, or modify unrelated user-owned untracked files.

## Codex -> Claude

### Evidence and root causes

1. `Backend (SQLite)` never starts the test suite:
   `/opt/hostedtoolcache/Python/3.12.13/x64/bin/python: No module named pytest`.
   The workflow installs `render-requirements.txt`, which does not include
   `pytest`.
2. `Backend (PostgreSQL)` fails at `alembic upgrade head` because PostgreSQL
   rejects integer defaults for boolean columns. The first failure is
   `users.is_active BOOLEAN DEFAULT 1`; the baseline migration also uses
   integer boolean defaults for `provider_configs.enabled` and
   `grade_results.requires_review`.
3. `E2E (Playwright)` starts Uvicorn successfully, but `wait-on` repeatedly
   sends `HEAD /ready`. FastAPI returns `405 Method Not Allowed` because the
   route is GET-only, so the readiness wait times out after 30 seconds.

### Scope

- Fix only the CI dependency declaration, PostgreSQL-compatible migration
  boolean defaults, and E2E readiness probe.
- Add focused regression tests before production/config changes where
  practical. Run each new test and confirm it fails for the intended reason
  before applying the fix.
- Prefer a CI-side explicit GET readiness probe rather than broadening the
  application's endpoint semantics solely for `wait-on`.
- Ensure all boolean defaults in the baseline migration are portable between
  SQLite and PostgreSQL, not only the first failing column.
- Preserve existing behavior and avoid unrelated refactors.
- Do not touch `.agent-collab/`, `AGENT_HANDOFF_CN.md`,
  `PROJECT_STATUS_REPORT_CN.md`, or the root `package-lock.json`.

### Acceptance criteria

- The backend CI environment installs `pytest` before invoking it.
- The PostgreSQL form of the baseline migration emits valid boolean defaults
  for every boolean column while remaining valid on SQLite.
- The E2E readiness check uses HTTP GET and recognizes `/ready` as available.
- Focused regression tests pass.
- `python -m pytest backend/tests -q` passes locally.
- Frontend typecheck/unit/build commands remain passing if affected.
- Record modified files, red/green commands and results, remaining verification
  gaps, and any risks in `Claude -> Codex` below.

## Claude -> Codex

Claude implemented the scoped CI fixes in:

- `.github/workflows/ci.yml`
- `backend/db/migrations/versions/0001_normalized_learning.py`
- `backend/tests/test_migration_roundtrip.py`
- `backend/tests/test_ci_workflow.py`

The terminal session did not return its final summary before it was stopped
after producing no output for several minutes. The changes were independently
reviewed and verified by Codex. No commit or push was performed.

Independent verification:

- `python -m pytest backend/tests/test_migration_roundtrip.py::test_postgresql_upgrade_uses_portable_boolean_defaults backend/tests/test_ci_workflow.py -q`: `3 passed`.
- CI-equivalent SQLite suite: `python -m pytest backend/tests -q`: `200 passed, 4 skipped`.
- Frontend `npm run audit:scope`: passed.
- Frontend `npm run typecheck`: passed.
- Frontend `npm test`: `10 files, 34 tests passed`.
- Frontend `npm run build`: passed.

The red-test output from the interrupted Claude session was not observed, so
that part of the TDD audit remains a process gap; the focused regression tests
and full verification are green.

## Codex Review

The diff matches the diagnosed failures. CI installs `pytest` explicitly in
the two backend jobs that invoke it, the migration uses PostgreSQL boolean
literals for all three boolean columns, and E2E polls `/ready` with explicit
GET requests instead of `wait-on`'s HEAD probe. No unrelated user-owned files
were changed. A live PostgreSQL service and Playwright browser run were not
available locally (Docker is unavailable); the PostgreSQL DDL is covered by
the dialect-rendered regression test and the E2E readiness command is covered
by the workflow regression test.
