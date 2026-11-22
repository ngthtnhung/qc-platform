/** Địa chỉ API phía server, đọc LÚC CHẠY (không đóng cứng khi build như `rewrites` của Next). */
export function apiTarget(base: string | undefined, pathname: string, search: string): URL {
  const root = (base && base.trim() ? base : "http://127.0.0.1:8000").replace(/\/+$/, "");
  return new URL(`${root}${pathname}${search}`);
}
