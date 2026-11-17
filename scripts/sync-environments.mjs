/**
 * Đưa 3 môi trường của "Kho Business Rule Haraworks" và các tài khoản đã thêm vào platform.
 * Chạy khi server đang TẮT:  node scripts/sync-environments.mjs
 *
 * - Ghi đè/thêm 3 môi trường: env_staging, env_prod_demo, env_prod_readonly.
 * - Tài khoản cũ của platform được giữ nguyên, chỉ chuyển sang môi trường tương ứng.
 * - Tài khoản trong artifact (database/kb-snapshot/accounts) được thêm vào. Không lưu mật khẩu.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = path.join(root, 'database', 'qa_platform_data.json');
const accDir = path.join(root, 'database', 'kb-snapshot', 'accounts');
const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
const now = new Date().toISOString();

const ENVS = [
  { id: 'env_staging', name: 'Staging (zuizui.io)', base_url: 'https://zuizui.io/', login_url: 'https://zuizui.io/',
    environment_type: 'STAGING', allowed_actions: ['READ', 'WRITE', 'REPRODUCE', 'AUTOMATE'], requires_org_confirmation: 0,
    org_identifier: 'THL' },
  { id: 'env_prod_demo', name: 'Production, OrgID DEMO (haraworks.vn)', base_url: 'https://haraworks.vn/', login_url: 'https://haraworks.vn/',
    environment_type: 'PRODUCTION_TEST', allowed_actions: ['READ', 'VERIFY'], requires_org_confirmation: 1,
    org_identifier: 'DEMO' },
  { id: 'env_prod_readonly', name: 'Production, OrgID khác DEMO (chỉ đọc)', base_url: 'https://tasks.haraworks.vn/', login_url: 'https://tasks.haraworks.vn/',
    environment_type: 'PRODUCTION', allowed_actions: ['READ'], requires_org_confirmation: 0,
    org_identifier: 'KHÁC DEMO' }
];

// môi trường cũ -> môi trường mới (tài khoản cũ được giữ)
const REMAP = { env_staging: 'env_staging', env_prod_test: 'env_prod_demo', env_task_system: 'env_prod_readonly' };

data.environment_profiles = ENVS.map(e => ({ ...e, is_active: 1, created_at: now }));
let moved = 0;
for (const a of data.account_profiles) {
  const to = REMAP[a.environment_profile_id];
  if (to && to !== a.environment_profile_id) { a.environment_profile_id = to; moved++; }
  a.secret_ref = 'NONE'; // platform không lưu mật khẩu nữa
}

const envOf = s => /demo/i.test(s) ? 'env_prod_demo' : /production|prod/i.test(s) ? 'env_prod_readonly' : 'env_staging';
let added = 0;
if (fs.existsSync(accDir)) {
  for (const f of fs.readdirSync(accDir).filter(x => x.endsWith('.json'))) {
    const d = JSON.parse(fs.readFileSync(path.join(accDir, f), 'utf8'));
    const id = `acc_kb_${d.account}`.toLowerCase();
    const role = (d.roles || []).map(r => r.role || r.module).filter(Boolean).join(', ') || 'Chưa ghi';
    const rec = {
      id, owner_user_id: 'usr_qc_lead', name: `${d.account} (${role})`, role,
      environment_profile_id: envOf(d.env), username_ref: d.account, secret_ref: 'NONE',
      expected_org_ref: d.org || '', default_route: (d.links || [])[0] || '/', is_active: 1,
      kb_links: d.links || [], kb_can_do: d.can_do || '', kb_cannot_do: d.cannot_do || '', created_at: now
    };
    const i = data.account_profiles.findIndex(a => a.id === id);
    if (i >= 0) data.account_profiles[i] = { ...data.account_profiles[i], ...rec }; else { data.account_profiles.push(rec); added++; }
  }
}

fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
console.log(`3 môi trường đã cập nhật; ${moved} tài khoản cũ chuyển môi trường; ${added} tài khoản từ artifact được thêm.`);
