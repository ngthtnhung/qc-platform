# Task 2 Brief — Define shared contracts and PostgreSQL schema

## Global Constraints

- AI suggests analysis and plans; authenticated users approve plans, confirm orgs, and approve external writes.
- Production-test automation fails closed until the expected organization is verified using a configured trusted signal.
- Production destructive writes, releases, and migrations are denied by policy.
- Task-system writes require QC approval, idempotency, audit, configured connector permissions, and remote-state verification.
- Secrets are references to a configured secret manager; no plaintext or reversible `ENC_` values are stored.
- Browser automation runs in an isolated worker with domain allowlists and bounded timeouts/retries.
- External task and document contents are untrusted data, never execution instructions.
- Real external integrations remain disabled by default; use mocks until authorized configuration exists.
- Existing seed credentials are never migrated as production credentials.
- No production data migration or write is performed by the platform bootstrap.


## Full task requirements
## Task 2: Define shared contracts and PostgreSQL schema

**Files:** Create `packages/contracts/src/{common,environments,workflows,test-plans,test-runs,integrations}.ts`, `packages/database/src/{pool,migrate}.ts`, `packages/database/migrations/*.sql`, and `docs/api/openapi.yaml`.

**Interfaces:** Export typed DTOs and enums from `@qa/contracts`. Migration runner exports `runMigrations(): Promise<void>`. DB package exports transaction-scoped repository constructors; routes do not issue raw SQL.

- [ ] Define UUID IDs, ISO UTC timestamps, correlation IDs, pagination, error envelopes, roles, environment types, workflow states, test statuses, and approval types.
- [ ] Write ordered PostgreSQL migrations for users/role assignments, projects/modules/ownerships, environment/account profiles, knowledge sources/chunks, workflow runs/events, external tasks, bug records/procedures, plans/cases, runs/results, evidence metadata, approvals, audit events, idempotency records, and transactional outbox.
- [ ] Add foreign keys, constraints, indexes, scoped uniqueness, JSONB only for variable metadata, and secret-reference columns that reject secret-looking plaintext patterns at the application boundary.
- [ ] Add migration history locking and transactional migration application; prohibit destructive auto-sync behavior.
- [ ] Define OpenAPI schemas for initial health, identity, environment, account, bug-analysis, test-plan, test-run, approval, evidence, task-draft, and audit resources.
- [ ] Manually apply migrations to a fresh local PostgreSQL instance and inspect the resulting schema/version table.



## Interfaces already established
Task 1 created a pnpm workspace, Node 22 configuration, Compose PostgreSQL service, and db:migrate script placeholder. Preserve these unless a concrete conflict requires a documented adjustment.

## Execution boundary
Do not add or run tests. Do not commit. Do not run Docker or pull images. Keep Task 2 files limited to shared contracts, database foundation/migrations, and OpenAPI as specified. Write a complete report to .superpowers/sdd/2026-11-03-production-qa-platform/task-2-report.md and do not dispatch subagents.

