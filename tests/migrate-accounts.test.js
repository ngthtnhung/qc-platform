/** Chạy: node --test tests/migrate-accounts.test.js  (dùng vault và API GIẢ; không đụng dữ liệu thật) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, run } from '../scripts/migrate-accounts.mjs';
import { getRoutes } from '../packages/account-routes/routes.js';

const DB = {
  environment_profiles: [
    { id: 'env_staging', name: 'Staging', base_url: 'https://tasks.zuizui.io', login_url: 'https://id.zuizui.io/login', environment_type: 'STAGING', allowed_actions: ['READ', 'AUTOMATE'], org_identifier: 'thl' },
    { id: 'env_prod_test', name: 'Prod DEMO', base_url: 'https://tasks.haraworks.vn', environment_type: 'PRODUCTION_TEST', requires_org_confirmation: 0, org_identifier: 'DEMO' },
    { id: 'env_prod', name: 'Prod', base_url: 'https://tasks.haraworks.vn', environment_type: 'PRODUCTION', allowed_actions: ['READ'] },
    { id: 'env_odd', name: 'Lạ', base_url: 'https://x.y', environment_type: 'WEIRD' },
  ],
  account_profiles: [
    { id: 'acc_1', name: 'NV Staging', role: 'Nhân viên', environment_profile_id: 'env_staging', username_ref: 'nv@x.com', default_route: '/maintenance/list', kb_links: [], is_active: 1 },
    { id: 'acc_2', name: 'Demo', role: 'QC', environment_profile_id: 'env_prod_test', username_ref: 'demo@x.com', default_route: '/', is_active: 1 },
    { id: 'acc_3', name: 'Prod RO', role: 'Xem', environment_profile_id: 'env_prod', username_ref: 'ro@x.com', default_route: '/', is_active: 1 },
    { id: 'acc_4', name: 'Cũ', role: '', environment_profile_id: 'env_staging', username_ref: 'old@x.com', default_route: '/', is_active: 0 },
    { id: 'acc_5', name: 'Mồ côi', environment_profile_id: 'env_missing', username_ref: 'o@x.com', is_active: 1 },
  ],
};

function fakeVault(secrets) {
  const calls = { get: [] };
  return { calls, has: id => id in secrets, get: id => { calls.get.push(id); return secrets[id] ?? null; } };
}

function fakeServer() {
  const state = { envs: [], accounts: [], puts: [], logins: 0 };
  const json = (status, body) => ({ ok: status < 400, status, headers: { getSetCookie: () => ['access_token=tok; Path=/; HttpOnly', 'csrf_token=csrf1; Path=/'] }, json: async () => body });
  const f = async (url, init = {}) => {
    const p = new URL(url).pathname.replace('/api/v1', '');
    const m = init.method || 'GET';
    if (p === '/auth/login') { state.logins++; return JSON.parse(init.body).password === 'right-pass' ? json(200, { csrf_token: 'csrf1' }) : json(401, { error: { message: 'sai' } }); }
    assert.equal(init.headers['X-CSRF-Token'], 'csrf1');
    assert.match(init.headers.Cookie, /access_token=tok/);
    if (p === '/environments' && m === 'GET') return json(200, state.envs);
    if (p === '/environments' && m === 'POST') { const e = { id: `e${state.envs.length}`, ...JSON.parse(init.body) }; state.envs.push(e); return json(201, e); }
    if (p === '/accounts' && m === 'GET') return json(200, state.accounts);
    if (p === '/accounts' && m === 'POST') { const a = { id: `a${state.accounts.length}`, has_secret: false, ...JSON.parse(init.body) }; state.accounts.push(a); return json(201, a); }
    const sec = p.match(/^\/accounts\/(.+)\/secret$/);
    if (sec && m === 'PUT') { state.puts.push({ id: sec[1], body: JSON.parse(init.body) }); state.accounts.find(a => a.id === sec[1]).has_secret = true; return { ok: true, status: 204, headers: { getSetCookie: () => [] }, json: async () => null }; }
    return json(404, {});
  };
  return { state, f };
}

test('kế hoạch: bỏ loại không hỗ trợ, tài khoản vô hiệu và mồ côi; chỉ Staging/PRODUCTION_TEST tính là có mật khẩu', () => {
  const plan = buildPlan(DB, { vaultHas: id => ['acc_1', 'acc_2', 'acc_3'].includes(id), getRoutes });
  assert.deepEqual(plan.envs.map(e => e.code), ['env_staging', 'env_prod_test', 'env_prod']);
  assert.equal(plan.envs.find(e => e.code === 'env_prod_test').requires_org_confirmation, true); // PRODUCTION_TEST luôn phải xác nhận Org
  assert.deepEqual(plan.accounts.map(a => a.legacy_id), ['acc_1', 'acc_2', 'acc_3']);
  assert.deepEqual(plan.accounts.map(a => a.has_secret), [true, true, false]); // Production không lưu mật khẩu dù kho cũ có
  assert.equal(plan.accounts[0].routes[0].url, 'https://tasks.zuizui.io/maintenance/list');
  assert.equal(plan.skipped.length, 3);
});

test('chạy khô: không đăng nhập, không gọi API, KHÔNG giải mã mật khẩu', async () => {
  const vault = fakeVault({ acc_1: 'S3cret-1' });
  const srv = fakeServer();
  const lines = [];
  const res = await run({ db: DB, vault, getRoutes, server: 'http://localhost:3000', apply: false, fetchImpl: srv.f, log: l => lines.push(l) });
  assert.equal(res.applied, false);
  assert.deepEqual(vault.calls.get, []);
  assert.equal(srv.state.logins, 0);
  assert.ok(lines.some(l => l.includes('CHẠY KHÔ')));
});

test('áp dụng: tạo môi trường/tài khoản, ghi mật khẩu đúng chỗ, không in mật khẩu; chạy lại thì không tạo trùng', async () => {
  const vault = fakeVault({ acc_1: 'S3cret-1', acc_2: 'S3cret-2', acc_3: 'KhongDuocLuu' });
  const srv = fakeServer();
  const lines = [];
  const args = { db: DB, vault, getRoutes, server: 'http://localhost:3000', user: 'qc', password: 'right-pass', apply: true, fetchImpl: srv.f, log: l => lines.push(l) };
  const r1 = await run(args);
  assert.equal(r1.envs_created, 3);
  assert.equal(r1.accounts_created, 3);
  assert.equal(r1.secrets_set, 2);
  assert.deepEqual(srv.state.puts.map(p => p.body.password).sort(), ['S3cret-1', 'S3cret-2']);
  assert.ok(!vault.calls.get.includes('acc_3')); // tài khoản Production không bị giải mã
  assert.ok(!lines.join('\n').match(/S3cret|KhongDuocLuu/)); // mật khẩu không xuất hiện trong log
  const r2 = await run({ ...args, log: () => {} });
  assert.deepEqual([r2.envs_created, r2.accounts_created, r2.secrets_set, r2.secrets_skipped], [0, 0, 0, 2]);
  assert.equal(srv.state.puts.length, 2);
  const r3 = await run({ ...args, overwriteSecrets: true, log: () => {} });
  assert.equal(r3.secrets_set, 2);
});

test('đăng nhập sai thì dừng, không ghi gì và không giải mã mật khẩu', async () => {
  const vault = fakeVault({ acc_1: 'S3cret-1' });
  const srv = fakeServer();
  await assert.rejects(run({ db: DB, vault, getRoutes, server: 'http://localhost:3000', user: 'qc', password: 'wrong', apply: true, fetchImpl: srv.f, log: () => {} }), /Đăng nhập platform mới thất bại/);
  assert.deepEqual(vault.calls.get, []);
  assert.equal(srv.state.envs.length, 0);
});
