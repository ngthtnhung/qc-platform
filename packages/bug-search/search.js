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

/** Trạng thái đóng của bug realtime: 5 Hoàn thành, 11 Không thực hiện (suy ra từ tên trạng thái, cần QC xác nhận) */
export const CLOSED_STATUS = new Set([5, 11]);

/** Mốc "bug mới": tạo trong vòng N ngày gần đây (so chuỗi ngày dạng YYYY-MM-DD) */
export const NEW_DAYS = 30;
export function newCutoff(days = NEW_DAYS) {
  const d = new Date(Date.now() - days * 86400000), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const ageOk = (b, age, cut) => (age !== 'new' && age !== 'old') || (age === 'new' ? String(b.d || '') >= cut : !!b.d && String(b.d) < cut);

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
  list({ module, q = '', category = '', year = '', unknown = false, status = '', assignee = '', approver = '', closed = '', age = '', offset = 0, limit = 50 } = {}) {
    const c = load();
    const members = moduleMembers(module), cut = newCutoff();
    const qg = grams(tokens(q));
    let items = [];
    for (let i = 0; i < c.bugs.length; i++) {
      const b = c.bugs[i];
      if (members && !members.has(b.m)) continue;
      if (unknown && b.m) continue;
      if (category && (b.c || '(chưa phân loại)') !== category) continue;
      if (year && !String(b.d || '').startsWith(year)) continue;
      if (!ageOk(b, age, cut)) continue;
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
    else items.sort((x, y) => String(y.b.d).localeCompare(String(x.b.d)));
    const total = items.length;
    const page = items.slice(offset, offset + limit).map(({ b, score }) => present(b, c, score));
    return { total, items: page, meta: c.meta };
  },

  facets() {
    const c = load();
    const cat = {}, years = {}, mods = {};
    c.bugs.forEach(b => { const k = b.c || '(chưa phân loại)'; cat[k] = (cat[k] || 0) + 1; const y = String(b.d || '').slice(0, 4); if (y) years[y] = (years[y] || 0) + 1; const m = b.m || ''; mods[m] = (mods[m] || 0) + 1; });
    const statuses = {}, assignees = {}, approvers = {};
    c.bugs.forEach(b => { if (!b.live) return; statuses[b.status] = (statuses[b.status] || 0) + 1; if (b.assignee) assignees[b.assignee] = (assignees[b.assignee] || 0) + 1; if (b.approver) approvers[b.approver] = (approvers[b.approver] || 0) + 1; });
    const unknown = c.bugs.filter(b => !b.m).length;
    return { categories: cat, years, modules: mods, statuses, assignees, approvers, unknown };
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
  return { id: b.id, title: b.t, category: b.c || '', date: b.d, is_new: String(b.d || '') >= newCutoff(), module: b.m || '', url: b.u, score: Math.round(score * 10) / 10,
    ...(b.live ? { live: true, status: b.status, closed: CLOSED_STATUS.has(b.status), assignee: b.assignee || '', approver: b.approver || '', project: b.project || '', customer: b.customer || '', updated: b.updated || '' } : {}),
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
