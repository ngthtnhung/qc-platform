/**
 * Dựng gói rule từ thư mục xuất của Kho (database/kb-snapshot): rule active và pending kèm module.
 * Dùng chung cho script đồng bộ và nút "Cập nhật rule từ kho" trên platform.
 */
import fs from 'node:fs';
import path from 'node:path';

const ARTIFACT_URL = 'https://claude.ai/artifact/MVgM5XkurMPhcbvSGgz437';

export function buildBundle(snap) {
  const readDir = (d) => fs.existsSync(d)
    ? fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')))
    : [];
  const rules = readDir(path.join(snap, 'rules')).filter(r => r.state === 'active' || r.state === 'pending');
  const modules = readDir(path.join(snap, 'modules'));
  if (!rules.length) throw new Error('Không có rule active hoặc pending trong thư mục kb-snapshot/rules. Xuất dữ liệu từ Kho trước.');
  const slim = rules.map(r => ({
    rule_id: r.rule_id, version: r.version, state: r.state, module: r.module, source_modules: r.source_modules || [],
    menu: r.menu || '', flow: r.flow || '', flow_name: r.flow_name || '',
    title: r.title, description: r.description, user_roles: r.user_roles || [],
    setting_type: r.setting_type || 'unknown', setting_label: r.setting_label || '', config_path: r.config_path || '',
    classification: r.classification || '', analysis: r.analysis ? { verdict: r.analysis.verdict, explanation: r.analysis.explanation } : null, open_questions: r.open_questions || [], source: r.source_reference || {},
    related_rules: r.related_rules || [], approved_at: r.approved_at || ''
  })).sort((a, b) => a.rule_id.localeCompare(b.rule_id));
  const mods = modules.map(m => ({ code: m.code, name: m.name, cluster: m.cluster || '', flows: m.flows || [], usage_flow: m.usage_flow || '' }));
  return { artifact_url: ARTIFACT_URL, modules: mods, rules: slim };
}
