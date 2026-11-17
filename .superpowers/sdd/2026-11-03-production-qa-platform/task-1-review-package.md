# Task 1 Review Package

Only Task 1 files are included. File contents below constitute the scoped diff; the workspace has no Git baseline.

## .dockerignore
```text
.git
.gitignore
node_modules
**/node_modules
**/dist
.env
.env.*
!.env.example
secrets
**/playwright-report
**/test-results
**/browser-artifacts

```

## .env.example
```text
# Local development only. Compose defaults are not production credentials.
POSTGRES_DB=qa_platform
POSTGRES_USER=qa_local
POSTGRES_PASSWORD=replace-for-local-use
MINIO_ROOT_USER=local-minio
MINIO_ROOT_PASSWORD=replace-for-local-use
KEYCLOAK_ADMIN=local-admin
KEYCLOAK_ADMIN_PASSWORD=replace-for-local-use

```

## .gitignore
```text
node_modules/
.pnpm-store/
dist/
coverage/
.env
.env.*
!.env.example
!.env.*.example
secrets/
*.pem
*.key
playwright-report/
test-results/
blob-report/
browser-artifacts/
.DS_Store

```

## .prettierrc.json
```text
{ "singleQuote": true, "semi": true, "trailingComma": "all", "printWidth": 100 }

```

## eslint.config.mjs
```text
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  ignores: ['**/dist/**', '**/node_modules/**', '**/playwright-report/**', '**/test-results/**'],
});

```

## package.json
```text
{
  "name": "production-qa-platform",
  "private": true,
  "packageManager": "pnpm@9.15.4",
  "engines": { "node": ">=22 <23", "pnpm": ">=9" },
  "scripts": {
    "dev": "pnpm --parallel --filter './apps/*' --filter './services/*' dev",
    "build": "pnpm -r --if-present build",
    "typecheck": "pnpm -r --if-present typecheck",
    "lint": "pnpm -r --if-present lint",
    "db:migrate": "pnpm --filter @qa/database db:migrate",
    "compose:up": "docker compose -f infra/compose/compose.yaml up --build"
  },
  "devDependencies": { "prettier": "^3.4.2", "typescript": "^5.7.2", "eslint": "^9.17.0", "@eslint/js": "^9.17.0", "typescript-eslint": "^8.18.0" }
}

```

## pnpm-workspace.yaml
```text
packages:
  - 'apps/*'
  - 'services/*'
  - 'packages/*'

```

## tsconfig.base.json
```text
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "noImplicitOverride": true, "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true, "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true, "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true, "declaration": true, "sourceMap": true,
    "outDir": "dist", "rootDir": "src"
  }
}

```

## apps/web/Dockerfile
```text
FROM node:22-alpine
ENV NODE_ENV=development PORT=3000
WORKDIR /workspace
COPY apps/web/src /app
EXPOSE 3000
CMD ["node", "/app/entrypoint.mjs"]

```

## apps/web/package.json
```text
{ "name": "@qa/web", "private": true, "version": "0.1.0", "scripts": { "dev": "node src/entrypoint.mjs", "build": "node --check src/entrypoint.mjs", "typecheck": "tsc --noEmit --allowJs --checkJs --target ES2022 src/entrypoint.mjs", "lint": "eslint src" } }

```

## apps/web/src/entrypoint.mjs
```text
import { createServer } from 'node:http';
const port = Number(process.env.PORT ?? 3000);
createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"status":"ok"}');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('QA web service placeholder\n');
}).listen(port, '0.0.0.0');

```

