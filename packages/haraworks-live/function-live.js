/**
 * Theo dõi realtime các task Function từ 4 dự án Team trên tasks.haraworks.vn:
 *  - Super Team:    69c9d807450dd4c76ed0a3d2
 *  - Winx Team:     69c6328e5064a7c3126c07aa
 *  - Integrity Team: 64633a85ed6a4000010ce2a0
 *  - Team 1:        69c4cfd54a0b31677fd70f2f
 * Lấy toàn bộ task tạo từ 01/01/2024 đến hiện tại (realtime qua SignalR + poll 30s).
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthError, createClient } from './client.js';
import { readCookie, parseTags } from './index.js';
import { startRealtime } from './realtime.js';

const CACHE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../database/functions-live.json');
const FIELDS_VERSION = 4;
const MIN_DATE = '2024-01-01';
const RECENT_DAYS = 90;
const BIG_PROJECT = 1500;
const isQcChildTitle = (name) => /^\s*(?:\[\s*qc\s*\]|qc[\s:\-\]])/i.test(String(name || ''));

export const FUNCTION_PROJECTS = [
  { id: '69c9d807450dd4c76ed0a3d2', name: 'Super Team', team: 'Super Team' },
  { id: '69c6328e5064a7c3126c07aa', name: 'Winx Team', team: 'Winx Team' },
  { id: '64633a85ed6a4000010ce2a0', name: 'Integrity Team', team: 'Integrity Team' },
  { id: '69c4cfd54a0b31677fd70f2f', name: 'Team 1', team: 'Team 1' },
];

const TASK_FIELDS = `
  id name status priority is_Deleted is_Group_Task parent_Id created_At status_Updated_At plan_Start_At plan_End_At project_Id
  assignTo { id name }
  approverEntity { user_Name department_Name }
  additionalInfo { key value }
`;

const vnTime = (iso) =>
  iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).replace('T', ' ') : '';

export class FunctionLive extends EventEmitter {
  constructor(client, { pollMs = 30000, cacheFile = CACHE_FILE } = {}) {
    super();
    this.cacheFile = path.resolve(cacheFile);
    this.fields = TASK_FIELDS;
    this.tag = 'function-live';
    this.client = client;
    this.pollMs = pollMs;
    this.projects = FUNCTION_PROJECTS.map(p => ({ ...p, version: '0' }));
    this.tasks = new Map(); // id -> raw task (chỉ task cha)
    this.qcTasks = new Map(); // id -> raw task con có tiền tố QC
    this.seen = {}; // projectId -> [taskId...]
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
  }

  trigger(reason) {
    this.sync(reason);
  }

  async discover() {
    try {
      const all = await this.client.getProjects();
      const byId = new Map((all || []).map(p => [p.id, p.name]));
      const oldVer = new Map(this.projects.map(p => [p.id, p.version]));
      this.projects = FUNCTION_PROJECTS.map(p => ({
        id: p.id,
        team: p.team,
        name: byId.get(p.id) ? `${p.team} (${byId.get(p.id)})` : p.team,
        rawName: byId.get(p.id) || p.name,
        version: oldVer.get(p.id) || '0',
      }));
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
        console.log(`[${this.tag}] ${reason}: ${this.tasks.size} task function | ${changed} thay đổi`);
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
            const t = this.tasks.get(id) || this.qcTasks.get(id);
            if (!t) return true;
            if ((t.created_At || '') >= recent) return true;
            // Nếu task chưa đóng, luôn fetch lại để đồng bộ trạng thái
            if (t.status !== 5 && t.status !== 10 && t.status !== 11) return true;
            return false;
          });

    let changed = 0;
    const details = toFetch.length ? await this.client.getTasks(toFetch, this.fields) : [];
    const fetched = new Set();
    for (const t of details) {
      fetched.add(t.id);
      const createdDate = vnTime(t.created_At).slice(0, 10) || String(t.created_At || '').slice(0, 10);
      const keep = !t.is_Deleted && !t.is_Group_Task && !t.parent_Id && !!(t.name || '').trim() && createdDate >= MIN_DATE;
      const keepQc = !t.is_Deleted && !t.is_Group_Task && !!t.parent_Id && isQcChildTitle(t.name) && createdDate >= MIN_DATE;
      const old = this.tasks.get(t.id);
      if (keep) {
        const next = { ...t, project_Id: p.id, project_Name: p.rawName || p.name, team_Name: p.team };
        if (!old || JSON.stringify(old) !== JSON.stringify(next)) {
          this.tasks.set(t.id, next);
          changed++;
        }
      } else if (old) {
        this.tasks.delete(t.id);
        changed++;
      }
      const oldQc = this.qcTasks.get(t.id);
      if (keepQc) {
        const nextQc = { ...t, project_Id: p.id, project_Name: p.rawName || p.name, team_Name: p.team };
        if (!oldQc || JSON.stringify(oldQc) !== JSON.stringify(nextQc)) {
          this.qcTasks.set(t.id, nextQc);
          changed++;
        }
      } else if (oldQc) {
        this.qcTasks.delete(t.id);
        changed++;
      }
    }
    for (const id of before) {
      if (!now.has(id) && this.tasks.get(id)?.project_Id === p.id) {
        this.tasks.delete(id);
        changed++;
      }
      if (!now.has(id) && this.qcTasks.get(id)?.project_Id === p.id) {
        this.qcTasks.delete(id);
        changed++;
      }
    }
    for (const id of toFetch) {
      if (!fetched.has(id) && this.tasks.has(id)) {
        this.tasks.delete(id);
        changed++;
      }
      if (!fetched.has(id) && this.qcTasks.has(id)) {
        this.qcTasks.delete(id);
        changed++;
      }
    }

    this.seen[p.id] = ids;
    p.version = list.timestamp;
    return changed;
  }

  _mapTaskRow(t) {
    const info = Object.fromEntries((t.additionalInfo || []).map((x) => [x.key, x.value]));
    return {
      id: t.id,
      parentId: t.parent_Id || '',
      title: (t.name || '').replace(/\s+/g, ' ').trim(),
      category: info.type || '',
      createdAt: vnTime(t.created_At),
      url: `https://tasks.haraworks.vn/task/project/${t.project_Id}/${t.id}`,
      live: true,
      status: t.status,
      assignee: t.assignTo?.name || '',
      assigneeId: t.assignTo?.id || '',
      approver: t.approverEntity?.user_Name || '',
      priority: t.priority ?? null,
      projectId: t.project_Id,
      projectName: t.project_Name || t.team_Name || '',
      teamName: t.team_Name || t.project_Name || '',
      customerName: info.customer || '',
      moduleName: info.module || '',
      platform: info.platform || '',
      rootCause: info.rootCause || '',
      type: info.type || '',
      severity: info.priority || '',
      planStartAt: t.plan_Start_At || '',
      planEndAt: t.plan_End_At || '',
      updatedAt: t.status_Updated_At || '',
    };
  }

  toRows() {
    return [...this.tasks.values()].map((t) => this._mapTaskRow(t));
  }

  toQcRows() {
    return [...this.qcTasks.values()].map((t) => this._mapTaskRow(t));
  }

  status() {
    return {
      projects: this.projects.map((p) => ({ id: p.id, name: p.name, team: p.team })),
      lastSyncAt: this.lastSyncAt,
      error: this.error,
      count: this.tasks.size,
      syncing: this.running || this.pending,
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
      const list = c.tasks || c.bugs || [];
      this.tasks = new Map(list.map((b) => [b.id, b]));
      const qcList = c.qcTasks || [];
      this.qcTasks = new Map(qcList.map((b) => [b.id, b]));
      this.seen = c.seen || {};
      if (Array.isArray(c.projects) && c.projects.length) {
        const verMap = new Map(c.projects.map(p => [p.id, p.version || '0']));
        const nameMap = new Map(c.projects.map(p => [p.id, p.rawName || p.name]));
        this.projects = FUNCTION_PROJECTS.map(p => ({
          ...p,
          rawName: nameMap.get(p.id) || p.name,
          version: verMap.get(p.id) || '0',
        }));
      }
      if (c.fieldsVersion !== FIELDS_VERSION) {
        this.seen = {};
        this.projects = FUNCTION_PROJECTS.map(p => ({ ...p, version: '0' }));
      }
      console.log(`[${this.tag}] đã nạp ${this.tasks.size} task function từ lần chạy trước`);
    } catch {
      /* chưa có cache */
    }
  }

  saveCache() {
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      fs.writeFileSync(
        this.cacheFile,
        JSON.stringify({ fieldsVersion: FIELDS_VERSION, projects: this.projects, seen: this.seen, tasks: [...this.tasks.values()], qcTasks: [...this.qcTasks.values()] }),
      );
    } catch (e) {
      console.warn(`[${this.tag}] không ghi được cache:`, e.message);
    }
  }
}

