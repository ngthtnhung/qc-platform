/**
 * Chuyển môi trường + tài khoản test (+ mật khẩu trong kho DPAPI) từ bản Node sang QC Platform mới.
 *
 *   node scripts/migrate-accounts.mjs --server http://localhost:3000            # CHẠY KHÔ: chỉ in kế hoạch, KHÔNG giải mã mật khẩu
 *   node scripts/migrate-accounts.mjs --server http://localhost:3000 --apply    # ghi thật (hỏi tài khoản + mật khẩu QC của platform mới)
 *
 * - Phải chạy trên MÁY WINDOWS và đúng người dùng Windows đã tạo secrets/vault.key (khóa được bọc bằng DPAPI).
 * - Chỉ ĐỌC dữ liệu cũ; không sửa, không xóa. Mật khẩu chỉ nằm trong bộ nhớ, đi thẳng vào API chỉ-ghi của platform mới, không bao giờ in ra.
 * - Idempotent: môi trường (theo mã) và tài khoản (theo môi trường + tên đăng nhập) đã có thì bỏ qua; chỉ nhập mật khẩu cho tài khoản
 *   CHƯA có mật khẩu (thêm --overwrite-secrets để ghi đè).
 * - Chỉ Staging và Production OrgID DEMO được lưu mật khẩu (như quy tắc của vault).
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VAULT_TYPES = ['STAGING', 'PRODUCTION_TEST'];
const ENV_TYPES = ['STAGING', 'PRODUCTION_TEST', 'PRODUCTION', 'TASK_SYSTEM'];
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Kế hoạch từ DB cũ: không đụng tới mật khẩu (chỉ hỏi vault "có hay không"). */
export function buildPlan(db, { vaultHas, getRoutes }) {
  const skipped = [];
  const envs = [];
  for (const e of db.environment_profiles || []) {
    if (!ENV_TYPES.includes(e.environment_type)) { skipped.push(`môi trường ${e.id}: loại ${e.environment_type} không hỗ trợ`); continue; }
    const code = slug(e.id);
    if (!code) { skipped.push(`môi trường ${e.id}: mã không hợp lệ`); continue; }
    envs.push({ legacy_id: e.id, code, name: e.name, type: e.environment_type, base_url: e.base_url, login_url: e.login_url || '', org_identifier: e.org_identifier || '',
      allowed_actions: Array.isArray(e.allowed_actions) ? e.allowed_actions : [], requires_org_confirmation: e.environment_type === 'PRODUCTION_TEST' || !!e.requires_org_confirmation });
  }
  const accounts = [];
  for (const a of db.account_profiles || []) {
    const env = envs.find(e => e.legacy_id === a.environment_profile_id);
    if (!env) { skipped.push(`tài khoản ${a.id}: môi trường ${a.environment_profile_id} không có trong kế hoạch`); continue; }
    if (a.is_active === 0) { skipped.push(`tài khoản ${a.id}: đã vô hiệu`); continue; }
    const routes = getRoutes(a, { base_url: env.base_url }).map(r => ({ name: r.name, url: r.url }));
    accounts.push({ legacy_id: a.id, env_code: env.code, env_type: env.type, name: a.name, role_label: a.role || '', username_ref: a.username_ref, expected_org_ref: a.expected_org_ref || '',
      default_route: a.default_route || '', routes, kb_links: a.kb_links || [], kb_can_do: a.kb_can_do || [], kb_cannot_do: a.kb_cannot_do || [],
      has_secret: VAULT_TYPES.includes(env.type) && !!vaultHas(a.id) });
  }
  return { envs, accounts, skipped };
}

function cookieJar() {
  const jar = new Map();
  return {
    absorb(res) { for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); } },
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
  };
}