## docs/operations/local-development.md
```text
# Local development

This Compose setup is for development only. Its default usernames and passwords are disposable examples and are not production credentials. No prototype JSON fixture is imported. Real identity and external connectors remain disabled unless separately configured.

## Prerequisites

- Node.js 22 LTS and Corepack with pnpm enabled
- Docker Engine or Docker Desktop with Compose v2

## Start

From the repository root, optionally copy `.env.example` to `.env` and replace its local values. Keep `.env` private; it is ignored by Git. Then run:

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

Use ignored local `.env` values or mounted secret files for local work. Do not commit credentials, API keys, or reversible encoded secrets. Compose defaults are development conveniences only. Production requires an approved identity provider, host, secret manager, network policy, and environment-specific credentials; this local stack does not establish production readiness.

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
      POSTGRES_DB: ${POSTGRES_DB:-qa_platform}
      POSTGRES_USER: ${POSTGRES_USER:-qa_local}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-local-only-change-me}
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
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-local-minio}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-local-only-change-me}
    volumes: ["minio-data:/data"]
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 10

  identity:
    image: quay.io/keycloak/keycloak:26.1
    command: ["start-dev", "--http-port", "8080"]
    profiles: ["identity"]
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: ${KEYCLOAK_ADMIN:-local-admin}
      KC_BOOTSTRAP_ADMIN_PASSWORD: ${KEYCLOAK_ADMIN_PASSWORD:-local-only-change-me}
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

## packages/database/package.json
```text
{ "name": "@qa/database", "private": true, "version": "0.1.0", "scripts": { "db:migrate": "node -e \"console.log('Migrations are not implemented yet')\"" } }

```

## services/api/Dockerfile
```text
FROM node:22-alpine
ENV NODE_ENV=development PORT=4000
WORKDIR /workspace
COPY services/api/src /app
EXPOSE 4000
CMD ["node", "/app/entrypoint.mjs"]

```

## services/api/package.json
```text
{ "name": "@qa/api", "private": true, "version": "0.1.0", "scripts": { "dev": "node src/entrypoint.mjs", "build": "node --check src/entrypoint.mjs", "typecheck": "tsc --noEmit --allowJs --checkJs --target ES2022 src/entrypoint.mjs", "lint": "eslint src" } }

```

## services/api/src/entrypoint.mjs
```text
import { createServer } from 'node:http';
const port = Number(process.env.PORT ?? 4000);
createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"status":"ok"}');
    return;
  }
  response.writeHead(501, { 'content-type': 'application/json' });
  response.end('{"error":"not_implemented"}');
}).listen(port, '0.0.0.0');

```

## services/automation-runner/Dockerfile
```text
FROM node:22-alpine
ENV NODE_ENV=development HEALTH_PORT=4200
WORKDIR /app
COPY services/automation-runner/src ./
EXPOSE 4200
CMD ["node", "/app/entrypoint.mjs"]

```

## services/automation-runner/package.json
```text
{ "name": "@qa/automation-runner", "private": true, "version": "0.1.0", "scripts": { "dev": "node src/entrypoint.mjs", "build": "node --check src/entrypoint.mjs", "typecheck": "tsc --noEmit --allowJs --checkJs --target ES2022 src/entrypoint.mjs", "lint": "eslint src" } }

```

## services/automation-runner/src/entrypoint.mjs
```text
import { createServer } from 'node:http';
const port = Number(process.env.HEALTH_PORT ?? 4200);
createServer((request, response) => {
  response.writeHead(request.url === '/health' ? 200 : 404);
  response.end();
}).listen(port, '0.0.0.0');

```

## services/worker/Dockerfile
```text
FROM node:22-alpine
ENV NODE_ENV=development HEALTH_PORT=4100
WORKDIR /app
COPY services/worker/src ./
EXPOSE 4100
CMD ["node", "/app/entrypoint.mjs"]

```

## services/worker/package.json
```text
{ "name": "@qa/worker", "private": true, "version": "0.1.0", "scripts": { "dev": "node src/entrypoint.mjs", "build": "node --check src/entrypoint.mjs", "typecheck": "tsc --noEmit --allowJs --checkJs --target ES2022 src/entrypoint.mjs", "lint": "eslint src" } }

```

## services/worker/src/entrypoint.mjs
```text
import { createServer } from 'node:http';
const port = Number(process.env.HEALTH_PORT ?? 4100);
createServer((request, response) => {
  response.writeHead(request.url === '/health' ? 200 : 404);
  response.end();
}).listen(port, '0.0.0.0');

```

