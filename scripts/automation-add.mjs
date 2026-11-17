/**
 * Đẩy tác vụ tự động (JSON) lên server nhóm , dùng được ngay (không còn bước duyệt).
 *
 *   QA_SERVER_URL=https://172.16.13.8:3001 QA_TOKEN=qa_... node scripts/automation-add.mjs tasks/ten-tac-vu.json [file2.json ...]
 *
 * File là một tác vụ hoặc một mảng tác vụ. Định dạng: docs/operations/automation-tasks.md
 * Nếu server dùng chứng chỉ mkcert, thêm NODE_EXTRA_CA_CERTS=đường-dẫn\rootCA.pem
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ensureTrustedCa } from '../packages/tls-trust/ca.js';

ensureTrustedCa(process.env.QA_SERVER_URL); // tin chứng chỉ mkcert của server nhóm

const server = (process.env.QA_SERVER_URL || '').replace(/\/+$/, '');
const token = process.env.QA_TOKEN || '';
const files = process.argv.slice(2);
if (!server || !files.length) { console.error('Dùng: QA_SERVER_URL=... QA_TOKEN=... node scripts/automation-add.mjs file.json [...]'); process.exit(1); }

let failed = 0;
for (const f of files) {
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const task of Array.isArray(raw) ? raw : [raw]) {
    // id cố định theo module và tên: chạy lại chỉ cập nhật, không tạo bản trùng
    task.id ||= 'at_' + crypto.createHash('sha1').update(`${task.module}|${task.name}`).digest('hex').slice(0, 16);
    const res = await fetch(`${server}/api/v1/automation/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(task)
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) console.log(`OK  ${j.data.id}  ${j.data.name}  [${j.data.runnable ? 'sẵn sàng chạy' : 'chưa sẵn sàng'}]`);
    else { failed++; console.error(`LỖI ${task.name || f}: ${j.error?.message || res.status}`); }
  }
}
process.exit(failed ? 1 : 0);
