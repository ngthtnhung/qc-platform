/**
 * Tìm bug cũ và rule liên quan từ một mô tả bằng từ khóa (không dùng mô hình ngôn ngữ).
 * Chấm điểm kiểu TF-IDF trên từ đơn và cặp từ liền kề, bỏ dấu để gõ không dấu cũng tìm được.
 *
 * Dữ liệu bug: database/bugs.json (xuất từ file data/bugs.json của Kho Business Rule).
 * Ghi chú bug (bug_notes: nguyên nhân, cách sửa, rule liên quan) là tùy chọn: database/bug_notes.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BusinessRuleStore } from '../../services/ai-service/business-rule-store.js';

const DB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../database');
const BUGS_FILE = path.join(DB_DIR, 'bugs.json');
const NOTES_FILE = path.join(DB_DIR, 'bug_notes.json');
// Người duyệt lấy tạm (khi server chưa có cookie Haraworks): {names: [...], map: {mãBug: chỉ số tên}}
const ENRICH_FILE = path.join(DB_DIR, 'bugs-enrich.json');

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
// Từ quá phổ biến trong mô tả lỗi tiếng Việt, không giúp phân biệt
const STOP = new Set(('va la cua khi khong bi co duoc cho trong cac mot nhung nay nhung thi o da se voi de loi bug issue ' +
  'tren duoi ra vao sau truoc khach hang nguoi dung he thong tai khoan thao tac man hinh nhan bam').split(/\s+/));
const tokens = s => fold(s).split(/[^a-z0-9]+/).filter(t => t.length > 1 && !STOP.has(t));
const grams = toks => { const g = new Set(toks); for (let i = 0; i < toks.length - 1; i++) g.add(toks[i] + '_' + toks[i + 1]); return g; };

// Bug realtime từ Haraworks (packages/haraworks-live): giữ riêng, không gộp hay đè bug cũ
let liveBugs = [];
let liveRev = 0;
let liveAt = null;

let cache = { mtime: 0, bugs: null, meta: null, df: null, tok: null, notes: new Map() };

function load() {
  const hasFile = fs.existsSync(BUGS_FILE);
  const mtime = (hasFile ? fs.statSync(BUGS_FILE).mtimeMs : 0) + (fs.existsSync(NOTES_FILE) ? fs.statSync(NOTES_FILE).mtimeMs : 0) + (fs.existsSync(ENRICH_FILE) ? fs.statSync(ENRICH_FILE).mtimeMs : 0) + liveRev;
  if (cache.bugs && cache.mtime === mtime) return cache;
  const raw = hasFile ? JSON.parse(fs.readFileSync(BUGS_FILE, 'utf8')) : { bugs: [] };
  // Bug cũ + bug realtime lưu TÁCH nhau, trùng cũng không gộp (bug realtime có cờ live)
  let enrich = null;
  try { enrich = fs.existsSync(ENRICH_FILE) ? JSON.parse(fs.readFileSync(ENRICH_FILE, 'utf8')) : null; } catch { enrich = null; }
  const live = enrich ? liveBugs.map(b => (!b.approver && enrich.map?.[b.id] != null && enrich.names?.[enrich.map[b.id]] ? { ...b, approver: enrich.names[enrich.map[b.id]] } : b)) : liveBugs;
  const bugs = [...(raw.bugs || []), ...live];
  const tok = bugs.map(b => grams(tokens(b.t)));
  const df = new Map();
  tok.forEach(set => set.forEach(g => df.set(g, (df.get(g) || 0) + 1)));
  const notes = new Map();
  if (fs.existsSync(NOTES_FILE)) JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8')).forEach(n => notes.set(String(n.task_id || n.id), n));
  const { source, count, range, synced_at, revision } = raw;
  const dates = bugs.map(b => b.d).filter(Boolean).sort();
  const liveInfo = live.length ? { live: true, live_count: live.length, live_at: liveAt } : { live: false };
  return cache = { mtime, bugs, meta: { source, count: bugs.length || count, range: dates.length ? [dates[0], dates[dates.length - 1]] : range, synced_at: synced_at || null, revision: revision || 0, ...liveInfo }, df, tok, notes };
}

const idf = (df, n, g) => Math.log(1 + n / (1 + (df.get(g) || 0)));

/** Thành viên của một module: module cụm (DV5S) gồm cả MAINT, SCM, IOT */
export function moduleMembers(code) {
  if (!code) return null;
  const mods = BusinessRuleStore.load().modules || [];
  const set = new Set([code]);
  mods.forEach(m => { if (m.cluster === code) set.add(m.code); });
  const own = mods.find(m => m.code === code);
  if (own?.cluster) set.add(own.cluster);
  return set;
}

