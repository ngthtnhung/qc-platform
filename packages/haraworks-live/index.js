/**
 * Bug realtime từ tasks.haraworks.vn, đưa vào tab "Bug Cũ" của platform.
 *
 * Cookie phiên Haraworks: biến môi trường HARAWORKS_COOKIE hoặc file secrets/haraworks.json {"cookie": "..."}.
 * (thư mục secrets/ đã nằm trong .gitignore; cookie chỉ nằm trên server, không bao giờ trả về giao diện).
 * Thiếu cookie: vẫn chạy bằng bản lưu gần nhất (database/bugs-live.json), chỉ không cập nhật thêm.
 *
 * Tùy chỉnh (biến môi trường, mặc định giống app haraworks-tasks-local):
 *   HARAWORKS_BASE_URL, BUG_PROJECT_PATTERN, BUG_ALL_TASKS_PATTERN, BUG_POLL_INTERVAL_MS
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './client.js';
import { BugLive } from './bug-live.js';
import { startRealtime } from './realtime.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function normalizeCookie(raw) {
  let clean = String(raw || '').replace(/[\r\n]+/g, ' ').trim();
  if (/^cookie\s*:/i.test(clean)) clean = clean.replace(/^cookie\s*:\s*/i, '').trim();
  if (!clean) return '';
  if (/[^\x20-\x7E]/.test(clean)) {
    if (clean.includes('=')) {
      const validParts = clean.split(';').map(s => s.trim()).filter(s => s && !/[^\x20-\x7E]/.test(s));
      clean = validParts.join('; ');
    } else {
      return '';
    }
  }
  return clean;
}

export function readCookie() {
  if (process.env.HARAWORKS_COOKIE?.trim()) return normalizeCookie(process.env.HARAWORKS_COOKIE);
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'secrets', 'haraworks.json'), 'utf8'));
    return normalizeCookie(j.cookie || '');
  } catch { return ''; }
}

export function writeCookie(cookie) {
  const clean = normalizeCookie(cookie);
  if (!clean) throw new Error('Token/Cookie không hợp lệ (chứa ký tự tiếng Việt hoặc ký tự đặc biệt). Vui lòng copy đúng giá trị Cookie trong DevTools (F12 → Network → Request Headers → Cookie).');
  const file = path.join(ROOT, 'secrets', 'haraworks.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ cookie: clean }, null, 2), 'utf8');
  process.env.HARAWORKS_COOKIE = clean;
  return clean;
}

const normTag = (t) => t.trim().toUpperCase().replace(/['’\s]/g, '');

/** "[BUG][HRM][SCF] mô tả" -> { kind: 'Bug', tags: ['HRM', 'SCF'] } */
export function parseTags(title) {
  let s = String(title || '').replace(/\s+/g, ' ').trim();
  const tags = [];
  let m;
  while ((m = s.match(/^\s*\[([^\]]{1,40})\]\s*/))) { tags.push(m[1].trim()); s = s.slice(m[0].length); }
  const kindIdx = tags.findIndex((t) => /^(bug|iss\w*)$/i.test(t));
  const rest = tags.filter((_, i) => i !== kindIdx).map(normTag);
  return { rest };
}

/** Dòng realtime -> cùng dạng với bug trong database/bugs.json (id, t, c, d, m, g, u) + thông tin trạng thái */
export function toStoreBugs(rows, modules = []) {
  const byCode = new Map(modules.map((m) => [m.code, m]));
  return rows.map((r) => {
    const { rest } = parseTags(r.title);
    const code = rest.find((t) => byCode.has(t)) || '';
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
      project: r.projectName || '',
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

/**
 * @param onChange  gọi (rows) mỗi khi danh sách bug thay đổi
 * @returns { status(), trigger(), enabled }
 */
export function startBugLive({ onChange, getModules = () => [] }) {
  let currentCookie = readCookie();
  const baseUrl = process.env.HARAWORKS_BASE_URL || 'https://tasks.haraworks.vn';
  let realtime = currentCookie ? 'connecting' : 'no-cookie';
  let started = false;

  const client = currentCookie ? createClient({ baseUrl, cookie: currentCookie }) : { getProjects: async () => [], getListTask: async () => null, getTasks: async () => [] };
  const live = new BugLive(client, {
    pattern: process.env.BUG_PROJECT_PATTERN || '-\\s*empty$|^ODOO BUG PRODUCTION$',
    allTasksPattern: process.env.BUG_ALL_TASKS_PATTERN || '^ODOO BUG PRODUCTION$',
    pollMs: +(process.env.BUG_POLL_INTERVAL_MS || 30000),
  });

  const push = () => onChange(toStoreBugs(live.toRows(), getModules()));
  live.on('change', push);
  push(); // dữ liệu lưu từ lần trước dùng được ngay

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

  if (!currentCookie) {
    console.warn('[haraworks-live] chưa có cookie Haraworks (HARAWORKS_COOKIE hoặc secrets/haraworks.json): dùng bản lưu gần nhất, không cập nhật realtime.');
  } else {
    boot(currentCookie);
  }

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
