# Production QA Platform Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prototype with a Docker Compose runnable, authenticated internal QA platform whose workflow, evidence, approvals, and policy decisions are durably persisted and auditable.

**Architecture:** A pnpm TypeScript workspace contains a React dashboard, Fastify API, shared contracts/policy/database packages, a queue worker, and a separate Playwright runner. PostgreSQL stores business and audit state, Redis coordinates jobs, and S3-compatible object storage holds evidence. Identity, AI, Figma, and task connectors use interfaces and mock implementations until explicitly configured.

**Tech Stack:** Node.js 22 LTS, TypeScript, pnpm workspaces, React/Vite, Fastify/OpenAPI, PostgreSQL, Redis/BullMQ, Playwright, S3-compatible storage, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-03-production-qa-platform-design.md`

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

## Review Focus

- Missing/invalid identity, role, or scope must reject protected requests (Task 3).
- A production-test session with absent, mismatched, or stale org confirmation must remain blocked (Task 4).
- Concurrent/retried queue jobs and task writes must not duplicate completed side effects (Tasks 5 and 10).
- Expired/revoked secret references and disallowed browser URLs must stop execution before navigation/action (Task 8).
- Malformed, oversized, or secret-bearing uploads/AI inputs must be rejected or redacted before persistence/logging (Tasks 6 and 9).

---

## Repository map

### Workspace and deployment

- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`: workspace scripts and compiler defaults.
- `apps/web/`: React client, page-level workflow screens, API client, styles.
- `services/api/`: Fastify composition, routes, auth, request validation, readiness.
- `services/worker/`: durable workflow queue consumers and outbox publisher.
- `services/automation-runner/`: isolated Playwright job entrypoint and browser lifecycle.
- `packages/contracts/`: shared API DTOs/enums/OpenAPI schemas.
- `packages/database/`: SQL migrations, connection pool, repositories, transaction helpers.
- `packages/policy/`: environment/action/role/approval policy functions.
- `packages/workflow/`: state transitions, checkpoint and idempotency services.
- `packages/diagnostics/`: redaction and evidence metadata validation.
- `packages/integrations/`: typed ports and mock adapters for AI, tasks, Figma, OIDC claims, and object storage.
- `infra/compose/`: API, web, worker, runner, PostgreSQL, Redis, MinIO and development-only identity configuration.
- `docs/`: API, security, operations, configuration, and migration/runbook docs.

## Task 1: Establish the production workspace and local services

**Files:** Create the workspace/config files above, `infra/compose/compose.yaml`, `.env.example`, `.dockerignore`, per-service Dockerfiles, and `docs/operations/local-development.md`.

**Interfaces:** No application APIs yet. Compose exposes web/API to localhost; PostgreSQL, Redis, and MinIO remain on the private Compose network. Secrets are supplied through ignored local environment files or mounted secret files.

- [ ] Create pnpm workspace definitions for `apps/*`, `services/*`, and `packages/*`, with scripts `dev`, `build`, `typecheck`, `lint`, `db:migrate`, and `compose:up`.
- [ ] Add Node.js 22 LTS base configuration, strict TypeScript defaults, formatting/lint configuration, and `.gitignore` entries for dependencies, build output, local secrets, and browser artifacts.
- [ ] Add health-checked PostgreSQL, Redis, and MinIO services and a development-only identity-provider service in Compose; do not publish database/cache/object-store ports beyond localhost development access.
- [ ] Add minimal container entrypoints and `/health` or equivalent process probes for each future service.
- [ ] Document prerequisites, startup, shutdown, reset of local-only data, and the rule that Compose defaults are not production credentials.
- [ ] Manually verify clean checkout installation, Compose startup, service health, and shutdown. Do not import the existing JSON fixture.

## Task 2: Define shared contracts and PostgreSQL schema

**Files:** Create `packages/contracts/src/{common,environments,workflows,test-plans,test-runs,integrations}.ts`, `packages/database/src/{pool,migrate}.ts`, `packages/database/migrations/*.sql`, and `docs/api/openapi.yaml`.

**Interfaces:** Export typed DTOs and enums from `@qa/contracts`. Migration runner exports `runMigrations(): Promise<void>`. DB package exports transaction-scoped repository constructors; routes do not issue raw SQL.

