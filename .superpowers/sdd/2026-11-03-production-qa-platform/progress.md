# SDD ledger — plan: docs/superpowers/plans/2026-11-03-production-qa-platform.md

Workspace: `C:\Users\ngthtnhung\.gemini\antigravity\scratch\qa-platform` (isolated scratch directory; no Git metadata). Review evidence will use file snapshots/review packages instead of commit ranges. Automated tests are not authorized by the applicable developer instruction; implementation agents must not add or run tests. Use static inspection, typecheck/build commands only if they do not execute test suites.

## Setup

- Plan: `docs/superpowers/plans/2026-11-03-production-qa-platform.md`
- Spec: `docs/superpowers/specs/2026-11-03-production-qa-platform-design.md`
- Baseline: no Git repository; current files retained as the prototype baseline.
- Worktree: project is already in a dedicated scratch workspace; no linked worktree possible without a repository.
- Decision: proceed in this isolated directory, use scoped task briefs/reports and reviewer file snapshots, and do not initialize Git or commit user files as part of implementation.

## Pre-flight conflict scan

| Task(s) | Shared file/interface | Producer vs consumer | Finding / ruling |
|---|---|---|---|
| 1 | `apps/web`, `services/api`, worker and runner entrypoints | Task 1 creates minimal Compose entrypoints; later tasks fill service internals | No conflict if Task 1 uses explicit placeholders and does not create parallel application implementations. |
| 2, 3 | DB pool/migration and user/audit repositories | Task 2 provides DB foundation; Task 3 adds user/audit repositories | No conflict; schema/repositories have distinct files. |
| 2, 4 | Environment/account/project repositories | Task 2 defines schema and base repository constructors; Task 4 implements domain repositories | No conflict; Task 4 consumes Task 2 migration contract. |
| 2, 5 | Workflow/outbox tables and workflow service | Task 2 creates tables; Task 5 implements services and repository operations | No conflict; Task 5 consumes Task 2 DB abstractions. |
| 2, 6, 7, 8, 10 | Contracts/OpenAPI | Task 2 defines shared DTOs; later tasks add feature schemas/routes | No conflict if route DTOs remain aligned with central contracts. |
| 3, 4, 5, 6, 7, 8, 10 | Authorization and audit interfaces | Task 3 provides auth/policy and audit; feature tasks consume them | No conflict; all privileged transitions must use the shared interfaces. |
| 5, 6, 7, 8, 10 | Worker jobs and outbox | Task 5 establishes queue and worker; feature tasks add job handlers | No conflict; each feature owns its job file, not worker bootstrap. |
| 6, 7 | `packages/integrations/src/figma` and AI | Tasks own separate integration folders; share source/citation contracts | No conflict. |
| 7, 10 | `packages/integrations/src/task-system` | Task 7 currently lists task-system ports/mocks; Task 10 owns task-system port/mock/service | Conflict found. Ruling: Task 7 owns only Figma adapter and test-plan integration points; Task 10 exclusively owns task-system adapter files. The design and spec require adapter separation; this avoids duplicate ownership. |
| 8, 9 | API/UI run resources | Task 8 defines test-run/result/evidence routes; Task 9 builds screens against OpenAPI | No conflict; Task 9 consumes Task 8 contracts/routes. |
| 9, 11 | Prototype static UI and startup/docs | Task 9 replaces dashboard after new routes; Task 11 retires remaining prototype | No conflict if removal in Task 11 occurs only after Compose flow is reviewed, as specified. |
| 1 | Task 1 internal consistency | Workspace, compose, health entrypoints and local docs | Consistent; documentation and probes belong to same foundation deliverable. |
| 2 | Task 2 internal consistency | contracts, schema, migration runner, OpenAPI | Consistent; migrate command ties to Task 1 workspace scripts. |
| 3 | Task 3 internal consistency | OIDC, policy, audit, request context | Consistent; dev-only bypass is explicit and prod-rejected. |
| 4 | Task 4 internal consistency | resource routes, secret references, org signal | Consistent; manual org confirmation remains explicit opt-in and audited. |
| 5 | Task 5 internal consistency | state machines, optimistic version, outbox, worker | Consistent; queue publication is durable and bounded. |
| 6 | Task 6 internal consistency | ingestion, retrieval, AI, UI, citations | Consistent; mock/lexical retrieval is default and untrusted content is isolated. |
| 7 | Task 7 internal consistency | Figma parsing, 16-column schema, approval versions | Consistent after task-system ownership ruling above. |
| 8 | Task 8 internal consistency | Playwright runner, policy recheck, evidence, pause/resume | Consistent; non-idempotent side effects use checkpoints. |
| 9 | Task 9 internal consistency | screens, generated API client, retirement timing | Consistent; actual prototype removal deferred to Task 11. |
| 10 | Task 10 internal consistency | draft approval, mock default, idempotent submit, verification | Consistent; real adapter remains configuration-gated. |
| 11 | Task 11 internal consistency | operations, config, prototype retirement | Consistent; removal waits for replacement flow review. |

## Task completion

- Task 1: pending
- Task 2: pending
- Task 3: pending
- Task 4: pending
- Task 5: pending
- Task 6: pending
- Task 7: pending
- Task 8: pending
- Task 9: pending
- Task 10: pending
- Task 11: pending
