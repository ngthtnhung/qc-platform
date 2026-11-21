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

  let res = await doFetch();
  const isAuthCall = path.startsWith("/auth/login") || path.startsWith("/auth/refresh");
  if (res.status === 401 && !isAuthCall && (await tryRefresh())) res = await doFetch();
  if (!res.ok) throw await parseError(res);
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
  id: string; external_id: string; source: string; title: string; status: number | null; status_label: string; priority_label: string;
  classification: string; module_code: string; created_at_ext: string | null; assignee: string; approver: string; url: string;
};
export type Environment = { id: string; code: string; name: string; type: string; base_url: string; org_identifier: string; requires_org_confirmation: boolean; is_active: boolean };
export type Account = { id: string; environment_id: string; name: string; role_label: string; username_ref: string; has_secret: boolean };
