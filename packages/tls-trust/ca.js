/**
 * Node không dùng kho chứng chỉ của Windows nên không tin chứng chỉ mkcert của server nhóm
 * (lỗi UNABLE_TO_VERIFY_LEAF_SIGNATURE). Hàm này tìm rootCA.pem của mkcert (hoặc file chỉ định)
 * rồi chạy lại chính script với NODE_EXTRA_CA_CERTS. Gọi ở đầu script, trước mọi lời gọi mạng.
 *
 * Thứ tự: biến NODE_EXTRA_CA_CERTS đã đặt > tham số --ca <file> > CAROOT > thư mục mkcert mặc định.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function ensureTrustedCa(serverUrl) {
  if (!String(serverUrl || '').startsWith('https://') || process.env.NODE_EXTRA_CA_CERTS) return;
  const argv = process.argv.slice(2);
  const caArg = argv.includes('--ca') ? argv[argv.indexOf('--ca') + 1] : '';
  const home = os.homedir();
  const candidates = [caArg, process.env.CAROOT && path.join(process.env.CAROOT, 'rootCA.pem'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'mkcert', 'rootCA.pem'),
    path.join(home, '.local', 'share', 'mkcert', 'rootCA.pem'),
    path.join(home, 'Library', 'Application Support', 'mkcert', 'rootCA.pem'),
    path.join(home, 'rootCA.pem')].filter(Boolean);
  const ca = candidates.find(f => fs.existsSync(f));
  if (!ca) { console.warn('Chưa tìm thấy rootCA.pem của mkcert. Nếu gặp lỗi chứng chỉ, đặt NODE_EXTRA_CA_CERTS hoặc thêm --ca "đường-dẫn\\rootCA.pem".'); return; }
  const argvWithoutCa = process.argv.slice(1).filter((a, i, arr) => a !== '--ca' && arr[i - 1] !== '--ca');
  const r = spawnSync(process.execPath, [...process.execArgv, ...argvWithoutCa], { stdio: 'inherit', env: { ...process.env, NODE_EXTRA_CA_CERTS: ca } });
  process.exit(r.status ?? 1);
}