import { CLOSED_STATUS, statusLabel, priorityLabel, priorityRank, todayVN } from './codes.js';
export { CLOSED_STATUS };

// Tên module (mã -> tên) cho cột module, nhớ tạm 60 giây
let modNames = { at: 0, map: new Map() };
function moduleName(code) {
  if (!code) return '';
  if (Date.now() - modNames.at > 60000) { modNames = { at: Date.now(), map: new Map((BusinessRuleStore.load().modules || []).map(m => [m.code, m.name])) }; }
  return modNames.map.get(code) || '';
}

/** Mốc "bug mới": tạo trong vòng N ngày gần đây (so chuỗi ngày dạng YYYY-MM-DD) */
export const NEW_DAYS = 30;
export function newCutoff(days = NEW_DAYS) {
  const d = new Date(Date.now() - days * 86400000), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const ageOk = (b, age, cut) => (age !== 'new' && age !== 'old') || (age === 'new' ? String(b.d || '') >= cut : !!b.d && String(b.d) < cut);
function fnAgeOk(b, age) {
  if (!age) return true;
  const d = String(b.d || '').slice(0, 10);
  if (!d) return false;
  const today = todayVN();
  if (age === 'week') {
    const dt = new Date(today + 'T00:00:00+07:00');
    const day = (dt.getDay() + 6) % 7; // Thứ 2 = 0
    dt.setDate(dt.getDate() - day);
    const weekStart = todayVN(dt.getTime());
    return d >= weekStart;
  }
  if (age === 'month') return d >= today.slice(0, 7) + '-01';
  if (/^year_(\d{4})$/.test(age)) return d.startsWith(age.slice(5));
  if (age === 'new' || age === 'old') return ageOk(b, age, newCutoff());
  return true;
}

export const BugStore = {
  meta() { return load().meta; },

  /** Nhận bộ bug realtime mới (toàn bộ, không phải phần thay đổi). Tăng bản để tự dựng lại chỉ mục tìm kiếm. */
  setLive(arr) {
    liveBugs = Array.isArray(arr) ? arr : [];
    liveRev += 1;
    liveAt = new Date().toISOString();
    return liveRev;
  },
  liveRevision() { return liveRev; },

  /** Ghi bộ bug mới do quản trị đẩy lên */
  replace({ bugs, source, count, range }, notes) {
    if (!bugs || !Array.isArray(bugs.bugs || bugs)) throw new Error('Danh sách bug không hợp lệ');
    const arr = bugs.bugs || bugs;
    if (!arr.length || !arr.every(b => b && b.id && b.t)) throw new Error('Bug thiếu id hoặc tiêu đề (t)');
    const prev = load().meta;
    const out = { source: source || bugs.source || '', count: arr.length, range: range || bugs.range || [], synced_at: new Date().toISOString(), revision: (prev.revision || 0) + 1, bugs: arr };
    fs.writeFileSync(BUGS_FILE + '.tmp', JSON.stringify(out));
    fs.renameSync(BUGS_FILE + '.tmp', BUGS_FILE);
    if (Array.isArray(notes)) { fs.writeFileSync(NOTES_FILE, JSON.stringify(notes)); }
    cache.mtime = 0;
    return { revision: out.revision, count: out.count, range: out.range, synced_at: out.synced_at };
  },

  /** Danh sách có lọc. q để trống: mới nhất trước; có q: xếp theo độ giống. */
  list({ module, project = '', q = '', category = '', year = '', unknown = false, status = '', assignee = '', approver = '', closed = '', age = '', sort = 'created', live = false, offset = 0, limit = 50 } = {}) {
    const c = load();
    const members = moduleMembers(module), cut = newCutoff();
    const qg = grams(tokens(q));
    let items = [];
    for (let i = 0; i < c.bugs.length; i++) {
      const b = c.bugs[i];
      if (project && (b.project || '') !== project) continue;
      if (members && !members.has(b.m)) continue;
      if (unknown && b.m) continue;
      if (category && (b.c || '(chưa phân loại)') !== category) continue;
      if (year && !String(b.d || '').startsWith(year)) continue;
      if (!ageOk(b, age, cut)) continue;
      if (live && !b.live) continue;
      if (status !== '' && String(b.status) !== String(status)) continue;
      if (assignee && (b.assignee || '') !== assignee) continue;
      if (approver === '__none__' ? (!b.live || b.approver) : (approver && (b.approver || '') !== approver)) continue;
      if (closed === 'open' && (!b.live || CLOSED_STATUS.has(b.status))) continue;
      if (closed === 'closed' && !(b.live && CLOSED_STATUS.has(b.status))) continue;
      let score = 0;
      if (qg.size) {
        for (const g of qg) if (c.tok[i].has(g)) score += idf(c.df, c.bugs.length, g) * (g.includes('_') ? 2 : 1);
        if (!score) continue;
      }
      items.push({ b, score });
    }
    if (qg.size) items.sort((x, y) => y.score - x.score || String(y.b.d).localeCompare(String(x.b.d)));
    else if (sort === 'updated') items.sort((x, y) => String(y.b.updated || y.b.d).localeCompare(String(x.b.updated || x.b.d)));
    else if (sort === 'priority') items.sort((x, y) => priorityRank(x.b.priority) - priorityRank(y.b.priority) || String(y.b.d).localeCompare(String(x.b.d)));
    else items.sort((x, y) => String(y.b.d).localeCompare(String(x.b.d)));
    const total = items.length;
    const page = items.slice(offset, offset + limit).map(({ b, score }) => present(b, c, score));
    return { total, items: page, meta: c.meta };
  },

  facets() {
    const c = load();
    const cat = {}, years = {}, mods = {};
    c.bugs.forEach(b => { const k = b.c || '(chưa phân loại)'; cat[k] = (cat[k] || 0) + 1; const y = String(b.d || '').slice(0, 4); if (y) years[y] = (years[y] || 0) + 1; const m = b.m || ''; mods[m] = (mods[m] || 0) + 1; });
    const statuses = {}, assignees = {}, approvers = {}, projects = {};
    c.bugs.forEach(b => {
      if (!b.live) return;
      statuses[b.status] = (statuses[b.status] || 0) + 1;
      if (b.assignee) assignees[b.assignee] = (assignees[b.assignee] || 0) + 1;
      if (b.approver) approvers[b.approver] = (approvers[b.approver] || 0) + 1;
      if (b.project) projects[b.project] = (projects[b.project] || 0) + 1;
    });
    const unknown = c.bugs.filter(b => !b.m).length;
    return { categories: cat, years, modules: mods, statuses, assignees, approvers, projects, unknown };
  },

  /** Bug cũ giống mô tả nhất */
  similar(text, module = '', limit = 10, age = '') {
    const c = load(), cut = newCutoff();
    const qg = grams(tokens(text));
    if (!qg.size) return [];
    const members = moduleMembers(module);
    const out = [];
    for (let i = 0; i < c.bugs.length; i++) {
      const b = c.bugs[i];
      let score = 0;
      for (const g of qg) if (c.tok[i].has(g)) score += idf(c.df, c.bugs.length, g) * (g.includes('_') ? 2 : 1);
      if (!score) continue;
      if (members && !members.has(b.m)) continue;
      if (!ageOk(b, age, cut)) continue;
      out.push({ b, score });
    }
    out.sort((x, y) => y.score - x.score || String(y.b.d).localeCompare(String(x.b.d)));
    return out.slice(0, limit).map(({ b, score }) => present(b, c, score));
  }
};

function present(b, c, score) {
  const n = c.notes.get(String(b.id));
  return { id: b.id, title: b.t, category: b.c || '', date: b.d, is_new: String(b.d || '') >= newCutoff(), is_today: String(b.d || '').startsWith(todayVN()), module_name: moduleName(b.m), module: b.m || '', url: b.u, score: Math.round(score * 10) / 10,
    ...(b.live ? {
      live: true, status: b.status, status_label: statusLabel(b.status), priority: b.priority ?? null, priority_label: priorityLabel(b.priority),
      closed: CLOSED_STATUS.has(b.status), assignee: b.assignee || '', assigneeId: b.assigneeId || '', approver: b.approver || '', project: b.project || '',
      customer: b.customer || '', platform: b.platform || '', module_custom: b.module_custom || '', classification: b.classification || '', severity: b.severity || '',
      plan_start_at: b.plan_start_at || '', plan_end_at: b.plan_end_at || '', updated: b.updated || ''
    } : {}),
    note: n ? { root_cause: n.root_cause || '', fix: n.fix || '', rule_ids: n.rule_ids || [], comments: n.comments || '' } : null };
}

/** Tìm rule đã xác nhận giống mô tả nhất (cùng cách chấm điểm) */
export function similarRules(text, module = '', limit = 8) {
  const data = BusinessRuleStore.load();
  const qg = grams(tokens(text));
  if (!qg.size) return { rules: [], artifact_url: data.artifact_url };
  const members = moduleMembers(module);
  const docs = data.rules.map(r => ({ r, g: grams(tokens([r.title, r.title, r.description, r.flow_name, r.menu].join(' '))) }));
  const df = new Map();
  docs.forEach(d => d.g.forEach(g => df.set(g, (df.get(g) || 0) + 1)));
  const out = [];
  for (const d of docs) {
    if (members && !members.has(d.r.module) && !(d.r.source_modules || []).some(m => members.has(m))) continue;
    let score = 0;
    for (const g of qg) if (d.g.has(g)) score += idf(df, docs.length, g) * (g.includes('_') ? 2 : 1);
    if (score) out.push({ r: d.r, score });
  }
  out.sort((a, b) => b.score - a.score);
  return {
    artifact_url: data.artifact_url,
    rules: out.slice(0, limit).map(({ r, score }) => ({
      rule_id: r.rule_id, version: r.version, state: r.state || 'active', title: r.title, flow: r.flow_name, menu: r.menu, module: r.module, roles: r.user_roles || [],
      description: r.description, local: r.local || '', score: Math.round(score * 10) / 10, url: r.local === 'created' ? '' : `${data.artifact_url}#rule-${r.rule_id}`
    }))
  };
}

/** Đoán module từ các bug giống nhất (đa số) */
export function guessModule(text) {
  const top = BugStore.similar(text, '', 15).filter(b => b.module);
  if (!top.length) return '';
  const w = {};
  top.forEach(b => { w[b.module] = (w[b.module] || 0) + b.score; });
  const [code] = Object.entries(w).sort((a, b) => b[1] - a[1])[0];
  const mods = BusinessRuleStore.load().modules || [];
  return mods.find(m => m.code === code)?.cluster || code;
}

// ==========================================
// Kho Task Function Realtime (4 dự án Team trên Haraworks từ 01/01/2024)
// ==========================================
let liveFunctions = [];
let liveQcFunctions = [];
let fnRev = 0;
let fnAt = null;
let fnCache = { rev: -1, items: [], tok: [], df: new Map(), byId: new Map(), byTitle: new Map(), meta: null };

const cleanFnTitle = (s) => {
  let x = String(s || '');
  const idx = x.indexOf('BUILD PRODUCTION -');
  if (idx !== -1) x = x.slice(idx + 'BUILD PRODUCTION -'.length);
  x = x.replace(/^\s*(?:\[[^\]]{1,40}\]\s*)+/, '');
  return fold(x).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
};

