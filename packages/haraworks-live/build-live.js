/**
 * Theo dõi realtime các đợt Build App Mobile & Build Task Function trên tasks.haraworks.vn:
 *  - HRWs APP - RELEASE (Build App Mobile):          674ff8e9d64a3fd0fbaa2217
 *  - HRWs - RELEASE CHECKLIST (Build Task Function): 5d0758a105922900014b9d07
 * Cho phép xem toàn bộ danh sách task build và kiểm tra 1 task Bug / Task Function đã nằm trong đợt build nào chưa.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthError, createClient } from './client.js';
import { readCookie } from './index.js';
import { startRealtime } from './realtime.js';
import { htmlToText } from './detail.js';
import { CLOSED_STATUS, statusLabel, priorityLabel, priorityRank } from '../bug-search/codes.js';

const CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../database/builds-live.json');
const FIELDS_VERSION = 2;
const BIG_PROJECT = 1200;
const RECENT_DAYS = 90;

const KNOWN_MODULES = new Set([
  'DV5S', 'MAINT', 'IOT', 'SCM', 'HRM', 'CRM', 'ACC', 'SALES', 'INV', 'POS',
  'CHAT', 'IM', 'MAIL', 'NEWS', 'TASK', 'TMS', 'WMS', 'ESIGN', 'SMART', 'CX',
  'MKT', 'LOYALTY', 'OMNI', 'SOCIAL', 'WEB', 'APP', 'PORTAL', 'COMMON', 'CORE',
  'HR', 'PR', 'KPI', 'OKR', 'LMS', 'ASSET', 'BOOKING', 'FORM', 'SURVEY', 'TICKET'
]);
const SKIP_BUILD_TAGS = new Set(['WEB', 'MOBILE', 'APP', 'TẤT CẢ', 'TATCA', 'MINIAPP', 'EH', 'ODOO', 'IOS', 'ANDROID', 'BUILD', 'PRODUCTION']);

function extractBuildModule(name, linkedNames = []) {
  const tryStr = (str) => {
    const matches = String(str || '').match(/\[([^\]]{1,30})\]/g) || [];
    for (const raw of matches) {
      const tag = raw.slice(1, -1).trim().toUpperCase().replace(/\s+/g, '');
      if (!tag || SKIP_BUILD_TAGS.has(tag) || /^B\d{4,}$/i.test(tag)) continue;
      if (KNOWN_MODULES.has(tag)) return tag;
    }
    return '';
  };
  const fromName = tryStr(name);
  if (fromName) return fromName;
  for (const ln of linkedNames) {
    const m = tryStr(ln);
    if (m) return m;
  }
  return '';
}

export const BUILD_PROJECTS = [
  { id: '674ff8e9d64a3fd0fbaa2217', kind: 'app', kindLabel: 'Build App Mobile', name: 'HRWs APP - RELEASE' },
  { id: '5d0758a105922900014b9d07', kind: 'function', kindLabel: 'Build Task Function', name: 'HRWs - RELEASE CHECKLIST' },
];

const BUILD_FIELDS = `
  id name status priority is_Deleted is_Group_Task parent_Id
  created_At status_Updated_At plan_Start_At plan_End_At project_Id content
  assignTo { id name }
  approverEntity { user_Name }
  additionalInfo { key value }
`;

const vnTime = (iso) =>
  iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).replace('T', ' ') : '';

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();

function extractIdsFromHtml(html) {
  const ids = new Set();
  const str = String(html || '');
  const re = /(?:\/task\/(?:project\/[0-9a-f]{24}\/|me\/|filter\/approval\/)|\/task-timeline\/)([0-9a-f]{24})/gi;
  let m;
  while ((m = re.exec(str))) ids.add(m[1].toLowerCase());
  return [...ids];
}

function extractSourceTitle(name) {
  const s = String(name || '');
  const idx = s.toUpperCase().indexOf('BUILD PRODUCTION -');
  if (idx !== -1) return s.slice(idx + 'BUILD PRODUCTION -'.length).trim();
  return '';
}

export class BuildLive extends EventEmitter {
  constructor({ baseUrl, cookie, pollMs = 30000, cacheFile = CACHE_FILE } = {}) {
    super();
    this.baseUrl = baseUrl;
    this.cookie = cookie;
    this.client = cookie ? createClient({ baseUrl, cookie }) : { getProjects: async () => [], getListTask: async () => null, getTasks: async () => [] };
    this.cacheFile = path.resolve(cacheFile);
    this.tag = 'build-live';
    this.pollMs = pollMs;
    this.projects = BUILD_PROJECTS.map(p => ({ ...p, version: '0' }));
    this.builds = new Map(); // id -> build task record
    this.seen = {}; // projectId -> [taskId...]
    this.error = null;
    this.lastSyncAt = null;
    this.running = false;
    this.pending = false;
    this.revision = 0;
    this.loadCache();
  }

  async fetchTaskBuildsByIds(ids) {
    const map = new Map();
    if (!this.cookie || !ids.length) return map;
    const CONCURRENCY = 8;
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const batch = ids.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (buildId) => {
        try {
          const url = `${this.baseUrl}/call/ta_api/tasks/get_task-build_by_taskids?taskIds=${encodeURIComponent(buildId)}`;
          const res = await fetch(url, {
            headers: { accept: 'application/json', cookie: this.cookie, origin: this.baseUrl, referer: `${this.baseUrl}/task/me` },
            redirect: 'manual',
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) return;
          const json = await res.json();
          const rows = Array.isArray(json?.data) ? json.data : [];
          if (rows.length) {
            map.set(buildId, rows.map(r => ({
              id: String(r.id || '').toLowerCase(),
              name: String(r.name || ''),
              projectId: String(r.project_Id || ''),
            })).filter(x => x.id));
          }
        } catch {
          /* không bắt buộc */
        }
      }));
    }
    return map;
  }

  async start() {
    this.sync('khởi động');
    if (this.pollMs > 0) this.timer = setInterval(() => this.sync('poll'), this.pollMs);
  }

  trigger(reason = 'thủ công') {
    this.sync(reason);
  }

  async sync(reason) {
    if (!this.cookie) return;
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
        this.revision += 1;
        this.saveCache();
        console.log(`[${this.tag}] ${reason}: ${this.builds.size} task build | ${changed} thay đổi`);
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
    const list = await this.client.getListTask(p.version, p.id);
    if (!list) return 0;

    const ids = list.ids || [];
    const before = new Set(this.seen[p.id] || []);
    const now = new Set(ids);

    const recent = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString();
    const toFetch =
      ids.length <= BIG_PROJECT
        ? ids
        : ids.filter((id) => {
            if (!before.has(id)) return true;
            const b = this.builds.get(id);
            if (!b) return true;
            if ((b.created_At || '') >= recent) return true;
            // Nếu task trong cache chưa ở trạng thái đóng (5: Hoàn thành, 10: Không xử lý, 11: Không thực hiện),
            // luôn fetch lại để đồng bộ trạng thái mới nhất từ Haraworks
            if (b.status !== 5 && b.status !== 10 && b.status !== 11) return true;
            return false;
          });

    let changed = 0;
    const details = toFetch.length ? await this.client.getTasks(toFetch, BUILD_FIELDS) : [];
    const parentIds = details.filter(t => !t.is_Deleted && !t.is_Group_Task && !t.parent_Id && (t.name || '').trim()).map(t => t.id);
    const linkedMap = await this.fetchTaskBuildsByIds(parentIds);

    const fetched = new Set();
    for (const t of details) {
      fetched.add(t.id);
      const keep = !t.is_Deleted && !t.is_Group_Task && !t.parent_Id && !!(t.name || '').trim();
      const old = this.builds.get(t.id);
      if (keep) {
        const contentIds = extractIdsFromHtml(t.content);
        const linkedItems = linkedMap.get(t.id) || [];
        const linkedIds = [...new Set([...contentIds, ...linkedItems.map(x => x.id)])];
        const linkedNames = linkedItems.map(x => x.name).filter(Boolean);
        const next = {
          id: t.id,
          name: (t.name || '').replace(/\s+/g, ' ').trim(),
          status: t.status,
          priority: t.priority ?? null,
          created_At: t.created_At || '',
          status_Updated_At: t.status_Updated_At || '',
          plan_Start_At: t.plan_Start_At || '',
          plan_End_At: t.plan_End_At || '',
          project_Id: p.id,
          project_Name: p.name,
          kind: p.kind,
          kindLabel: p.kindLabel,
          module: extractBuildModule(t.name, linkedNames),
          assignee: t.assignTo?.name || '',
          approver: t.approverEntity?.user_Name || '',
          sourceTitle: extractSourceTitle(t.name),
          contentText: htmlToText(t.content).slice(0, 6000),
          linkedIds,
          linkedNames,
        };
        if (!old || JSON.stringify(old) !== JSON.stringify(next)) {
          this.builds.set(t.id, next);
          changed++;
        }
      } else if (old) {
        this.builds.delete(t.id);
        changed++;
      }
    }
    for (const id of before) {
      if (!now.has(id) && this.builds.get(id)?.project_Id === p.id) {
        this.builds.delete(id);
        changed++;
      }
    }
    for (const id of toFetch) {
      if (!fetched.has(id) && this.builds.has(id)) {
        this.builds.delete(id);
        changed++;
      }
    }

    this.seen[p.id] = ids;
    p.version = list.timestamp;
    return changed;
  }

  present(b) {
    const d = vnTime(b.created_At).slice(0, 16);
    return {
      id: b.id,
      title: b.name,
      kind: b.kind,
      kind_label: b.kindLabel,
      module: b.module || '',
      projectId: b.project_Id,
      project: b.project_Name,
      date: d,
      url: `https://tasks.haraworks.vn/task/project/${b.project_Id}/${b.id}`,
      status: b.status,
      status_label: statusLabel(b.status),
      priority: b.priority ?? null,
      priority_label: priorityLabel(b.priority),
      closed: CLOSED_STATUS.has(b.status),
      assignee: b.assignee || '',
      approver: b.approver || '',
      updated: b.status_Updated_At || '',
      plan_start_at: b.plan_Start_At || '',
      plan_end_at: b.plan_End_At || '',
      linked_count: (b.linkedIds || []).length,
      linked_ids: b.linkedIds || [],
      source_title: b.sourceTitle || '',
    };
  }

  list({ kind = '', project = '', q = '', status = '', closed = '', assignee = '', year = '', sort = 'created', offset = 0, limit = 50 } = {}) {
    const qFold = fold(q);
    const terms = qFold.split(/\s+/).filter(Boolean);
    const all = [...this.builds.values()].filter(b => {
      if (kind && b.kind !== kind) return false;
      if (project && b.project_Name !== project) return false;
      if (status !== '' && String(b.status) !== String(status)) return false;
      if (closed === 'open' && CLOSED_STATUS.has(b.status)) return false;
      if (closed === 'closed' && !CLOSED_STATUS.has(b.status)) return false;
      if (assignee && b.assignee !== assignee) return false;
      const d = vnTime(b.created_At);
      if (year && !d.startsWith(year)) return false;
      if (terms.length) {
        const hay = fold(`${b.name} ${b.contentText || ''} ${(b.linkedNames || []).join(' ')}`);
        if (!terms.every(t => hay.includes(t))) return false;
      }
      return true;
    });

    if (sort === 'updated') all.sort((x, y) => String(y.status_Updated_At || y.created_At).localeCompare(String(x.status_Updated_At || x.created_At)));
    else if (sort === 'priority') all.sort((x, y) => priorityRank(x.priority) - priorityRank(y.priority) || String(y.created_At).localeCompare(String(x.created_At)));
    else all.sort((x, y) => String(y.created_At).localeCompare(String(x.created_At)));

    return {
      total: all.length,
      items: all.slice(offset, offset + limit).map(b => this.present(b)),
      meta: { count: this.builds.size, lastSyncAt: this.lastSyncAt, revision: this.revision },
    };
  }

  facets() {
    const kinds = { app: 0, function: 0 }, statuses = {}, assignees = {}, years = {}, projects = {};
    for (const b of this.builds.values()) {
      kinds[b.kind] = (kinds[b.kind] || 0) + 1;
      statuses[b.status] = (statuses[b.status] || 0) + 1;
      if (b.assignee) assignees[b.assignee] = (assignees[b.assignee] || 0) + 1;
      if (b.project_Name) projects[b.project_Name] = (projects[b.project_Name] || 0) + 1;
      const y = vnTime(b.created_At).slice(0, 4);
      if (y) years[y] = (years[y] || 0) + 1;
    }
    return { kinds, statuses, assignees, years, projects };
  }

  /** Kiểm tra 1 task (Bug hoặc Task Function) đã nằm trong đợt Build App Mobile / Build Task Function nào chưa */
  checkTask({ id = '', title = '' } = {}) {
    const targetId = String(id || '').trim().toLowerCase();
    const cleanTitle = fold(String(title || '').replace(/^\s*(?:\[[^\]]{1,40}\]\s*)+/, '').trim());
    const fullTitle = fold(title);
    const appBuilds = [];
    const functionBuilds = [];

    for (const b of this.builds.values()) {
      let matched = false;
      if (targetId && (b.linkedIds || []).includes(targetId)) {
        matched = true;
      } else if (fullTitle.length >= 10) {
        const src = fold(b.sourceTitle);
        const content = fold(b.contentText);
        if (src && (src === fullTitle || src.includes(fullTitle) || (cleanTitle.length >= 10 && src.includes(cleanTitle)))) {
          matched = true;
        } else if (content && (content.includes(fullTitle) || (cleanTitle.length >= 12 && content.includes(cleanTitle)))) {
          matched = true;
        }
      }
      if (matched) {
        const item = this.present(b);
        if (b.kind === 'app') appBuilds.push(item);
        else functionBuilds.push(item);
      }
    }
    appBuilds.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    functionBuilds.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return { appBuilds, functionBuilds, total: appBuilds.length + functionBuilds.length };
  }

  status() {
    return {
      projects: this.projects.map(p => ({ id: p.id, name: p.name, kind: p.kind, kindLabel: p.kindLabel })),
      lastSyncAt: this.lastSyncAt,
      error: this.error,
      count: this.builds.size,
      syncing: this.running || this.pending,
      revision: this.revision,
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
      const list = c.builds || [];
      this.builds = new Map(list.map(b => [b.id, b]));
      this.seen = c.seen || {};
      if (Array.isArray(c.projects) && c.projects.length) {
        const verMap = new Map(c.projects.map(p => [p.id, p.version || '0']));
        this.projects = BUILD_PROJECTS.map(p => ({ ...p, version: verMap.get(p.id) || '0' }));
      }
      if (c.fieldsVersion !== FIELDS_VERSION) {
        this.seen = {};
        this.projects = BUILD_PROJECTS.map(p => ({ ...p, version: '0' }));
      }
      console.log(`[${this.tag}] đã nạp ${this.builds.size} task build từ lần chạy trước`);
    } catch {
      /* chưa có cache */
    }
  }

  saveCache() {
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      fs.writeFileSync(
        this.cacheFile,
        JSON.stringify({ fieldsVersion: FIELDS_VERSION, projects: this.projects, seen: this.seen, builds: [...this.builds.values()] }),
      );
    } catch (e) {
      console.warn(`[${this.tag}] không ghi được cache:`, e.message);
    }
  }
}

