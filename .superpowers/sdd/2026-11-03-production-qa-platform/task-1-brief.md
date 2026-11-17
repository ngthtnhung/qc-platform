# Task 1 Brief — Establish the production workspace and local services

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
## Task 1: Establish the production workspace and local services

**Files:** Create the workspace/config files above, `infra/compose/compose.yaml`, `.env.example`, `.dockerignore`, per-service Dockerfiles, and `docs/operations/local-development.md`.

**Interfaces:** No application APIs yet. Compose exposes web/API to localhost; PostgreSQL, Redis, and MinIO remain on the private Compose network. Secrets are supplied through ignored local environment files or mounted secret files.

- [ ] Create pnpm workspace definitions for `apps/*`, `services/*`, and `packages/*`, with scripts `dev`, `build`, `typecheck`, `lint`, `db:migrate`, and `compose:up`.
- [ ] Add Node.js 22 LTS base configuration, strict TypeScript defaults, formatting/lint configuration, and `.gitignore` entries for dependencies, build output, local secrets, and browser artifacts.
- [ ] Add health-checked PostgreSQL, Redis, and MinIO services and a development-only identity-provider service in Compose; do not publish database/cache/object-store ports beyond localhost development access.
- [ ] Add minimal container entrypoints and `/health` or equivalent process probes for each future service.
- [ ] Document prerequisites, startup, shutdown, reset of local-only data, and the rule that Compose defaults are not production credentials.
- [ ] Manually verify clean checkout installation, Compose startup, service health, and shutdown. Do not import the existing JSON fixture.



## Execution boundary
Do not add or run tests. Do not commit. Do not alter or remove prototype files. Work only within the workspace.

