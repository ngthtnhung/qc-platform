import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

function res(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("api client", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { cookie: "csrf_token=abc123; other=1" });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("gửi CSRF header cho thao tác ghi, không gửi cho GET", async () => {
    fetchMock.mockImplementation(async () => res(200, { ok: 1 }));
    await api("/x", { method: "POST", body: { a: 1 } });
    await api("/y");
    expect(fetchMock.mock.calls[0][1].headers["X-CSRF-Token"]).toBe("abc123");
    expect(fetchMock.mock.calls[1][1].headers["X-CSRF-Token"]).toBeUndefined();
  });

  it("401 ⇒ refresh một lần rồi thử lại", async () => {
    fetchMock
      .mockResolvedValueOnce(res(401, { error: { code: "INVALID_TOKEN", message: "hết hạn" } }))
      .mockResolvedValueOnce(res(200, {}))
      .mockResolvedValueOnce(res(200, { ok: true }));
    await expect(api("/me")).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/auth/refresh");
  });

  it("refresh thất bại ⇒ ném ApiError 401, không lặp vô hạn", async () => {
    fetchMock
      .mockResolvedValueOnce(res(401, { error: { code: "INVALID_TOKEN", message: "hết hạn" } }))
      .mockResolvedValueOnce(res(401, {}));
    await expect(api("/me")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("không refresh khi chính lời gọi login bị 401", async () => {
    fetchMock.mockImplementation(async () => res(401, { error: { code: "INVALID_CREDENTIALS", message: "sai" } }));
    const err = (await api("/auth/login", { method: "POST", body: {} }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("INVALID_CREDENTIALS");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
