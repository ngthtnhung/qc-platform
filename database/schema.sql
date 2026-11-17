-- ====================================================================
-- Internal AI QA Testing Platform - Database Schema (19 Core Tables)
-- Compatible with PostgreSQL & SQLite
-- Version: 1.0 (25/10/2026)
-- ====================================================================

-- 1. Users Table (RBAC)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'QC', -- QC, QC_BACKUP, PO, DESIGNER, DEV, CX, ADMIN
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 2. Projects Table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  external_project_key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 3. Modules Table
CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  project_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- 4. Module Ownerships Table
CREATE TABLE IF NOT EXISTS module_ownerships (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  role_code TEXT NOT NULL, -- PO, DESIGNER, DEV, QC, QC_BACKUP, CX_FUNCTION, CX_BUG
  user_id TEXT,
  external_assignee_id TEXT,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 5. Environment Profiles Table
CREATE TABLE IF NOT EXISTS environment_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  login_url TEXT NOT NULL,
  environment_type TEXT NOT NULL, -- STAGING, PRODUCTION_TEST, PRODUCTION, TASK_SYSTEM
  allowed_actions TEXT NOT NULL DEFAULT '["READ", "REPRODUCE"]', -- JSON Array
  requires_org_confirmation INTEGER NOT NULL DEFAULT 0, -- 1 for PRODUCTION_TEST
  org_identifier TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- 6. Account Profiles Table
CREATE TABLE IF NOT EXISTS account_profiles (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  environment_profile_id TEXT NOT NULL,
  username_ref TEXT NOT NULL,
  secret_ref TEXT NOT NULL, -- Reference or encrypted secret, never plaintext
  expected_org_ref TEXT,
  default_route TEXT DEFAULT '/',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (environment_profile_id) REFERENCES environment_profiles(id) ON DELETE CASCADE
);

-- 7. Knowledge Sources Table
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL, -- FILE, URL, TEXT, FIGMA_EXPORT, TASK
  title TEXT NOT NULL,
  module_id TEXT,
  source_uri TEXT,
  version TEXT DEFAULT '1.0',
  owner_user_id TEXT,
  effective_date TEXT,
  access_policy TEXT DEFAULT '{}', -- JSON Object
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, OUTDATED, ARCHIVED
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE SET NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 8. Knowledge Chunks Table
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  content_text TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  metadata TEXT DEFAULT '{}', -- JSON Object (module, heading, page, rule_ref)
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE
);

-- 9. Workflow Runs Table
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_type TEXT NOT NULL, -- BUG_ANALYSIS, BUG_REPLAY, TEST_PLAN, TEST_RUN, TASK_SYNC
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_by TEXT NOT NULL,
  project_id TEXT,
  module_id TEXT,
  input_payload TEXT DEFAULT '{}', -- JSON Object (sanitized, no secrets)
  current_step TEXT NOT NULL DEFAULT 'INIT',
  checkpoint TEXT DEFAULT '{}', -- JSON Object for resume
  idempotency_key TEXT UNIQUE,
  started_at TEXT,
  finished_at TEXT,
  error_code TEXT,
  error_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE SET NULL
);

-- 10. External Tasks Table (Jira / Haraworks mirror)
CREATE TABLE IF NOT EXISTS external_tasks (
  id TEXT PRIMARY KEY,
  external_task_id TEXT UNIQUE NOT NULL,
  external_url TEXT,
  project_id TEXT,
  module_id TEXT,
  task_type TEXT NOT NULL, -- CUSTOMER_BUG, FUNCTION, DEV, QC, CX
  title TEXT NOT NULL,
  description TEXT,
  external_status TEXT NOT NULL,
  priority TEXT, -- Critical, High, Medium, Low / P1, P2, P3
  severity TEXT,
  assignee_external_id TEXT,
  reviewer_external_id TEXT,
  due_at TEXT,
  last_synced_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  metadata TEXT DEFAULT '{}', -- JSON Object
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE SET NULL
);

