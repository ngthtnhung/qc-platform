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

It is available at `http://localhost:8080` when enabled. Set both `KEYCLOAK_ADMIN` and `KEYCLOAK_ADMIN_PASSWORD` in the ignored `.env` before using the identity profile; default Compose configuration does not require those optional values. Service entrypoints are health-check placeholders; application behavior is added in later implementation tasks.

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
