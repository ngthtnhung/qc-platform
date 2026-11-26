/** API client TẬP TRUNG: cookie HttpOnly (trình duyệt tự gửi), CSRF double-submit, tự refresh khi 401. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public correlationId?: string,
  ) {
    super(message);
  }
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.split("; ").find((c) => c.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : "";
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  refreshing ??= fetch("/api/v1/auth/refresh", {
    method: "POST",
    headers: { "X-CSRF-Token": readCookie("csrf_token") },
    credentials: "same-origin",
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export type ApiErrorCategory = "token_or_key" | "data_load";
export type ApiErrorEventDetail = {
  key: string;
  category: ApiErrorCategory;
  status: number;
  code: string;
  message: string;
  path: string;
  at: string;
};

export const ACTIVE_ERRORS_STORAGE_KEY = "qc_pet_active_errors";
const NON_SESSION_AUTH_CODES = new Set(["HARAWORKS_AUTH", "AI_AUTH", "FIGMA_AUTH", "INVALID_CREDENTIALS"]);
const TOKEN_OR_KEY_CODES = new Set(["NO_COOKIE", "HARAWORKS_AUTH", "NO_AI_PROVIDER", "AI_AUTH", "FIGMA_AUTH"]);

export function readStoredApiErrors(): Record<string, ApiErrorEventDetail> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ACTIVE_ERRORS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, ApiErrorEventDetail>) : {};
  } catch {
    return {};
  }
}

function writeStoredApiErrors(map: Record<string, ApiErrorEventDetail>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_ERRORS_STORAGE_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

function normalizeErrKey(code: string, path: string): string {
  if (code === "NO_COOKIE" || code === "HARAWORKS_AUTH") return "integ:haraworks";
  if (code === "NO_AI_PROVIDER" || code === "AI_AUTH") return "integ:ai";
  if (code === "FIGMA_AUTH") return "integ:figma";
  const basePath = path.split("?")[0] || path;
  return `data:${basePath}`;
}

export function clearStoredApiError(keyOrPath: string): void {
  if (typeof window === "undefined") return;
  const cur = readStoredApiErrors();
  const basePath = keyOrPath.split("?")[0] || keyOrPath;
  let changed = false;
  for (const k of Object.keys(cur)) {
    if (k === keyOrPath || k === `data:${basePath}` || cur[k]?.path?.split("?")[0] === basePath) {
      delete cur[k];
      changed = true;
    }
  }
  if (changed) writeStoredApiErrors(cur);
}

export function emitApiError(info: { status: number; code: string; message: string; path: string }): void {
  if (typeof window === "undefined") return;
  const { status, code, message, path } = info;
  if (path.startsWith("/auth/")) return;
  const isTokenErr = TOKEN_OR_KEY_CODES.has(code);
  const isDataLoadErr = status === 0 || status >= 500 || code === "HARAWORKS_ERROR" || code === "AI_UNAVAILABLE" || code === "SYNC_FAILED";
  if (!isTokenErr && !isDataLoadErr) return;
  const category: ApiErrorCategory = isTokenErr ? "token_or_key" : "data_load";
  const detail: ApiErrorEventDetail = {
    key: normalizeErrKey(code, path),
    category,
    status,
    code,
    message,
    path,
    at: new Date().toISOString(),
  };
  const cur = readStoredApiErrors();
  cur[detail.key] = detail;
  writeStoredApiErrors(cur);
  try {
    window.dispatchEvent(new CustomEvent<ApiErrorEventDetail>("qc:api-error", { detail }));
  } catch { /* ignore */ }
}

function emitApiSuccess(path: string, method: string): void {
  if (typeof window === "undefined") return;
  if (method !== "GET" || path.startsWith("/auth/")) return;
  const basePath = path.split("?")[0] || path;
  clearStoredApiError(basePath);
  try {
    window.dispatchEvent(new CustomEvent<{ path: string }>("qc:api-success", { detail: { path: basePath } }));
  } catch { /* ignore */ }
}

async function parseError(res: Response): Promise<ApiError> {
  let code = "HTTP_" + res.status;
  let message = "Có lỗi xảy ra";
  let cid: string | undefined;
  try {
    const body = await res.json();
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      cid = body.error.correlation_id;
    }
  } catch {
    /* không phải JSON */
  }
  return new ApiError(res.status, code, message, cid);
}

export type Job = { id: string; kind: string; status: "QUEUED" | "RUNNING" | "DONE" | "FAILED"; result: Record<string, unknown> | null };