export function toStoreFunctionTasks(rows, modules = []) {
  const byCode = new Map(modules.map((m) => [m.code, m]));
  const aliasMap = new Map();
  modules.forEach(m => {
    aliasMap.set(m.code.toUpperCase(), m.code);
    if (m.name) aliasMap.set(m.name.toUpperCase(), m.code);
  });
  return rows.map((r) => {
    const { rest } = parseTags(r.title);
    let code = rest.find((t) => byCode.has(t)) || '';
    if (!code && r.moduleName) {
      const up = String(r.moduleName).trim().toUpperCase();
      if (byCode.has(up)) code = up;
      else if (aliasMap.has(up)) code = aliasMap.get(up);
    }
    const mod = byCode.get(code);
    return {
      id: r.id,
      t: r.title,
      c: r.category || '',
      d: (r.createdAt || '').slice(0, 16),
      m: code,
      g: mod?.cluster || code,
      how: code ? 'tag' : '',
      u: r.url,
      live: true,
      status: r.status,
      assignee: r.assignee || '',
      assigneeId: r.assigneeId || '',
      approver: r.approver || '',
      priority: r.priority ?? null,
      projectId: r.projectId || '',
      project: r.projectName || '',
      team: r.teamName || '',
      customer: r.customerName || '',
      platform: r.platform || '',
      module_custom: r.moduleName || '',
      classification: r.type || '',
      severity: r.severity || '',
      plan_start_at: r.planStartAt || '',
      plan_end_at: r.planEndAt || '',
      updated: r.updatedAt || '',
    };
  });
}

