/**
 * Business Rule Store.
 *
 * Gồm hai lớp dữ liệu:
 *  - Lớp gốc: database/business_rules.json, đồng bộ từ "Kho Business Rule Haraworks" (artifact). Mỗi lần đồng bộ ghi đè lớp này.
 *  - Lớp chỉnh sửa trên platform: database/business_rules_local.json, lưu rule do người dùng thêm, sửa, xóa ngay trên platform.
 *    Đồng bộ từ artifact KHÔNG đụng tới lớp này, nên chỉnh sửa không bị mất. Lớp này không tự ghi ngược về artifact.
 * load() trả về bản đã gộp cho API, tab web, RAG và tìm kiếm.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../database');
const FILE = path.join(DB, 'business_rules.json');
const LOCAL_FILE = path.join(DB, 'business_rules_local.json');

// Module của platform -> mã module trong kho rule (MAINT, IOT, SCM thuộc cụm DV5S)
export const MODULE_MAP = { mod_maint: 'MAINT', mod_iot: 'IOT', mod_scm: 'SCM', mod_sales: 'SAL', mod_inv: 'SCM' };
export const SETTING_TYPES = { fixed: 'Cố định', org_config: 'Cấu hình theo tổ chức', default_editable: 'Mặc định có thể đổi', unknown: 'Chưa xác định' };

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
const atomicWrite = (file, data) => { fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2)); fs.renameSync(file + '.tmp', file); };

export class BusinessRuleStore {
  static #asArr(v) {
    return Array.isArray(v) ? v : (v == null || v === '' ? [] : [String(v)]);
  }

  static #normalizeRule(r) {
    if (!r || typeof r !== 'object') return r;
    return {
      ...r,
      user_roles: this.#asArr(r.user_roles),
      source_modules: this.#asArr(r.source_modules),
      related_rules: this.#asArr(r.related_rules),
      open_questions: this.#asArr(r.open_questions)
    };
  }

  static loadBase() {
    if (!fs.existsSync(FILE)) return { synced_at: null, artifact_url: '', modules: [], rules: [] };
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    d.rules = (Array.isArray(d.rules) ? d.rules : []).map(r => this.#normalizeRule(r));
    d.modules = (Array.isArray(d.modules) ? d.modules : []).map(m => ({ ...m, flows: Array.isArray(m.flows) ? m.flows : (m.flows ? [m.flows] : []) }));
    if (!d.modules.some(m => m.code === 'CORE')) {
      d.modules.push({ code: 'CORE', name: 'CORE', flows: [] });
      d.modules.sort((a, b) => String(a.code).localeCompare(String(b.code)));
    }
    return d;
  }

  static loadLocal() {
    if (!fs.existsSync(LOCAL_FILE)) return { rev: 0, changes: {} };
    return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
  }

  /** Bản đã gộp: rule gốc, trừ những rule có chỉnh sửa trên platform (thay thế hoặc ẩn) */
  static load() {
    const base = this.loadBase();
    const local = this.loadLocal();
    const ids = Object.keys(local.changes);
    const baseIds = new Set(base.rules.map(r => r.rule_id));
    const rules = base.rules.filter(r => !local.changes[r.rule_id]);
    for (const id of ids) {
      const c = local.changes[id];
      if (c.op === 'upsert') rules.push({ ...c.rule, local: baseIds.has(id) ? 'edited' : 'created' });
    }
    rules.sort((a, b) => a.rule_id.localeCompare(b.rule_id) || (a.version || 0) - (b.version || 0));
    return { ...base, revision: `${base.revision || 0}.${local.rev || 0}`, local_rev: local.rev || 0, rules };
  }

  static meta() {
    const d = this.load();
    return { revision: d.revision, synced_at: d.synced_at, count: d.rules.length };
  }

  /** Ghi bộ rule gốc mới do quản trị đẩy lên; lớp chỉnh sửa trên platform được giữ nguyên */
  static replace({ rules, modules, artifact_url }) {
    if (!Array.isArray(rules) || !rules.length) throw new Error('Danh sách rule trống');
    if (!rules.every(r => r && r.rule_id && r.title && r.module)) throw new Error('Rule thiếu rule_id, title hoặc module');
    const prev = this.loadBase();
    const next = { revision: (prev.revision || 0) + 1, synced_at: new Date().toISOString(),
      artifact_url: artifact_url || prev.artifact_url, modules: modules || prev.modules, rules };
    atomicWrite(FILE, next);
    return { revision: next.revision, synced_at: next.synced_at, count: rules.length };
  }

  // ------------------------------------------------------------------ chỉnh sửa trên platform
  static #clean(input, base, { creating }) {
    const errors = [];
    const out = {};
    const title = String(input.title || '').trim();
    if (!title) errors.push('Thiếu tên rule'); else if (title.length > 200) errors.push('Tên rule tối đa 200 ký tự');
    out.title = title;
    const description = String(input.description || '').trim();
    if (!description) errors.push('Thiếu mô tả chi tiết'); else if (description.length > 3000) errors.push('Mô tả tối đa 3000 ký tự');
    out.description = description;
    const roles = (Array.isArray(input.user_roles) ? input.user_roles : String(input.user_roles || '').split('\n'))
      .map(x => String(x).trim()).filter(Boolean);
    if (!roles.length) errors.push('Cần ít nhất một vai trò tương ứng');
    out.user_roles = roles.slice(0, 20);
    const st = input.setting_type || 'unknown';
    if (!SETTING_TYPES[st]) errors.push('Loại thiết lập không hợp lệ');
    out.setting_type = st; out.setting_label = SETTING_TYPES[st] || '';
    if (creating) {
      const mod = (base.modules || []).find(m => m.code === input.module);
      if (!mod) errors.push('Module không hợp lệ'); else out.module = mod.code;
    }
    const modCode = creating ? out.module : input.module;
    const mod = (base.modules || []).find(m => m.code === modCode);
    const fl = (mod?.flows || []).find(f => f.code === input.flow);
    if (input.flow && !fl) errors.push('Luồng không thuộc module này');
    out.flow = fl ? fl.code : '';
    out.flow_name = fl ? fl.name : '';
    out.menu = fl ? fl.menu : '';
    return { errors, out };
  }

  static #save(local) { local.rev = (local.rev || 0) + 1; atomicWrite(LOCAL_FILE, local); }

  static createLocal(user, input) {
    const base = this.loadBase();
    const { errors, out } = this.#clean(input, base, { creating: true });
    if (errors.length) throw new Error(errors.join('; '));
    const merged = this.load();
    // mã P001... riêng cho rule tạo trên platform, không trùng mã Kho cấp
    let n = 0;
    merged.rules.forEach(r => { const m = new RegExp('^' + out.module + '-P(\\d+)$').exec(r.rule_id); if (m) n = Math.max(n, +m[1]); });
    const rule_id = `${out.module}-P${String(n + 1).padStart(3, '0')}`;
    const now = new Date().toISOString();
    const rule = { ...out, rule_id, version: 1, state: 'active', origin: 'platform', source_modules: [], classification: 'Platform', config_path: '', related_rules: [],
      source: {}, created_by: user.display_name || user.id, created_at: now, edited_by: user.display_name || user.id, edited_at: now };
    const local = this.loadLocal();
    local.changes[rule_id] = { op: 'upsert', rule, by: user.id, at: now };
    this.#save(local);
    return rule;
  }

  static editLocal(user, id, input) {
    const merged = this.load();
    const current = merged.rules.filter(r => r.rule_id === id).sort((a, b) => (b.version || 0) - (a.version || 0))[0];
    if (!current) throw new Error('Không thấy rule');
    const { errors, out } = this.#clean({ ...input, module: current.module }, this.loadBase(), { creating: false });
    if (errors.length) throw new Error(errors.join('; '));
    const now = new Date().toISOString();
    const maxVer = Math.max(...merged.rules.filter(r => r.rule_id === id).map(r => r.version || 1));
    const { local: _l, analysis: _a, ...keep } = current;
    // người dùng sửa trên platform: thành rule đang áp dụng, bản mới hơn
    const rule = { ...keep, ...out, version: maxVer + 1, state: 'active', origin: 'platform', edited_by: user.display_name || user.id, edited_at: now };
    const local = this.loadLocal();
    local.changes[id] = { op: 'upsert', rule, by: user.id, at: now };
    this.#save(local);
    return rule;
  }

  static deleteLocal(user, id) {
    const merged = this.load();
    if (!merged.rules.some(r => r.rule_id === id)) throw new Error('Không thấy rule');
    const local = this.loadLocal();
    const base = this.loadBase();
    if (base.rules.some(r => r.rule_id === id)) local.changes[id] = { op: 'delete', by: user.id, at: new Date().toISOString() };
    else delete local.changes[id]; // rule tạo trên platform: xóa hẳn
    this.#save(local);
  }

  // ------------------------------------------------------------------ đọc và tìm
  static #matchesModule(rule, mod, modules = []) {
    if (!mod) return true;
    if (rule.module === mod) return true;
    const modDef = modules.find(m => m.code === mod);
    // Khi lọc theo module thành viên (MAINT, IOT, SCM), lấy cả rule dùng chung ở cụm (DV5S) áp dụng cho module đó
    if (modDef?.cluster && rule.module === modDef.cluster) {
      const src = Array.isArray(rule.source_modules) ? rule.source_modules : [];
      return src.length === 0 || src.includes(mod);
    }
    // Khi lọc theo cụm (DV5S), lấy cả rule riêng của các module thành viên thuộc cụm đó
    const ruleModDef = modules.find(m => m.code === rule.module);
    if (ruleModDef?.cluster === mod) return true;
    return false;
  }

  static list({ module, q } = {}) {
    const data = this.load();
    const mod = MODULE_MAP[module] || module;
    const terms = fold(q).split(/\s+/).filter(Boolean);
    const rules = data.rules.filter(r =>
      this.#matchesModule(r, mod, data.modules || []) &&
      terms.every(t => fold([r.rule_id, r.module, ...(r.source_modules || []), r.title, r.description, r.flow_name, r.menu].join(' ')).includes(t)));
    return { revision: data.revision, synced_at: data.synced_at, artifact_url: data.artifact_url, modules: data.modules, rules };
  }

  /** Trả về chunk cùng định dạng RagEngine để dùng chung phần trích dẫn */
  static retrieveChunks({ moduleId, keywords = [], limit = 5 }) {
    const data = this.load();
    const mod = MODULE_MAP[moduleId] || moduleId;
    const kws = keywords.map(fold).filter(Boolean);
    const scored = [];
    for (const r of data.rules) {
      if (!this.#matchesModule(r, mod, data.modules || [])) continue;
      const text = fold([r.rule_id, r.module, ...(r.source_modules || []), r.title, r.description, r.flow_name].join(' '));
      let score = r.module === mod ? 4 : 3;
      kws.forEach(k => { if (text.includes(k)) score += 2; });
      if (score <= 4 && kws.length && !kws.some(k => text.includes(k))) continue; // trong module nhưng không khớp từ khóa -> bỏ
      scored.push({
        chunkId: r.rule_id,
        sourceId: `kb_${r.rule_id}`,
        sourceTitle: `[Kho BR] ${r.rule_id} · ${r.title}`,
        sourceVersion: `v${r.version}`,
        sourceUri: r.local === 'created' ? '' : (r.source?.url || `${data.artifact_url}#rule-${r.rule_id}`),
        contentText: r.description,
        metadata: { origin: 'business-rule-kb', state: r.state || 'active', flow: r.flow_name, roles: r.user_roles, setting_type: r.setting_type },
        score
      });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