function loadFunctions() {
  if (fnCache.rev === fnRev && fnCache.items) return fnCache;
  const items = liveFunctions.filter(t => String(t.d || '') >= '2024-01-01');
  const tok = items.map(b => grams(tokens(b.t)));
  const df = new Map();
  const byId = new Map();
  const byTitle = new Map();
  items.forEach((b, i) => {
    tok[i].forEach(g => df.set(g, (df.get(g) || 0) + 1));
    if (b.id) byId.set(String(b.id).toLowerCase(), b);
    const ct = cleanFnTitle(b.t);
    if (ct && ct.length >= 6 && !byTitle.has(ct)) byTitle.set(ct, b);
  });
  const dates = items.map(b => b.d).filter(Boolean).sort();
  const meta = {
    count: items.length,
    range: dates.length ? [dates[0], dates[dates.length - 1]] : [],
    synced_at: fnAt,
    revision: fnRev,
    live: items.length > 0,
    live_count: items.length,
    live_at: fnAt
  };
  return fnCache = { rev: fnRev, items, tok, df, byId, byTitle, meta };
}

function presentFunction(b, score) {
  return {
    id: b.id, title: b.t, category: b.c || '', date: b.d,
    is_new: String(b.d || '') >= newCutoff(),
    is_today: String(b.d || '').startsWith(todayVN()),
    module_name: moduleName(b.m), module: b.m || '', url: b.u,
    score: Math.round(score * 10) / 10,
    live: true, status: b.status, status_label: statusLabel(b.status),
    priority: b.priority ?? null, priority_label: priorityLabel(b.priority),
    closed: CLOSED_STATUS.has(b.status),
    assignee: b.assignee || '', assigneeId: b.assigneeId || '', approver: b.approver || '',
    projectId: b.projectId || '', project: b.project || '', team: b.team || b.project || '',
    customer: b.customer || '', platform: b.platform || '', module_custom: b.module_custom || '', classification: b.classification || '', severity: b.severity || '',
    plan_start_at: b.plan_start_at || '', plan_end_at: b.plan_end_at || '', updated: b.updated || ''
  };
}