export function startFunctionLive({ onChange, onQcChange, getModules = () => [] }) {
  let currentCookie = readCookie();
  const baseUrl = process.env.HARAWORKS_BASE_URL || 'https://tasks.haraworks.vn';
  let realtime = currentCookie ? 'connecting' : 'no-cookie';
  let started = false;

  const client = currentCookie ? createClient({ baseUrl, cookie: currentCookie }) : { getProjects: async () => [], getListTask: async () => null, getTasks: async () => [] };
  const live = new FunctionLive(client, {
    pollMs: +(process.env.FUNCTION_POLL_INTERVAL_MS || process.env.BUG_POLL_INTERVAL_MS || 30000),
  });

  const push = () => {
    const mods = getModules();
    onChange(toStoreFunctionTasks(live.toRows(), mods));
    if (onQcChange) onQcChange(toStoreFunctionTasks(live.toQcRows(), mods));
  };
  live.on('change', push);
  push();

  const boot = (c) => {
    started = true;
    realtime = 'connecting';
    live.start();
    startRealtime({
      baseUrl, cookie: c,
      onEvent: (name) => live.trigger(`signalr:${name}`),
      onState: (s) => { realtime = s; },
    }).catch(() => {});
  };

  if (currentCookie) boot(currentCookie);

  return {
    get enabled() { return !!currentCookie; },
    trigger: (why = 'thủ công') => live.trigger(why),
    status: () => ({ ...live.status(), enabled: !!currentCookie, realtime }),
    setCookie: (newCookie) => {
      currentCookie = String(newCookie || '').trim();
      live.client = currentCookie ? createClient({ baseUrl, cookie: currentCookie }) : { getProjects: async () => [], getListTask: async () => null, getTasks: async () => [] };
      live.error = null;
      if (currentCookie) {
        if (!started) boot(currentCookie);
        else live.discover().then(() => live.trigger('cập nhật token')).catch(() => live.trigger('cập nhật token'));
      }
    },
  };
}