- [ ] Define UUID IDs, ISO UTC timestamps, correlation IDs, pagination, error envelopes, roles, environment types, workflow states, test statuses, and approval types.
- [ ] Write ordered PostgreSQL migrations for users/role assignments, projects/modules/ownerships, environment/account profiles, knowledge sources/chunks, workflow runs/events, external tasks, bug records/procedures, plans/cases, runs/results, evidence metadata, approvals, audit events, idempotency records, and transactional outbox.
- [ ] Add foreign keys, constraints, indexes, scoped uniqueness, JSONB only for variable metadata, and secret-reference columns that reject secret-looking plaintext patterns at the application boundary.
- [ ] Add migration history locking and transactional migration application; prohibit destructive auto-sync behavior.
- [ ] Define OpenAPI schemas for initial health, identity, environment, account, bug-analysis, test-plan, test-run, approval, evidence, task-draft, and audit resources.
- [ ] Manually apply migrations to a fresh local PostgreSQL instance and inspect the resulting schema/version table.

## Task 3: Implement authentication, authorization, and safe API composition

**Files:** Create `services/api/src/{app,server,plugins/auth,plugins/errors,plugins/request-context}.ts`, `services/api/src/routes/{health,identity}.ts`, `packages/policy/src/{authorize,errors}.ts`, and `packages/database/src/repositories/{users,audit}.ts`.

**Interfaces:** `buildApp(config): Promise<FastifyInstance>`; auth resolver `authenticate(request): Promise<Actor>`; `authorize(actor, { action, projectId?, moduleId? }): Promise<void>`; `recordAudit(tx, event): Promise<void>`.

- [ ] Implement OIDC issuer/audience/signature validation and claim-to-role mapping; development identity bypass is available only with an explicit development-mode flag and is rejected in production mode.
- [ ] Enforce role and project/module scope in shared authorization helpers; client-supplied actor IDs never establish identity.
- [ ] Set restrictive CORS from configured origins, request body limits, secure headers, rate limits on sensitive routes, and structured error responses without stack or secret disclosure.
- [ ] Require correlation IDs and propagate them to API logs, workflow records, and audit events.
- [ ] Make audit writes transactionally coupled to protected state changes; authorization denials are recorded without swallowing audit persistence failures for privileged actions.
- [ ] Manually inspect API behavior for missing/invalid tokens, wrong audience, inactive user, unauthorized role, and out-of-scope project; each protected request must reject.

## Task 4: Add configuration, account/environment management, and policy gates

**Files:** Create `packages/policy/src/{evaluate-action,org-verification}.ts`, repositories for environments/accounts/projects, and `services/api/src/routes/{projects,environments,accounts,browser-sessions}.ts`.

**Interfaces:** `evaluateAction(input): Promise<PolicyDecision>` returns allow/deny with stable code/reason; `verifyOrg(session, observedOrg): Promise<OrgVerification>`; route services accept authenticated actor and transaction.

- [ ] Implement environment action matrix, role checks, session validity, production hard-deny rules, and production-test confirmation requirements.
- [ ] Implement org verification against a configurable trusted signal. If no trusted verifier is configured, production-test stays blocked unless an explicitly configured manual-confirmation mode is enabled and audited.
- [ ] Bind each account to one environment and secret-manager reference; prevent secret material from being returned by API serialization.
- [ ] Add CRUD routes for active projects/modules/environments/accounts with validation, scoped authorization, audit, safe pagination, and secret-reference write-only semantics.
- [ ] Create browser-session records bound to actor/account/environment, with expiration and explicit org-verification fields; confirmation endpoint records evidence of signal and approver.
- [ ] Manually verify staging policy, production-test pre/post confirmation and mismatch cases, production write denial, and that secret values never appear in responses.

## Task 5: Implement durable workflow orchestration and checkpoints

**Files:** Create `packages/workflow/src/{state-machine,service,idempotency,outbox}.ts`, repositories for runs/events/outbox, `services/worker/src/{worker,outbox-publisher}.ts`, and queue configuration.

**Interfaces:** `startWorkflow(input): Promise<WorkflowRun>`; `transitionWorkflow({ runId, expectedVersion, nextState, actor, reason, checkpoint }): Promise<WorkflowRun>`; `enqueueOnce(topic, key, payload): Promise<void>`; workers receive validated versioned payloads.

- [ ] Port the four spec state machines and make transition tables the sole authority for legal state changes.
- [ ] Use optimistic version checks, persisted events/checkpoints, unique idempotency keys, and transactional outbox publication.
- [ ] Configure bounded attempts, exponential backoff, dead-letter/manual-recovery state, cancellation, and resume from last confirmed checkpoint.
- [ ] Make user-triggered transitions re-check authorization and policy inside the transaction that records the transition.
- [ ] Manually inspect retry/resume behavior for duplicate delivery, worker termination between side effect and acknowledgement, invalid transition, and unknown task-system outcome.