-- 11. Bug Records Table
CREATE TABLE IF NOT EXISTS bug_records (
  id TEXT PRIMARY KEY,
  external_task_id TEXT,
  workflow_run_id TEXT,
  module_id TEXT,
  summary TEXT NOT NULL,
  observed_behavior TEXT NOT NULL,
  expected_behavior TEXT,
  severity TEXT,
  priority TEXT,
  reproducibility TEXT NOT NULL DEFAULT 'INCONCLUSIVE', -- REPRODUCED, NOT_REPRODUCED, INCONCLUSIVE
  status TEXT NOT NULL DEFAULT 'NEW',
  created_by TEXT NOT NULL,
  confirmed_by TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (external_task_id) REFERENCES external_tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (confirmed_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 12. Bug Procedures Table (Versioned Repro Procedures)
CREATE TABLE IF NOT EXISTS bug_procedures (
  id TEXT PRIMARY KEY,
  bug_record_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  preconditions TEXT DEFAULT '[]', -- JSON Array
  steps TEXT NOT NULL DEFAULT '[]', -- JSON Array of steps
  expected_result TEXT,
  environment_constraints TEXT DEFAULT '{}', -- JSON Object
  test_data_ref TEXT DEFAULT '{}', -- JSON Object
  approval_status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT, APPROVED, REJECTED
  created_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (bug_record_id) REFERENCES bug_records(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 13. Test Plans Table
CREATE TABLE IF NOT EXISTS test_plans (
  id TEXT PRIMARY KEY,
  external_parent_task_id TEXT,
  module_id TEXT,
  title TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT, IN_REVIEW, APPROVED, ARCHIVED
  source_refs TEXT DEFAULT '[]', -- JSON Array (task, Figma, rule citations)
  created_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (external_parent_task_id) REFERENCES external_tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 14. Test Cases Table (Mandatory 16-Column Template Compliant)
CREATE TABLE IF NOT EXISTS test_cases (
  id TEXT PRIMARY KEY,
  test_plan_id TEXT NOT NULL,
  case_key TEXT NOT NULL, -- Col 2: ID (e.g. TC-MAINT-01)
  link_task TEXT, -- Col 1: Link Task
  test_type TEXT NOT NULL DEFAULT 'Functional', -- Col 3: Test Type (Functional, Boundary, RBAC, UI/UX, Migration)
  platform TEXT NOT NULL DEFAULT 'Web (Desktop & Mobile)', -- Col 4: Platform
  objective TEXT NOT NULL, -- Col 5: Test objective
  module_name TEXT NOT NULL, -- Col 6: Module
  screen_name TEXT NOT NULL, -- Col 7: Screen
  functional_area TEXT NOT NULL, -- Col 8: Functional
  steps TEXT NOT NULL, -- Col 9: Steps (JSON Array or formatted text)
  account_profile_id TEXT, -- Col 10: Account
  preconditions_test_data TEXT, -- Col 11: Precondition / Test Data
  expected_result TEXT NOT NULL, -- Col 12: Expected Result
  actual_result TEXT, -- Col 13: Actual Result
  image_video_ref TEXT, -- Col 14: Image / Video
  status TEXT NOT NULL DEFAULT 'UNTESTED', -- Col 15: Status (UNTESTED, PASS, FAIL, BLOCKED, SKIPPED, INCONCLUSIVE)
  notes TEXT, -- Col 16: Note
  requirement_refs TEXT DEFAULT '[]', -- JSON Array: citations to PO / Figma / Rule
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (test_plan_id) REFERENCES test_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (account_profile_id) REFERENCES account_profiles(id) ON DELETE SET NULL
);

-- 15. Test Runs Table
CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT,
  test_plan_id TEXT NOT NULL,
  environment_profile_id TEXT NOT NULL,
  account_profile_id TEXT,
  round_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'CREATED', -- CREATED, RUNNING, PAUSED, COMPLETED, BLOCKED
  started_by TEXT NOT NULL,
  org_confirmed_by TEXT,
  org_confirmed_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (test_plan_id) REFERENCES test_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (environment_profile_id) REFERENCES environment_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (account_profile_id) REFERENCES account_profiles(id) ON DELETE SET NULL,
  FOREIGN KEY (started_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (org_confirmed_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 16. Test Results Table
CREATE TABLE IF NOT EXISTS test_results (
  id TEXT PRIMARY KEY,
  test_run_id TEXT NOT NULL,
  test_case_id TEXT NOT NULL,
  round_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL, -- PASS, FAIL, BLOCKED, SKIPPED, INCONCLUSIVE
  actual_result TEXT NOT NULL,
  evidence_refs TEXT DEFAULT '[]', -- JSON Array of evidence_assets IDs
  diagnostics_ref TEXT DEFAULT '{}', -- JSON Object of sanitized logs
  executed_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  reviewed_by TEXT,
  FOREIGN KEY (test_run_id) REFERENCES test_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 17. Evidence Assets Table
CREATE TABLE IF NOT EXISTS evidence_assets (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  workflow_run_id TEXT,
  asset_type TEXT NOT NULL, -- SCREENSHOT, VIDEO, TRACE, LOG, ATTACHMENT
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_key TEXT NOT NULL, -- Object storage path or base64 data
  file_size INTEGER DEFAULT 0,
  sha256 TEXT,
  redaction_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED', -- PENDING, REDACTED, NOT_REQUIRED
  retention_until TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL
);

-- 18. Approvals Table (Human-in-the-Loop Gates)
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  approval_type TEXT NOT NULL, -- PLAN, ORG_CONFIRMATION, EXECUTION, BUG_REPORT, TASK_WRITE
  requested_by TEXT NOT NULL,
  reviewed_by TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED, EXPIRED
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  reviewed_at TEXT,
  FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 19. Audit Events Table (Full Traceability & Audit Trail)
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL, -- USER, AI, SYSTEM, INTEGRATION
  actor_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  decision TEXT, -- ALLOW, DENY, APPROVE, REJECT
  reason TEXT,
  correlation_id TEXT NOT NULL,
  metadata_redacted TEXT DEFAULT '{}', -- JSON Object sanitized
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- ====================================================================
-- Indexes for Performance & Query Optimization
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_idempotency ON workflow_runs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_external_tasks_ext_id ON external_tasks(external_task_id);
CREATE INDEX IF NOT EXISTS idx_test_cases_plan ON test_cases(test_plan_id);
CREATE INDEX IF NOT EXISTS idx_test_results_run ON test_results(test_run_id);
CREATE INDEX IF NOT EXISTS idx_approvals_wf ON approvals(workflow_run_id);
CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_events(correlation_id);
