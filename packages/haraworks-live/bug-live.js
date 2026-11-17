// Theo dõi realtime các task Bug / Issue trong các dự án "... - EMPTY" của team (chạy trong API server của platform).
// Bản này lấy từ app haraworks-tasks-local (trang #/bugs): cùng cách lấy, cùng bộ dự án.
// Không chỉ task giao cho bạn: lấy tất cả task trong dự án mà bạn xem được.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthError } from './client.js';

const CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../database/bugs-live.json');
const BIG_PROJECT = 1000; // dự án lớn hơn mức này: chỉ lấy chi tiết task MỚI để đỡ nặng

// Đổi số này khi thêm trường mới -> lần chạy sau tự lấy lại chi tiết mọi bug
const FIELDS_VERSION = 2;
const RECENT_DAYS = 62; // dự án lớn: vẫn lấy lại chi tiết bug tạo trong ~2 tháng để bắt thay đổi thông tin

const BUG_FIELDS = `
  id name status priority is_Deleted created_At status_Updated_At project_Id
  assignTo { id name }
  additionalInfo { key value }
`;

// Tiêu đề có tag [Bug] / [BUG] / [Issue] (kể cả gõ sai như [Issuse])
export const isBugTitle = (name) => /\[\s*(bug|iss\w*)\s*\]/i.test(name || '');

// Giờ Việt Nam dạng "2026-11-10 17:24:56" (giống cột "Thời gian tạo" của file CSV)
const vnTime = (iso) =>
  iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).replace('T', ' ') : '';

export class BugLive extends EventEmitter {
  /**
   * Dùng chung cho 2 việc: theo dõi bug (mặc định) và theo dõi task build/release.
   * cacheFile / extraFields / tag cho phép tạo thêm 1 bộ theo dõi khác.
   */
  constructor(client, { pattern, allTasksPattern, pollMs, cacheFile, extraFields = '', tag = 'bug-live' }) {
    super();
    this.cacheFile = path.resolve(cacheFile || CACHE_FILE);
    this.fields = BUG_FIELDS + extraFields;
    this.tag = tag;
    this.client = client;
    this.pattern = new RegExp(pattern, 'i');
    // Dự án mà MỌI task đều tính là bug (không cần tag [Bug]/[Issue] trong tiêu đề)
    this.allTasksPattern = allTasksPattern ? new RegExp(allTasksPattern, 'i') : null;
    this.pollMs = pollMs;
    this.projects = []; // [{id, name, version}]
    this.bugs = new Map(); // id -> raw task (chỉ task Bug/Issue)
    this.seen = {}; // projectId -> [taskId...] (mọi task trong dự án, để biết task mới)
    this.error = null;
    this.lastSyncAt = null;
    this.running = false;
    this.pending = false;
    this.loadCache();
  }

  async start() {
    await this.discover();
    this.sync('khởi động');
    if (this.pollMs > 0) this.timer = setInterval(() => this.sync('poll'), this.pollMs);
    // Mỗi 30 phút xem có dự án EMPTY mới không
    setInterval(() => this.discover(), 30 * 60000);
  }

  trigger(reason) {
    this.sync(reason);
  }

  async discover() {
    try {
      const all = await this.client.getProjects();
      const found = all.filter((p) => this.pattern.test(p.name || ''));
      const old = new Map(this.projects.map((p) => [p.id, p]));
      this.projects = found.map((p) => {
        const allTasks = !!this.allTasksPattern?.test(p.name || '');
        const prev = old.get(p.id);
        // Vừa đổi cách lọc của dự án -> quét lại từ đầu
        const version = prev && prev.allTasks === allTasks ? prev.version : '0';
        if (version === '0') delete this.seen[p.id]; // lấy lại chi tiết toàn bộ task của dự án
        return { id: p.id, name: p.name, allTasks, version };
      });
      console.log(
        `[${this.tag}] theo dõi ${found.length} dự án: ` +
          this.projects.map((p) => p.name + (p.allTasks ? ' (mọi task)' : '')).join(', '),
      );
    } catch (e) {
      this.setError(e);
    }
  }

  async sync(reason) {
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    try {
      let changed = 0;
      for (const p of this.projects) changed += await this.syncProject(p);
      this.error = null;
      this.lastSyncAt = new Date().toISOString();
      if (changed) {
        this.saveCache();
        console.log(`[${this.tag}] ${reason}: ${this.bugs.size} ${this.tag === 'bug-live' ? 'bug/issue' : 'task'} | ${changed} thay đổi`);
        this.emit('change');
      }
      this.emit('status');
    } catch (e) {
      this.setError(e);
    } finally {
      this.running = false;
      if (this.pending) {
        this.pending = false;
        setTimeout(() => this.sync('yêu cầu dồn'), 500);
      }
    }
  }

