/**
 * Bé Sugar — Chat App nhận lệnh (T4.1). GIỮ NGUYÊN Deployment ID khi cập nhật code
 * (Deploy → Manage deployments → Edit → New version).
 *
 * Luồng: kiểm tra quyền (chỉ email admin, chỉ trong space đã cấu hình hoặc DM) → trả lời ngay "Em đang xem nha…"
 * → xếp việc (Jobs.js) → trigger 1 lần chạy lệnh và gửi kết quả vào thread qua webhook của agent (Sugar Analyst / RYG / Auditor).
 */

var ACK_ = {
  campaigns: '📋 Em xem danh sách campaign nha…',
  report: '🔎 Em đang xem nha…',
  ryg: '🚦 Em xem đèn đỏ-vàng-xanh nha…',
  analyze: '🔎 Em đang phân tích, chờ em một chút nha…',
  audit: '🛡️ Em đang soát chính sách, khoảng một phút nha…'
};

function reply_(text) {
  return { hostAppDataAction: { chatDataAction: { createMessageAction: { message: { text: text } } } } };
}

function helpText_() {
  return 'Em là Bé Sugar 🍬\n' +
    '/campaigns: danh sách campaign đang chạy\n' +
    '/report <project|campaign> [7d|30d|all]: báo cáo nhanh theo mục tiêu của Project\n' +
    '/ryg [project]: đèn đỏ-vàng-xanh + việc nên làm\n' +
    '/analyze <câu hỏi>: phân tích sâu (hỏi tự do cũng được)\n' +
    '/audit <campaign|ad|ID>: soát chính sách / SAC / landing page\n' +
    'Anh cũng có thể @Bé Sugar và gõ câu hỏi bình thường, em tự chọn lệnh phù hợp.\n' +
    'Tin tự động: em báo khi số Meta về và nhắc anh xuất HubSpot. Em chỉ xem số, không thay đổi gì trên tài khoản quảng cáo.';
}

function handleInbound_(event, isCommand) {
  var info = eventInfo_(event);
  var auth = authorize_(info);
  if (!auth.ok) return reply_(auth.text);

  var cmd, arg;
  if (isCommand) {
    cmd = COMMAND_BY_ID[info.commandId];
    arg = info.text.replace(/^\/\S+\s*/, '');
  } else {
    var c = classifyIntent_(info.text);
    cmd = c.cmd; arg = c.arg;
  }
  if (!cmd) return reply_('Em chưa hiểu lệnh này. Gõ /help để xem danh sách nha.');
  if (cmd === 'help') return reply_(helpText_());
  if (!webhookFor_(AGENT_FOR[cmd])) return reply_('Em chưa có webhook để trả lời (AGENT_WEBHOOKS trong Script Properties). Nhờ dev kiểm tra giúp em nha.');

  var queued;
  try { queued = enqueueJob_({ id: jobId_(info), cmd: cmd, arg: arg, thread: info.thread }); }
  catch (e) { return reply_('Em chưa hẹn được lịch xử lý (' + String(e && e.message).slice(0, 80) + '). Thử lại giúp em nha.'); }
  return reply_(queued ? ACK_[cmd] : 'Em đang xử lý lệnh này rồi, anh đợi em một chút nha.');
}

/**
 * Lỗi bất ngờ (thiếu file, thiếu hàm, lỗi quyền…) phải hiện ra trong Chat thay vì im lặng. Ghi vào Executions để xem chi tiết.
 * Chỉ nói loại lỗi + hướng xử lý, không lộ dữ liệu.
 */
function safeInbound_(event, isCommand) {
  try {
    return handleInbound_(event, isCommand);
  } catch (e) {
    try { console.error('Chat lỗi: ' + (e && e.stack ? e.stack : e)); } catch (x) { /* bỏ qua */ }
    var m = String((e && e.message) || e).slice(0, 110);
    return reply_('⚠️ Bé Sugar gặp lỗi khi nhận lệnh (' + m + '). Sếp mở Apps Script, chạy hàm selfCheck để xem thiếu gì, hoặc xem mục Executions.');
  }
}
function onMessage(event) { return safeInbound_(event, false); }
function onAppCommand(event) { return safeInbound_(event, true); }

function onAddedToSpace(event) {
  try {
    var auth = authorize_(eventInfo_(event));
    if (!auth.ok) return reply_(auth.text);
  } catch (e) { return reply_('⚠️ Bé Sugar vào space được nhưng đang lỗi cấu hình. Sếp chạy hàm selfCheck trong Apps Script nha.'); }
  return reply_('Chào sếp Nguyên! Bé Sugar đã vào space 🍬 Gõ /help để xem lệnh.');
}

function onRemovedFromSpace(event) {}
