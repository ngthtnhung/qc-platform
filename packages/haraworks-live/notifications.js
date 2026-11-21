/**
 * Lấy danh sách Notification từ Haraworks (tasks.haraworks.vn) bằng cookie phiên trên server.
 * Lưu trạng thái đã xem / đã đọc bền vững theo từng người dùng trong database/notify-seen.json
 * để không bị hiện lại số chưa đọc khi tải lại trang, đăng xuất/đăng nhập lại hoặc khởi động lại server.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCookie } from './index.js';
import { startRealtime } from './realtime.js';

const SEEN_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../database/notify-seen.json');

export class NotifyLive extends EventEmitter {
  constructor({ baseUrl, cookie, pollMs = 25000, seenFile = SEEN_FILE }) {
    super();
    this.baseUrl = baseUrl;
    this.cookie = cookie;
    this.pollMs = pollMs;
    this.seenFile = path.resolve(seenFile);
    this.items = [];
    this.unseenCount = 0;
    this.unreadCount = 0;
    this.totalCount = 0;
    this.lastSyncAt = null;
    this.error = null;
    this.revision = 0;
    this.running = false;
    this.pending = false;
    this.colleagues = new Map(); // numberId -> fullName
    this.seenByUser = this.loadSeen(); // { [userId]: { seenAt, readIds: [] } }
  }

  loadSeen() {
    try {
      return JSON.parse(fs.readFileSync(this.seenFile, 'utf8')) || {};
    } catch {
      return {};
    }
  }

  saveSeen() {
    try {
      fs.mkdirSync(path.dirname(this.seenFile), { recursive: true });
      fs.writeFileSync(this.seenFile + '.tmp', JSON.stringify(this.seenByUser, null, 2));
      fs.renameSync(this.seenFile + '.tmp', this.seenFile);
    } catch (e) {
      console.warn('[notify-live] không lưu được trạng thái đã đọc:', e.message);
    }
  }

  markSeen(userId = 'default', id = '') {
    const key = String(userId || 'default');
    const cur = this.seenByUser[key] || { seenAt: '', readIds: [] };
    const set = new Set(Array.isArray(cur.readIds) ? cur.readIds : []);
    if (id) {
      set.add(String(id));
    } else {
      cur.seenAt = new Date().toISOString();
      for (const it of this.items) if (it.id) set.add(it.id);
    }
    this.seenByUser[key] = { seenAt: cur.seenAt, readIds: [...set].slice(-300) };
    this.revision += 1;
    this.saveSeen();
    return this.state('connected', key);
  }

  headers() {
    return {
      accept: 'application/json',
      cookie: this.cookie,
      origin: this.baseUrl,
      referer: `${this.baseUrl}/task/me`,
    };
  }

  async getJson(url) {
    const res = await fetch(url, { headers: this.headers(), redirect: 'manual', signal: AbortSignal.timeout(12000) });
    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
      throw new Error(`AUTH: Cookie hết hạn hoặc không hợp lệ (HTTP ${res.status})`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async resolveActor(numberId) {
    if (!numberId) return '';
    if (this.colleagues.has(numberId)) return this.colleagues.get(numberId);
    try {
      const j = await this.getJson(`${this.baseUrl}/call/hr_api/colleague?HaraId=${encodeURIComponent(numberId)}`);
      const name = j?.data?.fullName || '';
      if (name) this.colleagues.set(numberId, name);
      return name;
    } catch {
      return '';
    }
  }

  async start() {
    await this.sync('khởi động');
    if (this.pollMs > 0) this.timer = setInterval(() => this.sync('poll'), this.pollMs);
  }

  trigger(reason = 'thủ công') {
    this.sync(reason);
  }

  async sync(reason = 'poll') {
    if (!this.cookie) return;
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    try {
      const [listRes, countRes] = await Promise.all([
        this.getJson(`${this.baseUrl}/call/im_api/notify_center/notifications?page=1&page_size=25&module=all`),
        this.getJson(`${this.baseUrl}/call/im_api/notify_center/notifications/count/last_seen`).catch(() => null),
      ]);
      const rawItems = listRes?.data?.data || [];
      const actorIds = [...new Set(rawItems.map(x => x.from?.numberId).filter(Boolean))].slice(0, 15);
      await Promise.all(actorIds.map(id => this.resolveActor(id)));

      const mapped = rawItems.map(n => ({
        id: String(n.id || ''),
        title: String(n.title || ''),
        content: String(n.content || ''),
        module: n.module ?? null,
        moduleName: String(n.moduleName || 'Hệ thống'),
        actor: this.colleagues.get(n.from?.numberId) || '',
        link: String(n.link || ''),
        createdAt: String(n.createdAt || ''),
        isRead: !!n.isRead,
      }));

      const prevSig = JSON.stringify({ items: this.items.map(i => [i.id, i.isRead]), unseen: this.unseenCount });
      const nextUnseen = countRes?.data?.totalCount ?? mapped.filter(i => !i.isRead).length;
      const nextSig = JSON.stringify({ items: mapped.map(i => [i.id, i.isRead]), unseen: nextUnseen });

      this.items = mapped;
      this.totalCount = listRes?.data?.totalCount ?? mapped.length;
      this.unseenCount = nextUnseen;
      this.unreadCount = mapped.filter(i => !i.isRead).length;
      this.error = null;
      this.lastSyncAt = new Date().toISOString();

      if (prevSig !== nextSig) {
        this.revision += 1;
        this.emit('change');
      }
    } catch (e) {
      this.error = e.message;
    } finally {
      this.running = false;
      if (this.pending) {
        this.pending = false;
        setTimeout(() => this.sync('yêu cầu dồn'), 500);
      }
    }
  }

  state(realtime = 'poll-only', userId = 'default') {
    const key = String(userId || 'default');
    const seen = this.seenByUser[key];
    const readSet = new Set(Array.isArray(seen?.readIds) ? seen.readIds : []);
    const seenAt = seen?.seenAt || '';
    const items = this.items.map(n => {
      const localRead = readSet.has(n.id) || (seenAt && n.createdAt && n.createdAt <= seenAt);
      return { ...n, isRead: n.isRead || !!localRead };
    });
    const unread = items.filter(i => !i.isRead).length;
    const unseen = seenAt ? items.filter(i => !i.isRead && (!i.createdAt || i.createdAt > seenAt)).length : (this.unseenCount || unread);
    return {
      enabled: !!this.cookie,
      realtime,
      error: this.error,
      lastSyncAt: this.lastSyncAt,
      revision: this.revision,
      unseenCount: unseen,
      unreadCount: unread,
      totalCount: this.totalCount,
      items,
    };
  }
}

export function startNotifyLive() {
  let currentCookie = readCookie();
  const baseUrl = process.env.HARAWORKS_BASE_URL || 'https://tasks.haraworks.vn';
  let realtime = currentCookie ? 'connecting' : 'no-cookie';
  let started = false;
  const live = new NotifyLive({ baseUrl, cookie: currentCookie, pollMs: +(process.env.NOTIFY_POLL_INTERVAL_MS || 25000) });

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
    markSeen: (userId, id) => live.markSeen(userId, id),
    state: (userId) => live.state(realtime, userId),
    setCookie: (newCookie) => {
      currentCookie = String(newCookie || '').trim();
      live.cookie = currentCookie;
      live.error = null;
      if (currentCookie) {
        if (!started) boot(currentCookie);
        else live.trigger('cập nhật token');
      }
    },
  };
}