  async syncProject(p) {
    // Hỏi nhẹ: dự án có gì thay đổi kể từ lần trước không? (null = không)
    const list = await this.client.getListTask(p.version, p.id);
    if (!list) return 0;

    const ids = list.ids;
    const before = new Set(this.seen[p.id] || []);
    const now = new Set(ids);

    // Dự án nhỏ: lấy lại chi tiết tất cả (bắt được cả thay đổi trạng thái / phân loại)
    // Dự án rất lớn: chỉ lấy task mới
    const recent = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString();
    const toFetch =
      ids.length <= BIG_PROJECT
        ? ids
        : ids.filter((id) => !before.has(id) || (this.bugs.get(id)?.created_At || '') >= recent);

    let changed = 0;
    const details = toFetch.length ? await this.client.getTasks(toFetch, this.fields) : [];
    const fetched = new Set();
    for (const t of details) {
      fetched.add(t.id);
      const keep = !t.is_Deleted && !!(t.name || '').trim() && (p.allTasks || isBugTitle(t.name));
      const old = this.bugs.get(t.id);
      if (keep) {
        const next = { ...t, project_Name: p.name };
        if (!old || JSON.stringify(old) !== JSON.stringify(next)) {
          this.bugs.set(t.id, next);
          changed++;
        }
      } else if (old) {
        this.bugs.delete(t.id);
        changed++;
      }
    }
    // Task không còn trong dự án (bị xoá / chuyển đi)
    for (const id of before) {
      if (!now.has(id) && this.bugs.get(id)?.project_Id === p.id) {
        this.bugs.delete(id);
        changed++;
      }
    }
    // Task được lấy chi tiết nhưng server không trả về -> coi như đã xoá
    for (const id of toFetch) {
      if (!fetched.has(id) && this.bugs.has(id)) {
        this.bugs.delete(id);
        changed++;
      }
    }

    this.seen[p.id] = ids;
    p.version = list.timestamp;
    return changed;
  }

  /** Chuyển sang cùng dạng với dòng trong file CSV để gộp chung */
  toRows() {
    return [...this.bugs.values()].map((t) => {
      const info = Object.fromEntries((t.additionalInfo || []).map((x) => [x.key, x.value]));
      return {
        id: t.id,
        title: (t.name || '').replace(/\s+/g, ' ').trim(),
        category: info.type || '',
        createdAt: vnTime(t.created_At),
        url: `https://tasks.haraworks.vn/task/project/${t.project_Id}/${t.id}`,
        live: true,
        status: t.status,
        assignee: t.assignTo?.name || '',
        projectId: t.project_Id,
        projectName: t.project_Name,
        customerName: info.customer || '',
        moduleName: info.module || '',
        platform: info.platform || '',
        rootCause: info.rootCause || '',
        updatedAt: t.status_Updated_At || '',
      };
    });
  }

  status() {
    return {
      projects: this.projects.map((p) => ({ id: p.id, name: p.name })),
      lastSyncAt: this.lastSyncAt,
      error: this.error,
      count: this.bugs.size,
    };
  }

  setError(e) {
    this.error = e instanceof AuthError ? `AUTH: ${e.message}` : e.message;
    console.error(`[${this.tag}] lỗi:`, this.error);
    this.emit('status');
  }

  loadCache() {
    try {
      const c = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      this.bugs = new Map(c.bugs.map((b) => [b.id, b]));
      this.seen = c.seen || {};
      this.projects = c.projects || [];
      if (c.fieldsVersion !== FIELDS_VERSION) {
        // Có trường mới (vd: độ ưu tiên) -> lấy lại chi tiết toàn bộ
        this.seen = {};
        this.projects = [];
        console.log(`[${this.tag}] có thêm trường dữ liệu mới, sẽ lấy lại chi tiết toàn bộ`);
      }
      console.log(`[${this.tag}] đã nạp ${this.bugs.size} bug từ lần chạy trước`);
    } catch {
      /* chưa có cache */
    }
  }

  saveCache() {
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      fs.writeFileSync(
        this.cacheFile,
        JSON.stringify({ fieldsVersion: FIELDS_VERSION, projects: this.projects, seen: this.seen, bugs: [...this.bugs.values()] }),
      );
    } catch (e) {
      console.warn(`[${this.tag}] không ghi được cache:`, e.message);
    }
  }
}
