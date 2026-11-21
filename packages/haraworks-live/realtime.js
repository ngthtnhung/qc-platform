// Nghe kênh thông báo SignalR của Haraworks (/call/im_hub/hubs/notify).
// Mỗi khi Haraworks đẩy sự kiện về, gọi onEvent để đồng bộ bug ngay (không phải chờ chu kỳ poll).
// Thư viện @microsoft/signalr là tùy chọn: thiếu thì chỉ dùng poll.

export async function startRealtime({ baseUrl, cookie, onEvent, onState }) {
  let signalR;
  try {
    signalR = await import('@microsoft/signalr');
  } catch {
    console.warn('[haraworks-live] chưa cài @microsoft/signalr, chỉ dùng poll (npm i @microsoft/signalr để có realtime tức thì)');
    onState?.('poll-only');
    return null;
  }

  const conn = new signalR.HubConnectionBuilder()
    .withUrl(`${baseUrl}/call/im_hub/hubs/notify`, { headers: { cookie, origin: baseUrl }, withCredentials: true })
    .withAutomaticReconnect([0, 2000, 5000, 10000, 30000, 60000])
    .configureLogging(signalR.LogLevel.None)
    .build();

  // Chưa biết tên các sự kiện hub gửi, nên bắt tất cả (_invokeClientMethod là hàm nội bộ của thư viện).
  const original = conn._invokeClientMethod?.bind(conn);
  if (original) {
    conn._invokeClientMethod = async (msg) => {
      onEvent(msg.target, msg.arguments);
      try { return await original(msg); } catch { /* không có handler -> bỏ qua */ }
    };
  }
  conn.onreconnecting(() => onState?.('reconnecting'));
  conn.onreconnected(() => { onState?.('connected'); onEvent('reconnected', []); });
  conn.onclose(() => onState?.('disconnected'));

  let lastErrLogged = '';
  const connect = async () => {
    try {
      await conn.start();
      lastErrLogged = '';
      console.log('[haraworks-live] SignalR đã kết nối');
      onState?.('connected');
    } catch (err) {
      const msg = String(err?.message || err || '');
      const is401 = /401|unauthor/i.test(msg);
      if (lastErrLogged !== msg) {
        console.warn('[haraworks-live] SignalR không kết nối được, dùng poll. Lý do:', msg);
        lastErrLogged = msg;
      }
      onState?.('disconnected');
      setTimeout(connect, is401 ? 10 * 60000 : 60000);
    }
  };
  connect();
  return conn;
}
