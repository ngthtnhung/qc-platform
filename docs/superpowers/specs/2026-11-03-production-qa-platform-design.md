# Production QA Platform Replacement Design

## Intent

Replace the current local prototype with a maintainable, containerized internal QA platform based on `system-design-internal-ai-qa-platform (1).md`. The platform supports QC bug triage and reproduction, grounded AI suggestions, test-plan review, approved test execution, evidence tracking, and gated task-system writes. AI remains advisory; authenticated users make approvals and business decisions.

The current workspace is a plain JavaScript prototype without a Git repository or dependency manifest. It has a native HTTP API, static dashboard, JSON persistence, demo user identity, simulated browser execution, and seed credentials. This replacement removes those as production foundations. The existing specification and workflow concepts remain the functional source of truth.

## Goals

- Provide an authenticated web dashboard and versioned API with role-based authorization.
- Persist workflow, plan, case, result, evidence metadata, approval, and audit records in PostgreSQL.
- Run resumable background work through a durable queue and isolated workers.
- Make browser automation real, isolated, observable, and subject to policy checks at execution time.
- Enforce production-test org confirmation, approved test plans, task-write approval, idempotency, and remote-state verification.
- Keep AI, task-system, Figma, object storage, and identity integrations behind replaceable adapters.
- Support a complete local development environment through Docker Compose and configurable deployment elsewhere.

## Non-goals for the first production foundation

- Automatically deploy application changes or migrate customer production data.
- Allow AI to approve plans, confirm orgs, set final severity, or perform privileged task writes.
- Promise a live customer task-system or Figma integration without approved API credentials and contracts.
- Claim safe production use before identity, hosting, secrets, data retention, and environment owners are configured.
- Implement native mobile automation; responsive web coverage is in scope where explicitly configured.

## Constraints and assumptions

- The supplied design's unconfirmed items remain gates: task API/auth, trusted org identity signal, status mapping, P3 SLA choice, test data permissions, Figma access, evidence retention, and project mappings.
- Docker Compose is the default local and portable deployment baseline because no target cloud or internal platform was provided.
- Production identity is OIDC-compatible. Local development may use a clearly marked development identity provider or seeded users; it must not be the production authentication path.
- Secrets are references to a configured secret manager. The platform does not store plaintext passwords or use reversible `ENC_` prefixes.
- External services use mock adapters by default until configured and approved.
- PostgreSQL is the system of record. Redis is used for queue coordination and ephemeral job state, not durable business records.

## Approaches considered

1. **Production-oriented modular monolith (selected recommendation):** React/TypeScript web client, Fastify/TypeScript API, PostgreSQL, Redis-backed BullMQ worker, and a separately containerized Playwright runner. Shared contracts, policy, and adapters live in packages. This keeps operations manageable while isolating browser execution and asynchronous work.
2. **Immediate microservices:** split API, workflow, AI, integrations, and runner into independently deployed services. This offers team-level scaling boundaries but adds deployment, authentication, observability, and transaction complexity before usage and ownership are known.
3. **Keep the zero-dependency prototype and harden it:** lower short-term migration cost, but JSON persistence, simulated browser execution, and weak identity boundaries are unsuitable foundations for the stated internal production use.

The modular monolith is recommended because it replaces the prototype's unsafe foundations while keeping the operational footprint small. Browser workers remain process/container isolated so they can scale separately. This recommendation is the assistant's design call, pending user review.

## Proposed stack and repository layout

- **Runtime/language:** Node.js 22 LTS, TypeScript, pnpm workspaces.
- **Web:** React, Vite, TypeScript, accessible component system, generated API client from OpenAPI.
- **API:** Fastify, JSON Schema validation, OpenAPI, OIDC middleware, RBAC and project/module scoping.
- **Data:** PostgreSQL with versioned SQL migrations and a typed query/ORM layer; object storage adapter for evidence (S3-compatible in deployment, local MinIO in Compose).
- **Jobs:** Redis plus BullMQ; outbox records in PostgreSQL where DB changes must reliably schedule jobs.
- **Automation:** isolated Playwright worker image with per-run browser contexts, explicit domain allowlists, bounded retries/timeouts, and redacted artifacts.
- **Observability:** structured JSON logs, correlation IDs, health/readiness endpoints, metrics, and audit events.
- **Integrations:** interfaces plus mock implementations for AI provider, task system, Figma, and identity. Provider-specific integrations are enabled only by configuration.

```text
apps/
  web/                         React dashboard
services/
  api/                         Fastify HTTP API and auth
  worker/                      workflow queue consumer
  automation-runner/           isolated Playwright job process
packages/
  contracts/                   DTOs, enums, OpenAPI schemas
  policy/                       action/environment/approval policies
  workflow/                     state transitions and orchestration
  database/                     migrations and repositories
  integrations/                 AI, task, Figma, object-store interfaces
  diagnostics/                  redaction, evidence metadata, log filters
infra/
  compose/                      local services and container definitions
  deployment/                   portable deployment examples
docs/
  architecture, security, API, operations, and migration guidance
```

## Core behavior and security boundaries

