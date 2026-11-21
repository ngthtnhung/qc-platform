/** Trình duyệt chỉ nói chuyện với Next (cùng origin) ⇒ cookie HttpOnly + SameSite=Strict hoạt động, không cần CORS. */
const API = process.env.API_INTERNAL_URL || "http://127.0.0.1:8000";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    // 'unsafe-inline' cho script là yêu cầu của Next App Router khi chưa dùng nonce; ghi nhận là nợ kỹ thuật (SECURITY_REVIEW S-06)
    value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
];

export default {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/api/:path*` },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
