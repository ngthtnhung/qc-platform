# Task 1 Fix Round 1 Review Package

No Git metadata exists. This package contains the complete current versions of files touched by the fix, plus verification output in the report.
## .env.example
```text
# Set unique disposable values for this local environment. No credentials are prefilled.
POSTGRES_DB=
POSTGRES_USER=
POSTGRES_PASSWORD=
MINIO_ROOT_USER=
MINIO_ROOT_PASSWORD=
KEYCLOAK_ADMIN=
KEYCLOAK_ADMIN_PASSWORD=

```

## infra/compose/compose.yaml
```text
name: production-qa-platform-local
services:
  web:
    build:
      context: ../..
      dockerfile: apps/web/Dockerfile
    ports: ["127.0.0.1:3000:3000"]
    depends_on:
      api: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 5

  api:
    build:
      context: ../..
      dockerfile: services/api/Dockerfile
    ports: ["127.0.0.1:4000:4000"]
    environment:
      PORT: 4000
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      minio: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 5

  worker:
    build:
      context: ../..
      dockerfile: services/worker/Dockerfile
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 5

  automation-runner:
    build:
      context: ../..
      dockerfile: services/automation-runner/Dockerfile
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:4200/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 5

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:?Set POSTGRES_DB in the ignored local .env file}
      POSTGRES_USER: ${POSTGRES_USER:?Set POSTGRES_USER in the ignored local .env file}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in the ignored local .env file}
    volumes: ["postgres-data:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes: ["redis-data:/data"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio:
    image: minio/minio:RELEASE.2025-02-07T23-21-09Z
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:?Set MINIO_ROOT_USER in the ignored local .env file}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?Set MINIO_ROOT_PASSWORD in the ignored local .env file}
    volumes: ["minio-data:/data"]
    healthcheck:
      test: ["CMD-SHELL", "mc alias set local http://127.0.0.1:9000 \"$${MINIO_ROOT_USER}\" \"$${MINIO_ROOT_PASSWORD}\" >/dev/null 2>&1 && mc ready local"]
      interval: 5s
      timeout: 5s
      retries: 10

  identity:
    image: quay.io/keycloak/keycloak:26.1
    command: ["start-dev", "--http-port", "8080"]
    profiles: ["identity"]
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: ${KEYCLOAK_ADMIN:?Set KEYCLOAK_ADMIN in the ignored local .env file when using the identity profile}
      KC_BOOTSTRAP_ADMIN_PASSWORD: ${KEYCLOAK_ADMIN_PASSWORD:?Set KEYCLOAK_ADMIN_PASSWORD in the ignored local .env file when using the identity profile}
    healthcheck:
      test: ["CMD-SHELL", "bash -c '</dev/tcp/127.0.0.1/8080'"]
      interval: 10s
      timeout: 5s
      retries: 20
    ports: ["127.0.0.1:8080:8080"]

volumes:
  postgres-data:
  redis-data:
  minio-data:

```

## docs/operations/local-development.md
```text
# Local development

This Compose setup is for development only. It contains no credential defaults. No prototype JSON fixture is imported. Real identity and external connectors remain disabled unless separately configured.

## Prerequisites

- Node.js 22 LTS and Corepack with pnpm enabled
- Docker Engine or Docker Desktop with Compose v2

## Start

From the repository root, copy `.env.example` to `.env` and fill each field with unique, disposable local values. Compose fails with a clear error when required values are missing. Keep `.env` private; it is ignored by Git. You may instead provide secrets through mounted secret files when wiring a service that supports file-based secrets. Then run:

```sh
pnpm install
pnpm compose:up
```

The web placeholder is at `http://localhost:3000`; the API health endpoint is `http://localhost:4000/health`. PostgreSQL, Redis, and MinIO have health checks and stay on Compose's private network with no published ports. The development-only Keycloak identity provider is opt-in:

```sh
docker compose -f infra/compose/compose.yaml --profile identity up
```

It is available at `http://localhost:8080` when enabled. Service entrypoints are health-check placeholders; application behavior is added in later implementation tasks.

## Stop and reset local data

Stop containers while preserving local data:

```sh
docker compose -f infra/compose/compose.yaml down
```

Reset local-only database, queue, and object-store data by removing the named Compose volumes:

```sh
docker compose -f infra/compose/compose.yaml down --volumes
```

This permanently deletes local development data. Never point this reset command or this Compose configuration at production resources.

## Secrets and production boundary

Use ignored local `.env` values or mounted secret files for local work. Do not commit credentials, API keys, or reversible encoded secrets. Compose requires credential values and has no built-in credential defaults. Production requires an approved identity provider, host, secret manager, network policy, and environment-specific credentials; this local stack does not establish production readiness.

```

## .superpowers/sdd/2026-11-03-production-qa-platform/task-1-brief.md
```text
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


```

## .superpowers/sdd/2026-11-03-production-qa-platform/task-1-report.md
```text
# Task 1 Implementation Report

## Status

Implemented the workspace and local Compose foundation within Task 1 scope. No legacy application files or fixture data were modified. No tests or commits were run. The initial implementation pass did not attempt dependency installation or Docker validation; the follow-up checks are recorded below.

## Delivered

- Added pnpm workspace/package scripts, Node.js 22 engine configuration, strict TypeScript defaults, ESLint and Prettier configuration, and ignore rules for dependencies, build output, local secrets, and browser artifacts.
- Added service package manifests and minimal process entrypoints for the web, API, worker, and automation runner. Web and API provide `/health`; worker and runner provide internal HTTP `/health` probes.
- Added one Dockerfile per future runtime service.
- Added Compose definitions for web, API, worker, automation runner, PostgreSQL, Redis, MinIO, and an opt-in development-only Keycloak service. Only web/API and opted-in identity publish host ports, bound to loopback. PostgreSQL, Redis, and MinIO remain private to the Compose network. Persistent local data uses named volumes.
- Added `.env.example` placeholders and documented local-only startup, shutdown, data reset, health URLs, and production credential boundaries in `docs/operations/local-development.md`.

## Static check summary

- Parsed all eight JSON files (`package.json`, `tsconfig.base.json`, `.prettierrc.json`, and five package manifests) successfully with PowerShell `ConvertFrom-Json`.
- Confirmed the requested workspace, Compose, docs, environment example, ignore files, lint config, and all four Dockerfiles exist.
- A Git status check was unavailable because this shared workspace has no `.git` directory.
- Compose validation/startup and clean checkout installation were not attempted in the initial pass. Follow-up results below supersede this initial status.

## Concern

The service containers are intentionally minimal health placeholders; application logic, and the real worker/browser runtime are deferred to later tasks.

## Fix round 1

### Changes

- Removed credential values from `.env.example` and removed Compose fallback credentials. PostgreSQL, MinIO, and opt-in Keycloak credentials now use required-variable interpolation with clear messages. The local guide directs developers to fill an ignored `.env` or use mounted secret files where a service supports them.
- Changed the MinIO health check to configure an explicit `mc` alias from the container's configured credentials before calling `mc ready`.
- Corrected the manifest count above: there are five package manifests among the eight JSON files checked.

### Validation and attempted lifecycle

- `docker compose -f infra/compose/compose.yaml config` (without credentials): exited 1 as intended, reporting `required variable MINIO_ROOT_USER is missing a value` with the instruction to set it in the ignored local `.env`.
- Created a temporary ignored `.env` with disposable validation-only values, then ran `docker compose --env-file .env -f infra/compose/compose.yaml config --quiet`: exited 0. The temporary file was removed afterward.
- `docker compose --env-file .env -f infra/compose/compose.yaml up --detach --build --wait`: exited 1 before startup. Docker reported it could not connect to `//./pipe/dockerDesktopLinuxEngine` because the system could not find the file. No image pull or service startup occurred.
- `docker compose --env-file .env -f infra/compose/compose.yaml down`: exited 1 for the same unavailable Docker Desktop Linux engine pipe. Since startup never began, there were no running services to shut down and no service health output to inspect.
- `pnpm install`: unavailable because `pnpm` is not recognized in this environment.
- `corepack pnpm install`: exited 1 while fetching pnpm from `https://registry.npmjs.org/pnpm/latest`; network connection was refused at `127.0.0.1:9` (`ECONNREFUSED`). No installation completed.
- No tests or commits were run. No legacy files were touched.

```

