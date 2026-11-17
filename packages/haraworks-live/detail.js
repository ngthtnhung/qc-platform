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

const FULL = `id name code content status ticket_Status priority plan_End_At comment_Token created_At updated_At
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

const people = a => (Array.isArray(a) ? a : []).map(p => ({ name: p.name || '', dept: p.departmentName || '', title: p.jobtitleName || '' }));
const one = p => (p ? { name: p.name || '' } : null);

export function shapeDetail(task, logs, comments) {
  const info = Object.fromEntries((task.additionalInfo || []).map(i => [i.key, i.value]));
  return {
    id: task.id, code: task.code || '', name: task.name || '',
    description: htmlToText(task.content),
    status: task.status ?? task.ticket_Status ?? null, priority: task.priority ?? null,
    plan_end_at: task.plan_End_At || '', created_at: task.created_At || '', updated_at: task.updated_At || '',
    created_by: one(task.created_By), updated_by: one(task.updated_By), owner: one(task.owner),
    assignee: task.assignTo ? { name: task.assignTo.name || '', dept: task.assignTo.departmentName || '', title: task.assignTo.jobtitleName || '' } : null,
    followers: people(task.followers), supporters: people(task.supporters),
    attachments: (task.attachments || []).map(a => ({ name: a.name || '', url: a.url || '' })),
    project: task.project_Name || '', info,
    logs: (logs || []).map(l => ({
      type: l.log_Type, value: l.value || '', reason: l.reason || '', at: l.created_At || '', by: l.created_By?.name || '',
      info: Object.fromEntries((l.additional_Info || []).map(i => [i.key, i.value]))
    })),
    comments: {
      total: comments?.totalCount ?? 0,
      items: (comments?.data || []).map(c => ({
        id: c.id, text: htmlToText(c.content), at: c.created_At || '', by: c.created_By?.name || '',
        attachments: (c.attachments || []).map(a => ({ name: a.name || '', url: a.url || '' })),
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
