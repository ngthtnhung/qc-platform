// Kiểm tra nhanh kết nối tới Gemini: node scripts/ai-check.mjs
// Không in khóa. Cho biết có ra được mạng Google không và mô hình trả lời mất bao lâu.
const key = process.env.GEMINI_API_KEY;
const model = process.env.QA_AI_MODEL || 'gemini-3.5-flash';
const base = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
if (!key) { console.log('Chưa thấy GEMINI_API_KEY trong cửa sổ này.'); process.exit(1); }
console.log(`Mô hình: ${model}\nMáy chủ: ${base}\nProxy HTTPS_PROXY: ${process.env.HTTPS_PROXY || process.env.https_proxy || '(không đặt)'}`);

// Bước 1: chỉ kiểm tra có ra được mạng và khóa hợp lệ không (liệt kê mô hình, rất nhanh)
let t = Date.now();
try {
  const r = await fetch(`${base}/v1beta/models?pageSize=100`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  console.log(`1) Kết nối: HTTP ${r.status} sau ${Date.now() - t} ms`);
  if (!r.ok) console.log('   ', String(j.error?.message || '').slice(0, 200));
  else {
    const names = (j.models || []).map(m => m.name.replace('models/', '')).filter(n => /flash|pro/.test(n) && /^gemini/.test(n));
    console.log('   Mô hình dùng được (flash/pro):', names.slice(0, 25).join(', ') || '(không thấy)');
    console.log(`   Mô hình đang đặt có trong danh sách: ${names.includes(model) ? 'có' : 'KHÔNG, hãy đặt QA_AI_MODEL theo một tên ở trên'}`);
  }
} catch (e) { console.log(`1) Không kết nối được sau ${Date.now() - t} ms: ${e.cause?.code || e.name}. Mạng đang chặn hoặc cần proxy.`); process.exit(2); }

// Bước 2: hỏi thử cùng lúc nhiều mô hình, in thời gian của từng cái (tối đa 45 giây mỗi cái)
const candidates = [...new Set([model, 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-3.5-flash'])];
console.log(`2) Hỏi thử ${candidates.length} mô hình cùng lúc, chờ tối đa 45 giây...`);
const ask = async m => {
  const t0 = Date.now();
  try {
    const r = await fetch(`${base}/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(45000),
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Trả lời đúng một chữ: xin chào' }] }] })
    });
    const j = await r.json().catch(() => ({}));
    const txt = r.ok ? ((j.candidates || [])[0]?.content?.parts || []).map(p => p.text || '').join('').trim().slice(0, 30) : String(j.error?.message || '').slice(0, 80);
    return `${m.padEnd(26)} HTTP ${r.status}  ${String(Date.now() - t0).padStart(6)} ms  ${txt}`;
  } catch (e) { return `${m.padEnd(26)} KHÔNG TRẢ LỜI sau ${Date.now() - t0} ms (${e.name})`; }
};
for (const line of await Promise.all(candidates.map(ask))) console.log('   ' + line);
console.log('Chọn mô hình có HTTP 200 và thời gian ngắn nhất, rồi đặt QA_AI_MODEL theo tên đó.');
