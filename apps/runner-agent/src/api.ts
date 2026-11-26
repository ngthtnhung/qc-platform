/** Client gọi API của QC Platform bằng token riêng của runner (Bearer rn_...). */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export type Job = {
  execution_id: string;
  attempt: number;
  lease_seconds: number;
  task: { name: string; start_url: string; writes: boolean };
  script: string;
  sha256: string;
  params: Record<string, string>;
  param_meta?: { key: string; value: string; type?: string; auto?: boolean; fallback?: "first" | "random" }[];
  test_prefix?: string;
  account: { id: string; username: string; expected_org: string; route: string };
  environment: { code: string; type: string; login_url: string };
};

export type ReportBody = {
  status: "PASSED" | "FAILED";
  sha256: string;
  steps: { name: string; status: string; ms: number; error?: string }[];
  log: string[];
  error: string;
  duration_ms: number;
};

export class ServerApi {
  constructor(private base: string, private token: string, private f: typeof fetch = fetch) {
    this.base = base.replace(/\/+$/, "");
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
    const res = await this.f(`${this.base}/api/v1/runner${path}`, {
      method: init.method ?? "POST",
      headers: { Authorization: `Bearer ${this.token}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    if (!res.ok) throw new ApiError(res.status, json.error?.code ?? `HTTP_${res.status}`, json.error?.message ?? `HTTP ${res.status}`);
    return json as T;
  }

  heartbeat = (status: "ONLINE" | "BUSY" = "ONLINE") => this.call<void>("/heartbeat", { body: { status } });
  claim = async () => (await this.call<{ job: Job | null }>("/claim")).job;
  credentials = (id: string) => this.call<{ username: string; password: string | null }>(`/executions/${id}/credentials`);
  files = (id: string) => this.call<{ key: string; file_id: string; name: string; size: number; mime: string }[]>(`/executions/${id}/files`, { method: "GET" });
  async downloadFile(id: string, fileId: string): Promise<Uint8Array> {
    const res = await this.f(`${this.base}/api/v1/runner/executions/${id}/files/${fileId}`, { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new ApiError(res.status, `HTTP_${res.status}`, `Không tải được file đính kèm (HTTP ${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
  start = (id: string) => this.call<void>(`/executions/${id}/start`);
  report = (id: string, body: ReportBody) => this.call<{ status: string }>(`/executions/${id}/report`, { body });
  async artifact(id: string, kind: string, name: string, data: Uint8Array, mime: string) {
    const form = new FormData();
    form.append("file", new Blob([data as BlobPart], { type: mime }), name);
    return this.call<{ file_id: string }>(`/executions/${id}/artifacts?kind=${encodeURIComponent(kind)}`, { form });
  }
}