/** Chờ một tác vụ nền (đồng bộ Haraworks...) xong; trả về job cuối cùng. Việc dài chạy ở worker, không trong request. */
export async function waitJob(id: string, onTick?: (j: Job) => void, timeoutMs = 15 * 60_000): Promise<Job> {
  const t0 = Date.now();
  for (;;) {
    const j = await api<Job>(`/jobs/${id}`);
    onTick?.(j);
    if (j.status === "FAILED") {
      const errObj = (j.result as { error?: { code?: string; message?: string } } | null)?.error;
      emitApiError({
        status: errObj?.code === "HARAWORKS_AUTH" ? 401 : 500,
        code: errObj?.code || "SYNC_FAILED",
        message: errObj?.message || "Tác vụ nền thất bại",
        path: `/jobs/${j.kind}`,
      });
      return j;
    }
    if (j.status === "DONE") return j;
    if (Date.now() - t0 > timeoutMs) throw new ApiError(408, "JOB_TIMEOUT", "Tác vụ nền chạy quá lâu; xem lại sau.");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export async function apiForm<T = unknown>(path: string, form: FormData): Promise<T> {
  const doFetch = () => fetch(`/api/v1${path}`, { method: "POST", credentials: "same-origin", headers: { "X-CSRF-Token": readCookie("csrf_token") }, body: form });
  let res: Response;
  try {
    res = await doFetch();
  } catch (e) {
    emitApiError({ status: 0, code: "NETWORK_ERROR", message: "Không kết nối được máy chủ API.", path });
    throw e;
  }
  if (!res.ok) {
    const firstErr = res.status === 401 ? await parseError(res) : null;
    if (firstErr && !NON_SESSION_AUTH_CODES.has(firstErr.code) && (await tryRefresh())) {
      res = await doFetch();
    } else if (firstErr) {
      emitApiError({ status: firstErr.status, code: firstErr.code, message: firstErr.message, path });
      throw firstErr;
    }
  }
  if (!res.ok) {
    const err = await parseError(res);
    emitApiError({ status: err.status, code: err.code, message: err.message, path });
    throw err;
  }
  return (await res.json()) as T;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const doFetch = () =>
    fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(UNSAFE.has(method) ? { "X-CSRF-Token": readCookie("csrf_token") } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

  let res: Response;
  try {
    res = await doFetch();
  } catch (e) {
    emitApiError({ status: 0, code: "NETWORK_ERROR", message: "Không kết nối được máy chủ API.", path });
    throw e;
  }
  const isAuthCall = path.startsWith("/auth/login") || path.startsWith("/auth/refresh");
  if (!res.ok) {
    if (res.status === 401 && !isAuthCall) {
      const firstErr = await parseError(res);
      if (!NON_SESSION_AUTH_CODES.has(firstErr.code) && (await tryRefresh())) {
        res = await doFetch();
      } else {
        emitApiError({ status: firstErr.status, code: firstErr.code, message: firstErr.message, path });
        throw firstErr;
      }
    }
    if (!res.ok) {
      const err = await parseError(res);
      emitApiError({ status: err.status, code: err.code, message: err.message, path });
      throw err;
    }
  }
  emitApiSuccess(path, method);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type User = {
  id: string;
  username: string;
  display_name: string;
  employee_code: string;
  email: string;
  role: "qc";
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
};

export type Approval = {
  id: string;
  subject_type: string;
  subject_id: string;
  origin: "ai" | "human";
  requested_by_type: string;
  title: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  decided_by_id: string | null;
  decided_at: string | null;
  decision_note: string;
  created_at: string;
};

export type AuditRow = {
  id: string;
  at: string;
  actor_type: string;
  actor_username: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  decision: string;
  reason: string;
};

export type RuleItem = {
  rule_id: string; rule_key: string; module_code: string; origin: string; version_id: string; version_no: number;
  state: string; title: string; validation_status: "UNREVIEWED" | "VALIDATED" | "REJECTED" | "DISPUTED"; has_legacy_approval: boolean;
};
export type RuleList = { total: number; items: RuleItem[] };
export type RuleDetail = {
  rule_key: string; module_code: string; origin: string;
  versions: {
    version_id: string; version_no: number; state: string; title: string; description: string; user_roles: string[]; setting_type: string;
    config_path: string; open_questions: unknown[]; extra: Record<string, unknown>; legacy_approval: Record<string, unknown> | null;
    validation_status: string; validated_by: string | null; created_by_type: string;
  }[];
  references: { id: string; quote: string; stance: string; locator: Record<string, string>; validation_status: string; source_title: string; source_version: string }[];
};
export type BugItem = {
  id: string; external_id: string; source: string; title: string; status: number | null; status_label: string;
  priority?: number | null; priority_label: string;
  classification: string; module_code: string; project?: string; created_at_ext: string | null; assignee: string; approver: string; url: string;
};
export type Environment = { id: string; code: string; name: string; type: string; base_url: string; org_identifier: string; requires_org_confirmation: boolean; is_active: boolean };
export type AccountRoute = { label?: string; url: string };
export type Account = {
  id: string;
  environment_id: string;
  name: string;
  role_label: string;
  username_ref: string;
  default_route?: string;
  routes?: AccountRoute[];
  has_secret: boolean;
};

export type ParamOption = { value: string; label?: string };
export type TaskParam = {
  key: string;
  label: string;
  type: "text" | "multiline" | "list" | "file" | "number" | "date" | "select" | string;
  value: string;
  options?: string[];
  auto: boolean;
  fallback?: "first" | "random";
};
export type ExpectedCriterion = {
  id: string;
  description: string;
  assertion_hint?: string;
  required?: boolean;
};
export type DataPolicy = {
  test_prefix?: string;
  cleanup_strategy?: "none" | "delete_after" | "revert" | string;
  seed_note?: string;
};
export type AutomationMode = "AUTO" | "SEMI_AUTO" | "MANUAL";
export type AutoTask = {
  id: string;
  name: string;
  module_code: string;
  flow: string;
  flow_code?: string;
  automation_mode?: AutomationMode;
  target_modules?: string[];
  inherited_from_cluster?: string;
  description: string;
  start_url: string;
  writes: boolean;
  steps: string[];
  required_roles: string[];
  rule_keys?: string[];
  preconditions?: string[];
  data_policy?: DataPolicy;
  expected_criteria?: ExpectedCriterion[];
  manual_checklist?: string[];
  created_at?: string;
  params: TaskParam[];
  runnable: boolean;
  approved_version: number | null;
  versions: { id: string; version_no: number; status: string; origin: string; sha256: string; created_at?: string }[];
};
export type Execution = {
  id: string;
  task_id: string;
  status: string;
  attempt: number;
  runner_id: string | null;
  target_module?: string | null;
  error: string;
  duration_ms: number | null;
  batch_id: string;
  queued_at: string;
  finished_at: string | null;
};
export type ExecutionDetail = Execution & {
  steps: { name: string; status: string; ms: number; error: string }[];
  log: string[];
  artifacts: { id: string; kind: string; file_id: string }[];
};
export type RunnerRow = { id: string; name: string; type: string; capabilities: string[]; status: string; last_heartbeat_at: string | null; revoked: boolean; token?: string };

export type Highlight = { start: number; end: number; term: string };
export type Citation = {
  passage_id: string; source_id: string; source_kind: string; source_title: string; source_version: string;
  source_module?: string; source_updated_at?: string;
  is_current: boolean; heading_path: string;
  locator: Record<string, unknown>; location: string; url: string; quote: string; excerpt: { text: string; start: number; end: number };
  highlights: Highlight[]; matched_terms: string[]; score: number; citation: string;
};
export type Keyword = { term: string; display: string; type: string; weight: number };
export type Coverage = Record<string, { label: string; sources: number; passages: number }>;
export type LookupResult = { keywords: Keyword[]; groups: Record<string, Citation[]>; coverage: Coverage; total_passages: number; module_empty?: boolean; hint: string; lookup_id: string | null };
export type SourceItem = {
  id: string; kind: string; kind_label: string; title: string; url: string; status: string; module?: string; created_at: string; updated_at?: string;
  meta?: { module?: string; images?: { file_id: string; filename: string }[] };
  versions: { id: string; label: string; created_at: string; current_passages: number; has_file: boolean; file_id?: string | null }[];
};
export type TaskFunctionItem = {
  id: string; task_id: string; title: string; description: string; has_description: boolean;
  team: string; project: string; module: string;
  status?: number | null; status_label?: string; closed?: boolean;
  priority?: number | null; priority_label?: string;
  assignee?: string; approver?: string;
  platform: string; customer: string; build_number: string; url: string; created_at: string; updated_at?: string;
};
export type BuildItem = {
  id: string; build_id: string; title: string; note: string;
  kind?: string; kind_label?: string;
  team: string; project: string; source_team?: string;
  source_function?: { id: string; title: string; url: string } | null;
  module: string; status_code?: number | null; status: string; closed?: boolean;
  priority?: number | null; priority_label?: string;
  assignee?: string; approver?: string;
  version: string; platform: string; parent_task: string; linked_count?: number; url: string;
  created_at: string; updated_at: string;
};
export type IntegrationStatus = {
  key: string;
  label: string;
  configured: boolean;
  state?: "active" | "missing" | "expired" | "error" | "unchecked";
  state_label?: string;
  detail?: string;
  last_check_at: string | null;
  last_check_status: string;
};
