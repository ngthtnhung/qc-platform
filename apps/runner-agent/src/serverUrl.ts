/**
 * Runner gửi token và mật khẩu tài khoản test tới server, nên mặc định chỉ chấp nhận https (hoặc http tới localhost).
 * `allowHttp` (RUNNER_ALLOW_HTTP=1) chỉ dành cho mạng nội bộ đáng tin cậy, ví dụ mạng Docker Compose (http://api:8000).
 */
export function checkServerUrl(url: string, allowHttp = false): string | null {
  if (/^https:\/\//.test(url)) return null;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) return null;
  if (allowHttp && /^http:\/\/[A-Za-z0-9._-]+(:\d+)?(\/|$)/.test(url)) return null;
  return "QC_SERVER_URL phải là https (http chỉ cho localhost, hoặc mạng nội bộ khi đặt RUNNER_ALLOW_HTTP=1)";
}