## Task 6: Build knowledge ingestion and grounded bug analysis

**Files:** Create `packages/integrations/src/ai/{port,mock-provider}.ts`, `services/worker/src/jobs/{ingest-source,analyze-bug}.ts`, `services/api/src/routes/{knowledge-sources,bug-analyses}.ts`, and `apps/web/src/features/bug-analysis/*`.

**Interfaces:** `AiProvider.analyzeBug(input, retrievedSources): Promise<BugAnalysisSuggestion>`; `KnowledgeService.ingest(source): Promise<SourceVersion>`; `KnowledgeService.retrieve(query, scope): Promise<CitedChunk[]>`.

- [ ] Implement upload/text/manual URL ingestion with size/type/domain checks, versioned source metadata, structural chunking, access scope, and source expiry/outdated state.
- [ ] Use an adapter-backed retrieval implementation; local development uses deterministic lexical retrieval, while embedding/vector providers remain optional configuration.
- [ ] Generate the required bug schema: summary, suspected module, observed/expected behavior, reproduction steps, hypotheses, evidence refs, missing information, environment requirements, risk flags, confidence, and source refs.
- [ ] Mark facts, assumptions, and suggestions separately; report source conflicts and stale sources; do not infer final severity or “not a bug.”
- [ ] Redact submitted input and provider errors before persistence/logging; treat retrieved text and attachments as untrusted data.
- [ ] Build a review screen with source citations, missing fields, editable draft, and save-as-versioned bug procedure action; AI cannot approve.
- [ ] Manually verify unsupported source format, inaccessible URL, oversized upload, stale citation, contradictory sources, prompt-injection text, and missing required bug details.

## Task 7: Implement test-plan generation, editing, and QC approval

**Files:** Create `packages/integrations/src/{figma,task-system}` ports and mocks; `services/worker/src/jobs/generate-test-plan.ts`; API routes under `services/api/src/routes/test-plans`; UI feature `apps/web/src/features/test-plans/*`; shared 16-column template definition.

**Interfaces:** `generatePlan(requirements, sources): Promise<TestPlanDraft>`; `validateCase(testCase): ValidationResult`; `approvePlan(planId, actor, version): Promise<TestPlanVersion>`.

- [ ] Implement Figma URL/node parsing without fetching private content unless a configured adapter is authorized; accept user-provided exports as sources.
- [ ] Generate and validate exactly these columns in order: Link Task, ID, Test Type, Platform, Test objective, Module, Screen, Functional, Steps, Account, Precondition / Test Data, Expected Result, Actual Result, Image / Video, Status, Note.
- [ ] Include requirement refs, assumptions, missing information, conflicts, and draft review status separately from the 16 display columns.
- [ ] Support QC add/edit/delete, version snapshots, approval audit, and immutable approved versions; editing an approved plan creates a new draft version.
- [ ] Include maintenance-priority scenarios from the supplied spec as source-driven coverage, without inventing Figma requirements.
- [ ] Manually inspect empty requirements, malformed Figma URL, source conflict, invalid test status, and attempt to execute an unapproved or superseded version.

## Task 8: Add isolated Playwright execution and evidence collection

**Files:** Create `services/automation-runner/src/{entrypoint,session,execute-step,allowlist}.ts`, runner Dockerfile, worker job handlers, evidence-storage adapter, and API routes `test-runs`/`test-results`/`evidence`.

**Interfaces:** `runApprovedPlan({ runId, approvedPlanVersion, sessionId }): Promise<RunSummary>`; `executeStep(context, step): Promise<StepResult>`; `EvidenceStore.put(stream, metadata): Promise<EvidenceAsset>`.

- [ ] Run one isolated browser context per job with non-root container user, no public debugging endpoint, bounded CPU/time/memory, and cleanup on completion/interruption.
- [ ] Resolve short-lived credentials only at execution time; never return them to the browser client or save them in workflow payloads.
- [ ] Enforce URL/domain allowlist at initial navigation and every redirect/navigation; execute only approved step schemas and permitted actions.
- [ ] Recheck approved plan version, actor-start approval, environment policy, org signal, session expiry, and account binding immediately before run and each sensitive step.
- [ ] Persist each case result and checkpoint; use PASS/FAIL/BLOCKED/INCONCLUSIVE only as supported by observed evidence; do not convert timeouts automatically to FAIL.
- [ ] Capture screenshots/video/log/network metadata only when policy permits; redact before upload, store binary in object storage, and persist checksums/access metadata.
- [ ] Implement pause/resume and interrupted recovery without repeating completed non-idempotent actions.
- [ ] Manually verify blocked URL/redirect, org mismatch, expired session, missing selector, timeout, runner crash, and evidence-store outage.