export function startBuildLive() {
  let currentCookie = readCookie();
  const baseUrl = process.env.HARAWORKS_BASE_URL || 'https://tasks.haraworks.vn';
  let realtime = currentCookie ? 'connecting' : 'no-cookie';
  let started = false;
  const live = new BuildLive({
    baseUrl,
    cookie: currentCookie,
    pollMs: +(process.env.BUILD_POLL_INTERVAL_MS || process.env.BUG_POLL_INTERVAL_MS || 30000),
  });

  const boot = (c) => {
    started = true;
    realtime = 'connecting';
    live.start();
    startRealtime({
      baseUrl,
      cookie: c,
      onEvent: (name) => live.trigger(`signalr:${name}`),
      onState: (s) => { realtime = s; },
    }).catch(() => {});
  };

  if (currentCookie) boot(currentCookie);

  return {
    get enabled() { return !!currentCookie; },
    trigger: (why = 'thủ công') => live.trigger(why),
    list: (opts) => live.list(opts),
    facets: () => live.facets(),
    checkTask: (opts) => live.checkTask(opts),
    status: () => ({ ...live.status(), enabled: !!currentCookie, realtime }),
    setCookie: (newCookie) => {
      currentCookie = String(newCookie || '').trim();
      live.cookie = currentCookie;
      live.client = currentCookie ? createClient({ baseUrl, cookie: currentCookie }) : { getProjects: async () => [], getListTask: async () => null, getTasks: async () => [] };
      live.error = null;
      if (currentCookie) {
        if (!started) boot(currentCookie);
        else live.trigger('cập nhật token');
      }
    },
  };
}
