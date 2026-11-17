// Client gọi API nội bộ tasks.haraworks.vn bằng cookie phiên đăng nhập. Chỉ ĐỌC, không ghi gì lên Haraworks.
const BATCH_SIZE = 50; // số task lấy chi tiết trong 1 request (GraphQL alias)
const NOT_FOUND = /không tìm thấy dữ liệu|not found/i;

export class AuthError extends Error {}

export function createClient({ baseUrl, cookie }) {
  const endpoint = `${baseUrl}/call/ta_api/graphql`;

  async function gql(query, { allowPartial = false } = {}) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', cookie, origin: baseUrl, referer: `${baseUrl}/task/me` },
      body: JSON.stringify({ query }),
      redirect: 'manual',
    });
    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
      throw new AuthError(`Cookie hết hạn hoặc không hợp lệ (HTTP ${res.status})`);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    let json;
    try { json = JSON.parse(text); } catch { throw new AuthError('Server không trả JSON, có thể cookie đã hết hạn'); }
    if (json.errors?.length) {
      const msg = json.errors.map((e) => e.message).join('; ');
      if (/auth|login|unauthor/i.test(msg)) throw new AuthError(msg);
      // "Không tìm thấy dữ liệu" = không có gì thay đổi / task trong lô đã bị xoá -> coi như rỗng
      if (allowPartial || NOT_FOUND.test(msg)) return json.data ?? {};
      throw new Error(`GraphQL: ${msg}`);
    }
    return json.data;
  }

  /** version = "0": trả toàn bộ ID task của dự án; version = timestamp lần trước: null nếu không đổi */
  async function getListTask(version = '0', projectId = '') {
    const data = await gql(`query{getListTask(version:${JSON.stringify(String(version))},projectId:${JSON.stringify(projectId)}){tasks timestamp}}`);
    const r = data?.getListTask;
    if (!r) return null;
    return { ids: r.tasks || [], timestamp: String(r.timestamp) };
  }

  async function getTasks(ids, fields) {
    const out = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      const q = 'query{' + chunk.map((id, k) => `t${k}:getTaskById(id:${JSON.stringify(id)}){${fields}}`).join(' ') + '}';
      const data = await gql(q, { allowPartial: true });
      for (const t of Object.values(data || {})) if (t) out.push(t);
    }
    return out;
  }

  async function getProjects() {
    const data = await gql('{projects{id name}}');
    return data?.projects ?? [];
  }

  return { gql, getListTask, getTasks, getProjects };
}