## Task 9: Add responsive dashboard and audit/reporting views

**Files:** Create `apps/web/src/{app,api,auth,components,features,styles}` and remove/replace the prototype static HTML/CSS/JS once feature parity slices are live.

**Interfaces:** Generated API client from OpenAPI; feature pages consume typed resource hooks and render loading, empty, forbidden, and error states.

- [ ] Implement authenticated app shell and navigation for overview, environment/accounts, bug analysis, knowledge sources, test plans, test runs, evidence, integrations, and audit.
- [ ] Add accessible status, approval, environment, and org-confirmation indicators; show actor-visible policy denial reasons and workflow timeline.
- [ ] Add responsive layouts for desktop and mobile web; retain keyboard navigation, form labels, and clear destructive-action review.
- [ ] Escape user/source content in rendered views and avoid storing bearer tokens in local storage; use secure same-site session cookies/BFF flow where supported by identity deployment.
- [ ] Manually walk the main QC flow from sign-in through analysis, plan review, approval, staging execution, result review, evidence, and audit.

## Task 10: Add gated task-system drafts and integration lifecycle

**Files:** Create `packages/integrations/src/task-system/{port,mock,service}.ts`, `services/worker/src/jobs/{submit-task,verify-task}.ts`, task draft/approval API routes, and `apps/web/src/features/integrations/*`.

**Interfaces:** `TaskSystemAdapter.createOrUpdateBug(input, idempotencyKey): Promise<RemoteTaskResult>`; `getByIdempotencyKey(key): Promise<RemoteTaskResult | null>`; `verifyRemoteState(result): Promise<VerificationResult>`.

- [ ] Create editable bug-ticket drafts from approved failed cases with reproduction, expected/observed behavior, evidence references, module/PIC suggestion, and SLA suggestion.
- [ ] Require an authenticated QC approval bound to exact draft version, connector, and intended operation before queuing a write.
- [ ] Keep mock adapter active by default; real connector requires configured endpoint, scopes, secret reference, project mapping, and feature flag.
- [ ] Submit idempotently; on timeout query remote state before retry; route ambiguous outcomes to manual reconciliation.
- [ ] Audit request, approver, payload digest, connector identity, remote response reference, and verification result with redacted values.
- [ ] Manually verify approval revision mismatch, repeated idempotency key, timeout after remote create, missing permission, and failed remote verification.

## Task 11: Harden operations, documentation, and retire the prototype

**Files:** Create security, API, deployment, backup/restore, and connector setup docs; revise `README.md`, startup scripts, Compose deployment files; remove obsolete JSON database, native HTTP server, static dashboard, and demo seed credential use after replacement launch path is documented.

**Interfaces:** Document operational health/readiness, migration, backup/restore, secret injection, OIDC, retention, worker scaling, and emergency disable switches.

- [ ] Add readiness checks for DB/queue/object storage and dependency-specific degraded states; health endpoint leaks no secrets or internal configuration.
- [ ] Add structured log redaction, configurable evidence retention/deletion jobs, queue visibility, audit export, and global automation/task-write kill switches.
- [ ] Document production deployment parameters as required configuration; fail startup for missing identity, key, allowed origins, secret store, encryption keys, or required org verification when production mode is set.
- [ ] Document phase-0 decisions and leave connectors disabled until they are approved/configured.
- [ ] Confirm no route reads demo credentials, no `ENC_` credential seeds remain, and no production connector can write with default settings.
- [ ] Remove or archive prototype implementation only after the new Compose path starts and the end-to-end QC workflow has been manually reviewed.
- [ ] Review all design acceptance criteria against shipped behavior; list any deferred items explicitly in the README and deployment checklist.

## Execution notes

- The plan intentionally separates a secure local MVP from enabling organization-specific systems. Real OIDC claims, trusted organization proof, task API semantics, Figma authorization, evidence retention, and production host settings remain deployment inputs, not fabricated defaults.
- Verification commands and manual review scripts will be documented during implementation. This plan does not authorize production rollout or external task-system writes.
