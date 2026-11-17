/**
 * Đồng bộ danh sách bug cũ của "Kho Business Rule Haraworks" vào platform.
 *
 * Nguồn: database/kb-snapshot/data/bugs.json (file data/bugs.json của artifact, Claude xuất giúp)
 *        database/kb-snapshot/bug_notes/*.json (ghi chú bug: nguyên nhân, cách sửa; tùy chọn)
 *
 *   node scripts/sync-bugs.mjs                                   (ghi vào database/bugs.json trên máy này)
 *   QA_SERVER_URL=https://172.16.13.8:3001 QA_TOKEN=qa_... node scripts/sync-bugs.mjs   (đẩy lên server nhóm; quyền admin hoặc rules)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureTrustedCa } from '../packages/tls-trust/ca.js';

ensureTrustedCa(process.env.QA_SERVER_URL);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'database', 'kb-snapshot', 'data', 'bugs.json');
const notesDir = path.join(root, 'database', 'kb-snapshot', 'bug_notes');
if (!fs.existsSync(src)) { console.error('Chưa có database/kb-snapshot/data/bugs.json. Nhờ Claude xuất data/bugs.json từ artifact trước.'); process.exit(1); }

const bugs = JSON.parse(fs.readFileSync(src, 'utf8'));
const notes = fs.existsSync(notesDir)
  ? fs.readdirSync(notesDir).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(notesDir, f), 'utf8')))
  : [];

if (process.env.QA_SERVER_URL) {
  const res = await fetch(process.env.QA_SERVER_URL.replace(/\/+$/, '') + '/api/v1/bugs/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.QA_TOKEN || ''}` },
    body: JSON.stringify({ bugs, notes })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { console.error('Đẩy lên server thất bại:', j.error?.message || res.status); process.exit(1); }
  console.log(`Đã đẩy ${j.data.count} bug lên server, bản ${j.data.revision}.`);
} else {
  const out = { source: bugs.source, count: bugs.bugs.length, range: bugs.range, synced_at: new Date().toISOString(), revision: 1, bugs: bugs.bugs };
  fs.writeFileSync(path.join(root, 'database', 'bugs.json'), JSON.stringify(out));
  if (notes.length) fs.writeFileSync(path.join(root, 'database', 'bug_notes.json'), JSON.stringify(notes));
  console.log(`Đã ghi ${out.count} bug${notes.length ? ` và ${notes.length} ghi chú` : ''} vào database/.`);
}
