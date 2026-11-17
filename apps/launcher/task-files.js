/**
 * Tải các file người dùng đã chọn (tham số kiểu file) từ server về thư mục tạm của máy này, chỉ cho một phiên.
 * File bị xóa ngay sau khi chạy xong. Mã file chỉ gồm chữ thường và số nên đường dẫn không thể thoát khỏi thư mục tạm.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const safe = s => String(s).replace(/[^\w.\- ]/g, '_').slice(0, 80);

/**
 * @param {(p: string, opts?: object) => Promise<any>} api  hàm gọi server (đã gắn token)
 * @returns {{ files: Record<string,string[]>, cleanup: () => void }}
 */
export async function fetchTaskFiles(api, sessionId, params = [], baseDir = os.tmpdir()) {
  const dir = path.join(baseDir, 'qa-launcher', safe(sessionId));
  const files = {};
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  try {
    for (const p of params.filter(x => x.type === 'file' && x.value)) {
      files[p.key] = [];
      for (const fid of String(p.value).split(',').map(x => x.trim()).filter(Boolean)) {
        if (!/^f_[a-z0-9]{8,24}$/.test(fid)) throw new Error(`Mã file không hợp lệ: ${fid}`);
        const base = `/browser-sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(fid)}`;
        const meta = await api(`${base}/meta`);
        fs.mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, `${fid}_${safe(meta.name)}`);
        fs.writeFileSync(dest, await api(base, { binary: true }));
        files[p.key].push(dest);
      }
    }
  } catch (e) { cleanup(); throw e; }
  return { files, cleanup };
}
