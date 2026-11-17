/**
 * Nhập secrets/credentials.json (file thủ công cũ) vào kho mã hóa. Không in mật khẩu ra màn hình.
 * Chạy khi server đang tắt:  node scripts/import-credentials.mjs
 * Khóa trong file: "TÊN_ĐĂNG_NHẬP" hoặc "mã_môi_trường:TÊN_ĐĂNG_NHẬP". Chỉ nhập cho Staging và Production OrgID DEMO.
 * File cũ KHÔNG bị xóa, bạn tự xóa sau khi kiểm tra.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SecretVault, VAULT_ENV_TYPES } from '../packages/secret-vault/vault.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const credFile = path.join(root, 'secrets', 'credentials.json');
const db = JSON.parse(fs.readFileSync(path.join(root, 'database', 'qa_platform_data.json'), 'utf8'));
if (!fs.existsSync(credFile)) { console.log('Không có secrets/credentials.json.'); process.exit(0); }

const creds = JSON.parse(fs.readFileSync(credFile, 'utf8'));
for (const [key, pw] of Object.entries(creds)) {
  const [envId, user] = key.includes(':') ? key.split(':') : [null, key];
  const acc = db.account_profiles.find(a => a.username_ref === user && (!envId || a.environment_profile_id === envId));
  const env = acc && db.environment_profiles.find(e => e.id === acc.environment_profile_id);
  if (!acc) { console.log(`Bỏ qua "${key}": không có tài khoản trùng.`); continue; }
  if (!VAULT_ENV_TYPES.includes(env?.environment_type)) { console.log(`Bỏ qua "${key}": môi trường ${env?.environment_type} không được lưu mật khẩu.`); continue; }
  if (typeof pw !== 'string' || !pw) { console.log(`Bỏ qua "${key}": mật khẩu trống.`); continue; }
  SecretVault.set(acc.id, pw);
  acc.secret_ref = 'VAULT';
  console.log(`Đã nhập mật khẩu cho ${acc.id} (${user}).`);
}
fs.writeFileSync(path.join(root, 'database', 'qa_platform_data.json'), JSON.stringify(db, null, 2));
console.log('Xong. Hãy xóa secrets/credentials.json sau khi kiểm tra đăng nhập tự động.');
