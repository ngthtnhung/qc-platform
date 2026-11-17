/**
 * Đưa kết quả khám phá lên server nhóm trong một lệnh: rule (gồm rule chờ xác nhận, có nhãn), bug cũ, tác vụ nháp.
 *
 *   QA_SERVER_URL=https://172.16.13.8:3001 QA_TOKEN=qa_... node scripts/qa-sync.mjs
 *
 * Trước đó dữ liệu phải được xuất từ artifact vào database/kb-snapshot/ (Claude làm bước này sau khi Explore).
 * Quyền cần có của token: rules (đẩy rule và bug), automation_push (đẩy tác vụ nháp). Token không cần là admin.
 * Tác vụ đẩy lên dùng được ngay (không còn bước duyệt).
 * Tùy chọn: --no-bugs  bỏ qua bug cũ (nặng 1,8 MB).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (script, args = []) => spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], { stdio: 'inherit', env: process.env, cwd: root }).status === 0;

// Cài đặt một lần: node scripts/qa-sync.mjs --save-config https://172.16.13.8:3001 qa_token...
// Lưu vào secrets/qa-sync.json (chỉ máy này). Các lần sau, kể cả khi Claude chạy Explore, tự dùng cấu hình này.
const cfgFile = path.join(root, 'secrets', 'qa-sync.json');
const sc = process.argv.indexOf('--save-config');
if (sc > 0) {
  const [url, token] = [process.argv[sc + 1], process.argv[sc + 2]];
  if (!/^https?:\/\//.test(url || '') || !token) { console.error('Dùng: node scripts/qa-sync.mjs --save-config <địa chỉ server> <token>'); process.exit(1); }
  fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
  fs.writeFileSync(cfgFile, JSON.stringify({ server: url.replace(/\/+$/, ''), token }, null, 2), { mode: 0o600 });
  console.log('Đã lưu cấu hình vào secrets/qa-sync.json. Từ nay chạy node scripts/qa-sync.mjs là đẩy được lên server nhóm.');
  process.exit(0);
}
if ((!process.env.QA_SERVER_URL || !process.env.QA_TOKEN) && fs.existsSync(cfgFile)) {
  try { const c = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); process.env.QA_SERVER_URL ||= c.server; process.env.QA_TOKEN ||= c.token; } catch {}
}
if (!process.env.QA_SERVER_URL || !process.env.QA_TOKEN) {
  console.error('Chưa có cấu hình đẩy lên server nhóm. Chạy một lần: node scripts/qa-sync.mjs --save-config <địa chỉ server> <token>');
  process.exit(1);
}

const results = [];
console.log('== Rule ==');
results.push(['rule', run('sync-business-rules.mjs')]);

if (!process.argv.includes('--no-bugs') && fs.existsSync(path.join(root, 'database', 'kb-snapshot', 'data', 'bugs.json'))) {
  console.log('== Bug cũ ==');
  results.push(['bug cũ', run('sync-bugs.mjs')]);
}

const draftsDir = path.join(root, 'database', 'automation-drafts');
const drafts = fs.existsSync(draftsDir) ? fs.readdirSync(draftsDir).filter(f => f.endsWith('.json')).map(f => path.join(draftsDir, f)) : [];
if (drafts.length) {
  console.log(`== Tác vụ nháp (${drafts.length} file) ==`);
  results.push(['tác vụ', run('automation-add.mjs', drafts)]);
}

console.log('\nKết quả: ' + results.map(([n, ok]) => `${n}: ${ok ? 'xong' : 'LỖI'}`).join(' · '));
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