1. Every request resolves an authenticated actor; no fixed server-side QC identity is accepted for user actions.
2. Authorization checks role, project/module scope, environment, action, approval state, and active session. Denials are audited.
3. Production-test execution is blocked until an authenticated QC confirms the expected org using a configured trusted signal. A button click alone is not proof of actual org identity; until a trusted signal is configured, the session remains blocked or requires explicitly configured manual confirmation policy.
4. A test plan must be QC-approved before a test run can start. Every result is linked to a versioned test case and evidence reference.
5. Task-system writes require an approved draft, configured connector permission, idempotency key, and remote-state verification. Mock mode is default.
6. Production destructive writes, releases, and migrations are denied by policy. Production-test defaults to read-only/reproduction actions unless a separately approved policy allows more.
7. Browser workers accept only validated job payloads, approved plans/procedures, allowlisted URLs, and short-lived secret references. They do not expose browser debugging ports to the public network.
8. Logs, evidence, and AI context pass through redaction and access controls. Retention and deletion are configurable; deployment is blocked until policy owners choose values.
9. External task/document contents are treated as untrusted data, never as instructions to the worker or AI system.

## Main data model

Retain the concepts from the existing 19-table draft, normalized for PostgreSQL and migration-managed:

- Identity and scope: `users`, `roles`/role assignments, `projects`, `modules`, `module_ownerships`.
- Configuration: `environment_profiles`, `account_profiles` (secret references only), connector configuration references.
- Knowledge: `knowledge_sources`, `knowledge_chunks`, source version/status and access scope.
- Orchestration: `workflow_runs`, `workflow_events`, `approvals`, idempotency records, transactional outbox.
- QA records: `external_tasks`, `bug_records`, versioned `bug_procedures`, versioned `test_plans`, `test_cases`, `test_runs`, `test_results`.
- Evidence and governance: `evidence_assets` (object key and checksum, not binary in PostgreSQL), `audit_events`.

All externally supplied identifiers are scoped by connector/project. Use UUID primary keys, UTC timestamps, explicit foreign keys, unique idempotency constraints, and JSONB only for genuinely variable metadata. Database migrations must never perform an unapproved production data migration.

## API and workflow outline

Version the public API under `/api/v1`; validate input and output contracts. Initial resource groups:

- `/auth/session`, `/users/me`, `/projects`, `/modules`
- `/environments`, `/accounts`, `/browser-sessions` and explicit org-confirmation action
- `/knowledge-sources`, `/bug-analyses`, `/bug-procedures`
- `/test-plans`, `/test-plans/{id}/cases`, `/test-plans/{id}/approval`
- `/test-runs`, `/test-runs/{id}/start|pause|resume`, `/test-results`, `/evidence`
- `/integrations/task-system/bug-drafts` and approved submit action
- `/workflow-runs/{id}`, `/audit-events`, `/health`, `/ready`

Workflow transitions are centralized and persisted with actor, time, reason, correlation ID, and checkpoint. Worker retries are bounded and idempotent. Unknown remote write outcomes enter a reconciliation state rather than blindly retrying.

## UI scope

The first dashboard iteration provides authenticated navigation for Overview, Environments & Accounts, Bug Analysis, Knowledge Sources, Test Plans, Test Runs, Evidence, Integrations, and Audit. Review screens show citations, missing inputs, assumptions, conflicts, and approval state. Execution controls show environment, account, org status, policy decision, run checkpoint, and evidence. Destructive or external write actions require a separate review/approval view.

## Migration strategy

1. Establish the new workspace, container baseline, contracts, database migrations, and local OIDC/development-auth boundary.
2. Port the dashboard workflows and API in vertical slices, using mock connectors and safe synthetic data.
3. Add persisted approval and audit workflows, policy enforcement, and organization verification.
4. Add isolated Playwright execution and evidence storage; staging-only by default.
5. Add grounded AI/RAG behind a provider interface with citations and human review.
6. Enable real task/Figma integrations only after Phase 0 discovery questions are answered and credentials are configured.
7. Import existing JSON prototype data only through a reviewed, one-time development migration; never treat seeded demo credentials as production accounts.

## Acceptance criteria

- Local environment starts from documented commands with API, web, PostgreSQL, Redis, and object storage health checks.
- Unauthenticated API access is rejected except explicitly public health/readiness routes.
- Role and project/module scope are enforced on reads, writes, and approvals.
- Production-test automation cannot start without recorded org confirmation and a trusted/configured org check.
- Only approved test-plan versions can start runs; each result is traceable to case, run, actor, and evidence.
- Pausing/resuming a run uses persisted checkpoints and does not repeat completed non-idempotent actions.
- AI-generated analysis and plans include source references, missing information, assumptions, and review state; AI cannot approve or execute privileged writes.
- Task writes are disabled in mock mode by default and, when enabled, require approval, idempotency, audit, and remote-state verification.
- Sensitive values are absent from logs, API error responses, persisted workflow payloads, and evidence metadata.
- A reviewer can trace who requested, approved, executed, and resolved each workflow action from audit records.

## Decisions still required before a real internal deployment

The document leaves these business/operational choices open; the build will expose configuration seams and fail closed:

- Company identity provider and OIDC client/claim mapping.
- Target container host and approved secret manager.
- Trusted org verification signal (application API, stable DOM marker, or another approved source).
- Task-system API, permission scopes, status mapping, and idempotency/remote-query behavior.
- Evidence and diagnostic retention, access, and deletion rules.
- Figma API/export authorization and knowledge-source access rules.
- Project/module identifiers, PIC mapping, SLA details, and permitted test-data mutations.
- Whether any production-test write actions are approved beyond read-only reproduction.

## Assistant implementation calls for review

- Use a modular monolith with isolated asynchronous and browser workers rather than immediate microservices.
- Use Docker Compose as the portable local baseline because no hosting destination was supplied.
- Keep real integrations disabled until their contracts and credentials are supplied; provide mocks for end-to-end development.
- Do not migrate the JSON seed credentials into the new account store.
