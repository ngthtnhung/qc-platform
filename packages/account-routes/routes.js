/**
 * Danh sách link (route) của một tài khoản. Một tài khoản có thể vào nhiều link;
 * khi mở, Playwright đăng nhập rồi tự vào đúng link được chọn.
 */

const nameFromUrl = u => {
  try {
    const x = new URL(u);
    const path = x.pathname.replace(/\/+$/, '');
    return path ? `${x.hostname}${path}` : x.hostname;
  } catch { return u; }
};

/** Chấp nhận URL đầy đủ hoặc đường dẫn bắt đầu bằng "/" (nối với base_url của môi trường) */
function resolveUrl(raw, baseUrl) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try { return new URL(s, s.startsWith('/') ? baseUrl : undefined).toString(); } catch { return null; }
}

const rootDomain = host => host.split('.').slice(-2).join('.');

/** Chỉ cho https và cùng tên miền gốc với môi trường (zuizui.io, haraworks.vn) */
export function validateRoute(url, env) {
  let u; try { u = new URL(url); } catch { return 'Link không hợp lệ'; }
  const base = new URL(env.base_url);
  if (u.protocol !== 'https:') return 'Chỉ chấp nhận link https';
  if (rootDomain(u.hostname) !== rootDomain(base.hostname)) return `Link phải thuộc ${rootDomain(base.hostname)}`;
  return null;
}

/** Lấy routes của tài khoản; tài khoản cũ chưa có routes thì suy ra từ kb_links hoặc default_route */
export function getRoutes(acc, env) {
  const raw = Array.isArray(acc.routes) && acc.routes.length
    ? acc.routes
    : (acc.kb_links?.length ? acc.kb_links : [acc.default_route]).map(u => ({ url: u }));
  const seen = new Set();
  return raw.map(r => {
    const url = resolveUrl(r.url, env.base_url);
    return url && !seen.has(url) && seen.add(url) ? { name: r.name || nameFromUrl(url), url } : null;
  }).filter(Boolean);
}

/** Phân tích văn bản "Tên | URL" mỗi dòng (tên có thể bỏ trống) */
export function parseRouteLines(text, env) {
  const routes = [], errors = [];
  for (const [i, line] of String(text || '').split('\n').map(l => l.trim()).entries()) {
    if (!line) continue;
    const [a, b] = line.includes('|') ? line.split('|').map(x => x.trim()) : ['', line];
    const url = resolveUrl(b, env.base_url);
    const err = url ? validateRoute(url, env) : 'Link không hợp lệ';
    if (err) errors.push(`Dòng ${i + 1}: ${err}`); else routes.push({ name: a || nameFromUrl(url), url });
  }
  return { routes, errors };
}
