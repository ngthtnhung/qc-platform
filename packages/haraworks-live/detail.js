/**
 * Chi tiết một bug từ tasks.haraworks.vn: mô tả, trạng thái, người thực hiện, người theo dõi, file đính kèm,
 * lịch sử cập nhật và bình luận. Chỉ ĐỌC. Theo docs/haraworks-task-extraction-guide.md (client v1.6.206).
 * Cần cookie phiên Haraworks trên server (secrets/haraworks.json hoặc HARAWORKS_COOKIE); không có thì báo lý do.
 * Không lấy email, số điện thoại hay mã nhân sự.
 */
import { createClient, AuthError } from './client.js';
import { readCookie } from './index.js';

const ID_RE = /^[0-9a-f]{24}$/;
const cache = new Map(); // id -> { at, data }
const TTL = 60 * 1000;

const FULL = `id name code content status ticket_Status priority need_Approval plan_End_At comment_Token created_At updated_At
  approverEntity { user_Name department_Name job_Title_Name }
  created_By { id name } updated_By { id name } owner { id name }
  assignTo { id name departmentName jobtitleName }
  followers { id name departmentName jobtitleName }
  supporters { id name departmentName jobtitleName }
  attachments { id name url }
  additionalInfo { key value }
  project_Id project_Name`;
// Dự phòng: chỉ các trường chắc chắn có (nếu client đổi phiên bản và từ chối trường nào đó ở bản đầy đủ)
const MINIMAL = `id name content status ticket_Status priority plan_End_At comment_Token created_At
  assignTo { id name } owner { id name } followers { id name } attachments { id name url } additionalInfo { key value }`;

/** HTML của Haraworks -> chữ thường, giữ xuống dòng; không giữ thẻ nên hiển thị an toàn */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

