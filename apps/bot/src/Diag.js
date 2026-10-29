/**
 * Chẩn đoán khi Bé Sugar im lặng. Chạy trong trình soạn thảo Apps Script (chọn hàm → ▶ Run), xem kết quả ở "Execution log".
 *   selfCheck()  kiểm tra đủ file / hàm, Script Properties (chỉ báo CÓ hay THIẾU, không in giá trị), file Chat cũ còn đè không
 *   testChat()   giả lập đúng lệnh "/report webinar" từ admin: chạy toàn bộ đường đi, gửi kết quả vào space. Lần đầu sẽ hiện hộp xin quyền mới
 */

var REQUIRED_FUNCTIONS_ = [
  'onMessage', 'onAppCommand', 'onAddedToSpace', 'handleInbound_', 'eventInfo_', 'authorize_', 'allowedSpaces_', 'norm_', 'classifyIntent_', 'parseReportArg_',
  'resolveSnapshot_', 'campaignsCard_', 'reportCard_', 'rygCard_', 'handleCommand_', 'enqueueJob_', 'processJobs', 'runJob_', 'claudeRun_', 'askGrounded_',
  'postToChat_', 'botRead_', 'planAlerts', 'tick', 'webhookFor_', 'webBaseUrl_', 'adminEmail_'
];
var REQUIRED_PROPERTIES_ = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'BOT_TOKEN', 'AGENT_WEBHOOKS'];

function selfCheck() {
  var lines = [];
  var problems = 0;
  var bad = function (msg) { problems += 1; lines.push('❌ ' + msg); };
  var ok = function (msg) { lines.push('✅ ' + msg); };

  var G = typeof globalThis !== 'undefined' ? globalThis : this;
  var missing = REQUIRED_FUNCTIONS_.filter(function (n) { return typeof G[n] !== 'function'; });
  if (missing.length) bad('Thiếu hàm: ' + missing.join(', ') + '. Chưa tạo đủ file (Core.generated, Guard, Router, Reports, Claude, Commands, Jobs, Chat, Config) hoặc dán thiếu nội dung.');
  else ok('Đủ ' + REQUIRED_FUNCTIONS_.length + ' hàm cần thiết.');

  if (typeof G.CohortCore === 'undefined' || !G.CohortCore.SKILLS) bad('Thiếu file Core.generated.js (biến CohortCore). Tạo file tên Core.generated rồi dán nội dung.');
  else ok('CohortCore có ' + Object.keys(G.CohortCore.SKILLS).length + ' skill.');

  try {
    if (String(G.onAppCommand).indexOf('đang được xây') >= 0 || String(G.onMessage).indexOf('đang được xây') >= 0) bad('Vẫn còn code Chat CŨ ("đang được xây") đè lên Chat.js. Xóa file Code.gs hoặc bản Chat cũ.');
    else ok('Không còn code Chat cũ đè.');
  } catch (e) { /* bỏ qua */ }

  var counts = {};
  ScriptApp.getProjectTriggers().forEach(function (t) { var h = t.getHandlerFunction(); counts[h] = (counts[h] || 0) + 1; });
  var total = Object.keys(counts).reduce(function (s, k) { return s + counts[k]; }, 0);
  lines.push('ℹ️ Trigger: ' + total + '/20 (' + (Object.keys(counts).map(function (k) { return k + ' ' + counts[k]; }).join(', ') || 'không có') + ')');
  if ((counts.processJobs || 0) > 1) bad('Có ' + counts.processJobs + ' trigger processJobs (chỉ cần 1, bản cũ tạo mỗi lệnh 1 cái). Chạy hàm installTriggers để dọn và cài lại đúng.');
  if (!counts.processJobs) bad('Chưa có trigger processJobs mỗi phút: lệnh chậm (/ryg, /analyze, /audit) sẽ không được xử lý. Chạy hàm installTriggers một lần.');
  if (!counts.tick) lines.push('⚠️ Chưa có trigger tick (nhắc việc sau sync). Chạy hàm installTriggers.');
  var hb = Number(PropertiesService.getScriptProperties().getProperty('PROCESSOR_HEARTBEAT') || 0);
  if (!hb) bad('Bộ xử lý nền chưa từng chạy (chưa có nhịp tim). Chạy installTriggers rồi đợi 1 phút.');
  else if (Date.now() - hb > HEARTBEAT_MAX_AGE_MS_) bad('Bộ xử lý nền đã ngừng ' + Math.round((Date.now() - hb) / 60000) + ' phút. Kiểm tra trigger processJobs (installTriggers).');
  else lines.push('✅ Bộ xử lý nền còn sống (nhịp tim ' + Math.round((Date.now() - hb) / 1000) + ' giây trước).');

  var props = PropertiesService.getScriptProperties();
  REQUIRED_PROPERTIES_.forEach(function (k) { if (!props.getProperty(k)) bad('Thiếu Script Property ' + k + '.'); });
  try {
    var wh = JSON.parse(props.getProperty('AGENT_WEBHOOKS') || '{}');
    ['alerts', 'analyst', 'ryg', 'auditor'].forEach(function (a) { if (!wh[a]) lines.push('⚠️ AGENT_WEBHOOKS chưa có "' + a + '" (sẽ dùng Alerts thay thế).'); });
    if (!wh.alerts) bad('AGENT_WEBHOOKS thiếu "alerts": bot không có chỗ trả lời.');
  } catch (e) { bad('AGENT_WEBHOOKS không phải JSON hợp lệ.'); }
  if (!props.getProperty('ANTHROPIC_API_KEY')) lines.push('⚠️ Chưa có ANTHROPIC_API_KEY: /analyze và phần giải thích sẽ không chạy (/report, /campaigns vẫn chạy).');
  else ok('Có ANTHROPIC_API_KEY.');
  lines.push('ℹ️ Space được phục vụ: ' + (typeof G.allowedSpaces_ === 'function' ? (allowedSpaces_().join(', ') || '(chưa xác định, chỉ tin nhắn riêng)') : '?') + ' · Admin: ' + (typeof G.adminEmail_ === 'function' ? adminEmail_() : '?'));

  try { var rows = botRead_('v_project_snapshot'); if (rows.length) ok('Đọc được ' + rows.length + ' bản chụp báo cáo từ Supabase.'); else bad('Đọc được Supabase nhưng CHƯA có bản chụp báo cáo. Chạy npm run sync:snapshots trên máy.'); }
  catch (e) { bad('Không đọc được Supabase: ' + String(e && e.message).slice(0, 160)); }

  lines.push(problems ? ('→ Có ' + problems + ' vấn đề ❌ ở trên.') : '→ Mọi thứ ổn. Chạy tiếp testChat().');
  var out = lines.join('\n');
  Logger.log(out);
  return out;
}

