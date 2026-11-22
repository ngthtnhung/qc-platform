import { describe, expect, it } from "vitest";
import { apiTarget } from "./apiTarget";

describe("apiTarget", () => {
  it("dùng biến môi trường lúc chạy, giữ nguyên đường dẫn và query", () => {
    expect(apiTarget("http://api:8000/", "/api/v1/bugs", "?q=a%20b").toString()).toBe("http://api:8000/api/v1/bugs?q=a%20b");
  });
  it("mặc định localhost khi chưa cấu hình", () => {
    expect(apiTarget(undefined, "/api/v1/x", "").toString()).toBe("http://127.0.0.1:8000/api/v1/x");
    expect(apiTarget("  ", "/api/v1/x", "").host).toBe("127.0.0.1:8000");
  });
});