export const FunctionStore = {
  meta() { return loadFunctions().meta; },
  setLive(arr) {
    liveFunctions = Array.isArray(arr) ? arr : [];
    fnRev += 1;
    fnAt = new Date().toISOString();
    return fnRev;
  },
  setQcLive(arr) {
    liveQcFunctions = Array.isArray(arr) ? arr : [];
    return liveQcFunctions.length;
  },
  listQc() {
    return liveQcFunctions.map(b => presentFunction(b, 0));
  },
  liveRevision() { return fnRev; },
  list({ team = '', projectId = '', module = '', q = '', category = '', year = '', unknown = false, status = '', assignee = '', approver = '', closed = '', age = '', sort = 'created', offset = 0, limit = 50 } = {}) {
    const c = loadFunctions();
    const members = moduleMembers(module), cut = newCutoff();
    const qg = grams(tokens(q));
    let items = [];
    for (let i = 0; i < c.items.length; i++) {
      const b = c.items[i];
      if (team && b.team !== team && b.projectId !== team && b.project !== team) continue;
      if (projectId && b.projectId !== projectId) continue;
      if (members && !members.has(b.m)) continue;
      if (unknown && b.m) continue;
      if (category && (b.c || '(chưa phân loại)') !== category) continue;
      if (year && !String(b.d || '').startsWith(year)) continue;
      if (!fnAgeOk(b, age)) continue;
      if (status !== '' && String(b.status) !== String(status)) continue;
      if (assignee && (b.assignee || '') !== assignee) continue;
      if (approver === '__none__' ? !!b.approver : (approver && (b.approver || '') !== approver)) continue;
      if (closed === 'open' && CLOSED_STATUS.has(b.status)) continue;
      if (closed === 'closed' && !CLOSED_STATUS.has(b.status)) continue;
      let score = 0;
      if (qg.size) {
        for (const g of qg) if (c.tok[i].has(g)) score += idf(c.df, c.items.length, g) * (g.includes('_') ? 2 : 1);
        if (!score) continue;
      }
      items.push({ b, score });
    }
    if (qg.size) items.sort((x, y) => y.score - x.score || String(y.b.d).localeCompare(String(x.b.d)));
    else if (sort === 'updated') items.sort((x, y) => String(y.b.updated || y.b.d).localeCompare(String(x.b.updated || x.b.d)));
    else if (sort === 'priority') items.sort((x, y) => priorityRank(x.b.priority) - priorityRank(y.b.priority) || String(y.b.d).localeCompare(String(x.b.d)));
    else items.sort((x, y) => String(y.b.d).localeCompare(String(x.b.d)));
    const total = items.length;
    const page = items.slice(offset, offset + limit).map(({ b, score }) => presentFunction(b, score));
    return { total, items: page, meta: c.meta };
  },
  facets() {
    const c = loadFunctions();
    const cat = {}, years = {}, mods = {}, teams = {}, statuses = {}, assignees = {}, approvers = {};
    c.items.forEach(b => {
      const k = b.c || '(chưa phân loại)'; cat[k] = (cat[k] || 0) + 1;
      const y = String(b.d || '').slice(0, 4); if (y) years[y] = (years[y] || 0) + 1;
      const m = b.m || ''; mods[m] = (mods[m] || 0) + 1;
      const tm = b.team || b.project || ''; if (tm) teams[tm] = (teams[tm] || 0) + 1;
      statuses[b.status] = (statuses[b.status] || 0) + 1;
      if (b.assignee) assignees[b.assignee] = (assignees[b.assignee] || 0) + 1;
      if (b.approver) approvers[b.approver] = (approvers[b.approver] || 0) + 1;
    });
    const unknown = c.items.filter(b => !b.m).length;
    return { teams, categories: cat, years, modules: mods, statuses, assignees, approvers, unknown };
  },
  similar(text, module = '', limit = 10, age = '') {
    const c = loadFunctions(), cut = newCutoff();
    const qg = grams(tokens(text));
    if (!qg.size) return [];
    const members = moduleMembers(module);
    const out = [];
    for (let i = 0; i < c.items.length; i++) {
      const b = c.items[i];
      let score = 0;
      for (const g of qg) if (c.tok[i].has(g)) score += idf(c.df, c.items.length, g) * (g.includes('_') ? 2 : 1);
      if (!score) continue;
      if (members && !members.has(b.m)) continue;
      if (!ageOk(b, age, cut)) continue;
      out.push({ b, score });
    }
    out.sort((x, y) => y.score - x.score || String(y.b.d).localeCompare(String(x.b.d)));
    return out.slice(0, limit).map(({ b, score }) => presentFunction(b, score));
  },
  findSource({ ids = [], title = '', sourceTitle = '', selfId = '' } = {}) {
    const c = loadFunctions();
    const selfLow = String(selfId || '').toLowerCase();
    for (const id of ids || []) {
      const k = String(id || '').toLowerCase();
      if (!k || k === selfLow) continue;
      const hit = c.byId.get(k);
      if (hit) return { id: hit.id, title: hit.t, team: hit.team || hit.project || '', url: hit.u };
    }
    const ct = cleanFnTitle(sourceTitle || title);
    if (ct && ct.length >= 6) {
      const hit = c.byTitle.get(ct);
      if (hit) return { id: hit.id, title: hit.t, team: hit.team || hit.project || '', url: hit.u };
    }
    return null;
  }
};