const IMG = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i, VID = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i, AUD = /\.(mp3|wav|m4a|ogg|aac)(\?|#|$)/i, PDF = /\.pdf(\?|#|$)/i;
/** Loại tệp theo đuôi (tên hoặc đường dẫn): image, video, audio, pdf hoặc file */
export const mediaKind = (url, name = '') => (IMG.test(name) || IMG.test(url) ? 'image' : VID.test(name) || VID.test(url) ? 'video' : AUD.test(name) || AUD.test(url) ? 'audio' : PDF.test(name) || PDF.test(url) ? 'pdf' : 'file');
/** Ảnh, video, âm thanh nhúng trong nội dung HTML (để xem trước, không cần tải về). Chỉ nhận đường dẫn http hoặc https. */
export function extractMedia(html) {
  const out = new Map();
  const add = (u, kind) => { const url = String(u).replace(/&amp;/g, '&').trim(); if (/^https?:\/\//i.test(url) && !out.has(url)) out.set(url, kind); };
  String(html || '').replace(/<img\b[^>]*?\bsrc=["']([^"']+)["']/gi, (_, u) => { add(u, 'image'); return ''; });
  String(html || '').replace(/<(?:video|audio|source)\b[^>]*?\bsrc=["']([^"']+)["']/gi, (_, u) => { add(u, mediaKind(u) === 'audio' ? 'audio' : 'video'); return ''; });
  String(html || '').replace(/<a\b[^>]*?\bhref=["']([^"']+)["']/gi, (_, u) => { const k = mediaKind(u); if (k === 'image' || k === 'video' || k === 'audio') add(u, k); return ''; });
  return [...out].map(([url, kind]) => ({ url, kind }));
}
const files = a => (Array.isArray(a) ? a : []).map(f => ({ name: f.name || '', url: f.url || '', kind: mediaKind(f.url || '', f.name || '') }));
const people = a => (Array.isArray(a) ? a : []).map(p => ({ name: p.name || '', dept: p.departmentName || '', title: p.jobtitleName || '' }));
const one = p => (p ? { name: p.name || '' } : null);

export function shapeDetail(task, logs, comments) {
  const info = Object.fromEntries((task.additionalInfo || []).map(i => [i.key, i.value]));
  return {
    id: task.id, code: task.code || '', name: task.name || '',
    description: htmlToText(task.content),
    status: task.status ?? task.ticket_Status ?? null, priority: task.priority ?? null,
    plan_end_at: task.plan_End_At || '', created_at: task.created_At || '', updated_at: task.updated_At || '',
    approver: task.approverEntity ? { name: task.approverEntity.user_Name || '', dept: task.approverEntity.department_Name || '', title: task.approverEntity.job_Title_Name || '' } : null,
    need_approval: !!task.need_Approval,
    created_by: one(task.created_By), updated_by: one(task.updated_By), owner: one(task.owner),
    assignee: task.assignTo ? { name: task.assignTo.name || '', dept: task.assignTo.departmentName || '', title: task.assignTo.jobtitleName || '' } : null,
    followers: people(task.followers), supporters: people(task.supporters),
    attachments: files(task.attachments), description_media: extractMedia(task.content),
    project: task.project_Name || '', info,
    logs: (logs || []).map(l => ({
      type: l.log_Type, value: l.value || '', reason: l.reason || '', at: l.created_At || '', by: l.created_By?.name || '',
      info: Object.fromEntries((l.additional_Info || []).map(i => [i.key, i.value]))
    })),
    comments: {
      total: comments?.totalCount ?? 0,
      items: (comments?.data || []).map(c => ({
        id: c.id, text: htmlToText(c.content), at: c.created_At || '', by: c.created_By?.name || '',
        attachments: files(c.attachments), media: extractMedia(c.content),
        likes: c.like_count || 0,
        replies: (c.replies?.data || []).map(r => ({ id: r.id, text: htmlToText(r.content), at: r.created_At || '', by: r.created_By?.name || '' }))
      }))
    }
  };
}

export async function getBugDetail(id, { baseUrl = process.env.HARAWORKS_BASE_URL || 'https://tasks.haraworks.vn' } = {}) {
  if (!ID_RE.test(String(id))) { const e = new Error('Mã bug không hợp lệ'); e.code = 'BAD_ID'; throw e; }
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const cookie = readCookie();
  if (!cookie) { const e = new Error('Chưa có cookie đăng nhập Haraworks trên server. Admin đặt cookie vào secrets/haraworks.json rồi khởi động lại server.'); e.code = 'NO_COOKIE'; throw e; }
  const client = createClient({ baseUrl, cookie });
  const q = JSON.stringify(id);
  let task;
  try {
    task = (await client.gql(`query{getTaskById(id:${q}){${FULL}}}`)).getTaskById;
  } catch (e) {
    if (e instanceof AuthError) throw Object.assign(new Error('Cookie đăng nhập Haraworks đã hết hạn. Đăng nhập lại tasks.haraworks.vn, cập nhật secrets/haraworks.json rồi thử lại.'), { code: 'AUTH' });
    task = (await client.gql(`query{getTaskById(id:${q}){${MINIMAL}}}`)).getTaskById; // lỗi trường: thử bản tối thiểu
  }
  if (!task) { const e = new Error('Không tìm thấy bug này trên Haraworks (có thể đã bị xóa).'); e.code = 'NOT_FOUND'; throw e; }
  let logs = [], comments = null;
  try {
    logs = (await client.gql(`query{getTaskById(id:${q}){logs{log_Type value reason additional_Info{key value} created_At created_By{id name}}}}`)).getTaskById?.logs || [];
  } catch { /* lịch sử không bắt buộc */ }
  if (task.comment_Token) {
    try {
      comments = (await client.gql(`query{comments(token:${JSON.stringify(task.comment_Token)},preview:false,page_index:1,page_size:100){totalCount data{id content created_At created_By{id name} attachments{id name url} like_count replies(preview:false,page_index:1,page_size:100){totalCount data{id content created_At created_By{id name}}}}}}`)).comments;
    } catch { /* bình luận không bắt buộc */ }
  }
  const data = shapeDetail(task, logs, comments);
  cache.set(id, { at: Date.now(), data });
  return data;
}

/**
 * Tải ảnh của một bug (mô tả, đính kèm, bình luận) về dạng base64 để gửi cho AI phân tích.
 * Địa chỉ ảnh lấy từ chính dữ liệu Haraworks của bug, không nhận địa chỉ từ người dùng.
 * Chỉ nhận https, gửi cookie chỉ khi ảnh nằm trên haraworks.vn.
 */
export async function fetchBugImages(id, { max = 5, maxBytes = 4 * 1024 * 1024, timeoutMs = 12000, fetchImpl = fetch } = {}) {
  const d = await getBugDetail(id);
  const urls = [];
  const add = m => { if (m && m.kind === 'image' && /^https:\/\//i.test(m.url || '') && !urls.some(u => u.url === m.url)) urls.push({ url: m.url, name: m.name || '' }); };
  (d.description_media || []).forEach(add);
  (d.attachments || []).forEach(add);
  (d.comments?.items || []).forEach(c => { (c.media || []).forEach(add); (c.attachments || []).forEach(add); });
  const cookie = readCookie();
  const out = [];
  for (const item of urls) {
    if (out.length >= max) break;
    try {
      const host = new URL(item.url).hostname;
      const headers = cookie && /(^|\.)haraworks\.vn$/i.test(host) ? { cookie } : {};
      const res = await fetchImpl(item.url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > maxBytes) continue;
      const base = decodeURIComponent((item.name || new URL(item.url).pathname.split('/').pop() || 'anh').slice(0, 80));
      out.push({ name: base || 'anh', data_base64: buf.toString('base64') });
    } catch { /* ảnh lỗi thì bỏ qua */ }
  }
  return { images: out, found: urls.length, detail: d };
}
