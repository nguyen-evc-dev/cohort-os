/**
 * Bé Sugar — Chat App nhận lệnh. Lệnh thật (đọc dữ liệu, gọi Claude) làm ở T4.x.
 * GIỮ NGUYÊN Deployment ID khi cập nhật code (Deploy → Manage deployments → Edit → New version).
 */

var COMMANDS = { 1: '/campaigns', 2: '/report', 3: '/ryg', 4: '/analyze', 5: '/audit', 6: '/help' };

function reply_(text) {
  return { hostAppDataAction: { chatDataAction: { createMessageAction: { message: { text: text } } } } };
}

// Tạm: chỉ chặn khi Google gửi kèm email và email đó không phải admin. T4.1 sẽ chặn chặt hơn.
function isDenied_(event) {
  var email = event && event.chat && event.chat.user && event.chat.user.email;
  return !!email && email !== adminEmail_();
}

function helpText_() {
  return 'Em là Bé Sugar 🍬\n' +
    '/campaigns: danh sách campaign đang chạy\n' +
    '/report <campaign>: báo cáo nhanh\n' +
    '/ryg: đèn đỏ-vàng-xanh\n' +
    '/analyze <campaign>: phân tích sâu\n' +
    '/audit <campaign|ad>: audit chính sách / SAC / landing page\n' +
    'Tin tự động: em báo khi số Meta về (14:05/15:05) và nhắc anh xuất HubSpot.';
}

function onMessage(event) {
  if (isDenied_(event)) return reply_('Xin lỗi, em chỉ làm việc với sếp Nguyên nha.');
  return reply_('Bé Sugar đã kết nối ✅ Gõ / để xem lệnh. (Các lệnh đang được xây, tin tự động đã chạy.)');
}

function onAppCommand(event) {
  if (isDenied_(event)) return reply_('Xin lỗi, em chỉ làm việc với sếp Nguyên nha.');
  var id = Number(event.chat.appCommandPayload.appCommandMetadata.appCommandId);
  if (id === 6) return reply_(helpText_());
  return reply_('Em đã nhận lệnh ' + (COMMANDS[id] || ('#' + id)) + ' ✅ Tính năng này đang được xây.');
}

function onAddedToSpace(event) {
  return reply_('Chào sếp Nguyên! Bé Sugar đã vào space 🍬 Gõ /help để xem lệnh.');
}

function onRemovedFromSpace(event) {}
