/**
 * Kho mật khẩu mã hóa cho tài khoản test (chỉ Staging và Production OrgID DEMO).
 *
 * - Mỗi mật khẩu được mã hóa AES-256-GCM, gắn với mã tài khoản (AAD), lưu ở secrets/vault.json.
 * - Khóa dữ liệu ngẫu nhiên tạo tự động ở secrets/vault.key. Trên Windows khóa được bọc bằng DPAPI
 *   (chỉ đúng người dùng Windows này giải mã được); nơi khác lưu file quyền 0600.
 * - Chỉ ghi, không có API nào trả mật khẩu về giao diện. Chỉ trình đăng nhập tự động đọc khi cần.
 * - Thư mục secrets/ đã nằm trong .gitignore.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../secrets');
const VAULT_FILE = path.join(DIR, 'vault.json');
const KEY_FILE = path.join(DIR, 'vault.key');

// Chỉ các loại môi trường này được phép lưu mật khẩu
export const VAULT_ENV_TYPES = ['STAGING', 'PRODUCTION_TEST'];

const PS = (script, input) => execFileSync('powershell.exe',
  ['-NoProfile', '-NonInteractive', '-Command', script],
  { env: { ...process.env, QA_IN: input }, encoding: 'utf8', windowsHide: true }).trim();

const dpapi = {
  protect: b64 => PS("Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String($env:QA_IN),$null,'CurrentUser'))", b64),
  unprotect: b64 => PS("Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($env:QA_IN),$null,'CurrentUser'))", b64)
};

let cachedKey = null;
function getKey() {
  if (cachedKey) return cachedKey;
  // Server Linux/Docker: đưa khóa qua biến môi trường QA_VAULT_KEY (base64 của 32 byte), không để file khóa
  if (process.env.QA_VAULT_KEY) {
    const k = Buffer.from(process.env.QA_VAULT_KEY, 'base64');
    if (k.length !== 32) throw new Error('QA_VAULT_KEY phải là base64 của đúng 32 byte');
    return (cachedKey = k);
  }
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(KEY_FILE)) {
    const k = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
    cachedKey = Buffer.from(k.mode === 'dpapi' ? dpapi.unprotect(k.key) : k.key, 'base64');
  } else {
    const raw = crypto.randomBytes(32);
    const useDpapi = process.platform === 'win32';
    const stored = useDpapi ? dpapi.protect(raw.toString('base64')) : raw.toString('base64');
    fs.writeFileSync(KEY_FILE, JSON.stringify({ mode: useDpapi ? 'dpapi' : 'plain', key: stored }), { mode: 0o600 });
    cachedKey = raw;
  }
  return cachedKey;
}

const readAll = () => fs.existsSync(VAULT_FILE) ? JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8')) : { version: 1, entries: {} };
function writeAll(v) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = VAULT_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, VAULT_FILE);
}

export const SecretVault = {
  set(accountId, password) {
    if (!accountId || typeof password !== 'string' || !password) throw new Error('Thiếu mã tài khoản hoặc mật khẩu');
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
    c.setAAD(Buffer.from(accountId));
    const data = Buffer.concat([c.update(password, 'utf8'), c.final()]);
    const v = readAll();
    v.entries[accountId] = { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64'), updated_at: new Date().toISOString() };
    writeAll(v);
  },

  get(accountId) {
    const e = readAll().entries[accountId];
    if (!e) return null;
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(e.iv, 'base64'));
      d.setAAD(Buffer.from(accountId));
      d.setAuthTag(Buffer.from(e.tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(e.data, 'base64')), d.final()]).toString('utf8');
    } catch { return null; } // sai khóa hoặc file bị sửa
  },

  has: accountId => !!readAll().entries[accountId],
  updatedAt: accountId => readAll().entries[accountId]?.updated_at || null,

  delete(accountId) {
    const v = readAll();
    if (v.entries[accountId]) { delete v.entries[accountId]; writeAll(v); }
  },

  /** Mã các tài khoản đang có mật khẩu (không trả giá trị) */
  ids: () => Object.keys(readAll().entries)
};