/** Client API tối giản: đăng nhập bằng cookie + CSRF như trình duyệt. */
export async function login(server, user, password, fetchImpl = fetch) {
  const jar = cookieJar();
  const res = await fetchImpl(`${server}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password }) });
  if (!res.ok) throw new Error(`Đăng nhập platform mới thất bại (HTTP ${res.status})`);
  jar.absorb(res);
  const { csrf_token: csrf } = await res.json();
  return async (method, p, body) => {
    const r = await fetchImpl(`${server}/api/v1${p}`, { method, headers: { 'Content-Type': 'application/json', Cookie: jar.header(), 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`${method} ${p} → HTTP ${r.status}: ${j.error?.message ?? ''}`); }
    return r.status === 204 ? null : r.json();
  };
}

export async function run({ db, vault, getRoutes, server, user, password, apply, overwriteSecrets = false, fetchImpl = fetch, log = console.log }) {
  const plan = buildPlan(db, { vaultHas: id => vault.has(id), getRoutes });
  log(`Kế hoạch: ${plan.envs.length} môi trường, ${plan.accounts.length} tài khoản (${plan.accounts.filter(a => a.has_secret).length} có mật khẩu trong kho cũ), bỏ qua ${plan.skipped.length}.`);
  plan.skipped.forEach(s => log(`  bỏ qua: ${s}`));
  if (!apply) { log('CHẠY KHÔ: chưa ghi gì và chưa giải mã mật khẩu nào. Thêm --apply để thực hiện.'); return { plan, applied: false }; }

  const call = await login(server, user, password, fetchImpl);
  const existingEnvs = new Map((await call('GET', '/environments')).map(e => [e.code, e]));
  const out = { envs_created: 0, envs_existing: 0, accounts_created: 0, accounts_existing: 0, secrets_set: 0, secrets_skipped: 0, errors: [] };
  const envIdByCode = new Map();
  for (const e of plan.envs) {
    const have = existingEnvs.get(e.code);
    if (have) { envIdByCode.set(e.code, have.id); out.envs_existing++; continue; }
    try {
      const { legacy_id, ...body } = e;
      const made = await call('POST', '/environments', body);
      envIdByCode.set(e.code, made.id);
      out.envs_created++;
    } catch (x) { out.errors.push(`môi trường ${e.code}: ${x.message}`); }
  }
  const existingAcc = await call('GET', '/accounts');
  for (const a of plan.accounts) {
    const envId = envIdByCode.get(a.env_code);
    if (!envId) { out.errors.push(`tài khoản ${a.legacy_id}: thiếu môi trường ${a.env_code}`); continue; }
    let acc = existingAcc.find(x => x.environment_id === envId && x.username_ref === a.username_ref);
    if (acc) out.accounts_existing++;
    else {
      try {
        const { legacy_id, env_code, env_type, has_secret, ...body } = a;
        acc = await call('POST', '/accounts', { ...body, environment_id: envId });
        out.accounts_created++;
      } catch (x) { out.errors.push(`tài khoản ${a.legacy_id}: ${x.message}`); continue; }
    }
    if (!a.has_secret) continue;
    if (acc.has_secret && !overwriteSecrets) { out.secrets_skipped++; continue; }
    try {
      const pw = vault.get(a.legacy_id); // giải mã trong bộ nhớ; không in ra
      if (!pw) { out.errors.push(`tài khoản ${a.legacy_id}: không giải mã được mật khẩu (sai người dùng Windows hoặc khóa bị mất)`); continue; }
      await call('PUT', `/accounts/${acc.id}/secret`, { password: pw });
      out.secrets_set++;
    } catch (x) { out.errors.push(`mật khẩu ${a.legacy_id}: ${x.message.replace(/\s+/g, ' ').slice(0, 120)}`); }
  }
  log(`Kết quả: môi trường +${out.envs_created} (đã có ${out.envs_existing}); tài khoản +${out.accounts_created} (đã có ${out.accounts_existing}); mật khẩu ghi ${out.secrets_set}, giữ nguyên ${out.secrets_skipped}; lỗi ${out.errors.length}.`);
  out.errors.forEach(e => log(`  lỗi: ${e}`));
  return { plan, applied: true, ...out };
}

async function ask(q, hidden) {
  if (process.env.QC_PASSWORD && hidden) return process.env.QC_PASSWORD;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = s => { if (s.includes(q)) rl.output.write(s); };
  return new Promise(r => rl.question(q, a => { rl.close(); if (hidden) console.log(''); r(a); }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const argv = process.argv.slice(2);
  const arg = n => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const server = (arg('--server') || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(server) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(server)) { console.error('Cần --server https://… (http chỉ cho localhost)'); process.exit(1); }
  const apply = argv.includes('--apply');
  const { SecretVault } = await import('../packages/secret-vault/vault.js');
  const { getRoutes } = await import('../packages/account-routes/routes.js');
  const db = JSON.parse(fs.readFileSync(path.join(root, 'database', 'qa_platform_data.json'), 'utf8'));
  const user = apply ? (process.env.QC_USER || await ask('Tài khoản QC của platform mới: ', false)) : '';
  const password = apply ? await ask('Mật khẩu: ', true) : '';
  const res = await run({ db, vault: SecretVault, getRoutes, server, user, password, apply, overwriteSecrets: argv.includes('--overwrite-secrets') });
  process.exit(res.errors?.length ? 2 : 0);
}