/** Giả lập "/report webinar" từ admin trong space đã cấu hình; chạy xong gửi báo cáo vào space qua webhook. */
function testChat() {
  var spaces = allowedSpaces_();
  var event = { chat: {
    user: { email: adminEmail_(), type: 'HUMAN' },
    appCommandPayload: {
      appCommandMetadata: { appCommandId: '2', appCommandType: 'SLASH_COMMAND' },
      space: { name: spaces[0] || 'spaces/UNKNOWN', spaceType: 'SPACE' },
      message: { name: 'test/' + Date.now(), argumentText: ' webinar', text: '/report webinar', thread: null }
    }
  } };
  var reply;
  try {
    reply = onAppCommand(event);
    Logger.log('Trả lời ngay: ' + JSON.stringify(reply));
    Logger.log('Đã chạy xong (/report chạy ngay). Xem kết quả trong space (agent Sugar Analyst hoặc Alerts).');
  } catch (e) {
    Logger.log('LỖI: ' + (e && e.stack ? e.stack : e));
    throw e;
  }
  return reply;
}

/** Xóa mọi trigger processJobs (kể cả bản cũ tạo theo từng lệnh). Sau đó chạy installTriggers để cài lại đúng 1 cái. */
function cleanupTriggers() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processJobs') { try { ScriptApp.deleteTrigger(t); n += 1; } catch (e) { /* đã xóa */ } }
  });
  var out = 'Đã xóa ' + n + ' trigger processJobs. Còn lại ' + ScriptApp.getProjectTriggers().length + '/20 trigger. Chạy installTriggers để cài lại.';
  Logger.log(out);
  return out;
}
