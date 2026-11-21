/**
 * Đồng bộ "Kho Business Rule Haraworks" (artifact) -> database/business_rules.json
 *
 * Cách dùng:
 *   1. Trong Claude Code, xuất DB artifact vào database/kb-snapshot/ (ArtifactData list, out_dir)
 *      hoặc chạy lệnh /business-rule-extractor Run để Claude làm việc này.
 *   2. node scripts/sync-business-rules.mjs                 (ghi file trên máy này)
 *      QA_SERVER_URL=http://qa-server:3001 QA_TOKEN=qa_... node scripts/sync-business-rules.mjs   (đẩy lên server nhóm)
 *
 * Lấy rule đã xác nhận (active) và rule chờ xác nhận (pending). Trạng thái gốc trong Kho không đổi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureTrustedCa } from '../packages/tls-trust/ca.js';
import { buildBundle } from '../packages/kb-sync/bundle.js';

ensureTrustedCa(process.env.QA_SERVER_URL); // tin chứng chỉ mkcert của server nhóm

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const snap = path.join(root, 'database', 'kb-snapshot');
const out = path.join(root, 'database', 'business_rules.json');

let bundle;
try { bundle = buildBundle(snap); } catch (e) { console.error(e.message); process.exit(1); }
const slim = bundle.rules, mods = bundle.modules;

// --export <file>: ghi gói rule ra một file để người khác nhập qua nút "Nhập file" trên platform
const ex = process.argv.indexOf('--export');
if (ex > 0 && process.argv[ex + 1]) {
  fs.writeFileSync(process.argv[ex + 1], JSON.stringify(bundle, null, 2));
  console.log(`Đã ghi ${slim.length} rule vào ${process.argv[ex + 1]}. Trên platform: tab Kho Business Rule, nút Cập nhật rule, Nhập file.`);
  process.exit(0);
}

// Có QA_SERVER_URL + QA_TOKEN (token admin): đẩy lên server nhóm, mọi người nhận bản mới trong vòng 1 phút
if (process.env.QA_SERVER_URL) {
  const res = await fetch(process.env.QA_SERVER_URL.replace(/\/+$/, '') + '/api/v1/business-rules/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.QA_TOKEN || ''}` },
    body: JSON.stringify(bundle)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { console.error('Đẩy lên server thất bại:', json.error?.message || res.status); process.exit(1); }
  console.log(`Đã đẩy ${json.data.count} rule lên server, bản ${json.data.revision}.`);
} else {
  // tăng số bản để các trang đang mở tự tải lại (trang kiểm tra số bản mỗi phút)
  const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
  fs.writeFileSync(out, JSON.stringify({ revision: (prev.revision || 0) + 1, synced_at: new Date().toISOString(), ...bundle }, null, 2));
  console.log(`Đã ghi ${slim.length} rule (${slim.filter(r => r.state === "pending").length} chưa xác nhận), ${mods.length} module -> ${path.relative(root, out)}`);
}
