/**
 * T4.1 — Hàng đợi việc. Chat yêu cầu trả lời đồng bộ dưới ~30 giây, nên onMessage / onAppCommand chỉ: kiểm tra quyền,
 * xếp việc vào Script Properties (JOB_<id>) và hẹn trigger 1 lần sau 1 giây. Trigger chạy processJobs: làm việc thật
 * (đọc Supabase, gọi Claude) rồi gửi kết quả vào ĐÚNG THREAD của lệnh qua webhook của agent.
 */

var JOB_PREFIX_ = 'JOB_';
var JOB_MAX_AGE_MS_ = 10 * 60 * 1000;

/** Id việc từ tên tin nhắn Chat (Chat có thể gửi lại cùng 1 sự kiện → không chạy 2 lần). */
function jobId_(info) {
  var base = String(info.messageName || ('m' + Date.now() + Math.floor(Math.random() * 1000)));
  return base.replace(/[^A-Za-z0-9]+/g, '_').slice(-70);
}

/**
 * Apps Script cho tối đa 20 trigger / người dùng / dự án, và trigger hẹn giờ 1 lần KHÔNG tự biến mất sau khi chạy.
 * Nên mỗi lần hẹn đều dọn hết trigger processJobs cũ trước: việc nằm trong Script Properties, trigger nào chạy cũng xử lý hết,
 * vì vậy luôn chỉ cần đúng 1 trigger đang chờ.
 */
function purgeJobTriggers_() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processJobs') { try { ScriptApp.deleteTrigger(t); n += 1; } catch (e) { /* đã bị xóa */ } }
  });
  return n;
}

function scheduleProcess_() {
  purgeJobTriggers_();
  ScriptApp.newTrigger('processJobs').timeBased().after(1000).create();
}

function hasPendingJobs_() {
  var all = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(all).some(function (k) { return k.indexOf(JOB_PREFIX_) === 0; });
}

/** true = đã xếp việc; false = việc này đã có / đã chạy (bỏ qua). Ném lỗi nếu không hẹn được trigger. */
function enqueueJob_(job) {
  var props = PropertiesService.getScriptProperties();
  var key = JOB_PREFIX_ + job.id;
  if (props.getProperty(key) !== null) return false;
  if (CacheService.getScriptCache().get('DONE_' + job.id)) return false;
  props.setProperty(key, JSON.stringify({ cmd: job.cmd, arg: String(job.arg || '').slice(0, 300), thread: job.thread || null, at: Date.now() }));
  try {
    scheduleProcess_();
  } catch (e) {
    props.deleteProperty(key);
    throw e;
  }
  return true;
}

/** Xóa trigger 1 lần vừa chạy xong (Apps Script giới hạn 20 trigger / dự án). */
function dropFiredTrigger_(e) {
  if (!e || !e.triggerUid) return;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getUniqueId() === e.triggerUid) { try { ScriptApp.deleteTrigger(t); } catch (x) { /* đã bị xóa */ } }
  });
}

/** Chạy 1 việc: trả kết quả vào thread của lệnh; lỗi thì báo lỗi dễ hiểu vào cùng thread. */
function runJob_(job) {
  var agent = AGENT_FOR[job.cmd] || 'alerts';
  var messages;
  try {
    messages = handleCommand_(job.cmd, job.arg);
  } catch (e) {
    console.error('job ' + job.cmd + ' lỗi: ' + String(e && e.message).slice(0, 300));
    messages = [{ text: '⚠️ Em chưa làm xong lệnh /' + job.cmd + ': ' + friendlyError_(e) + '.' }];
  }
  messages.forEach(function (m) {
    try { postToChat_(agent, m, job.thread); }
    catch (e) { console.error('gửi webhook ' + agent + ' lỗi: ' + String(e && e.message).slice(0, 300)); }
  });
}

/** Trigger entry point (installable one-time trigger). */
function processJobs(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    // Đang bận (việc khác đang chạy): hẹn lại để việc đã xếp không bị bỏ quên
    try { if (hasPendingJobs_()) scheduleProcess_(); } catch (e) { console.error('hẹn lại lỗi: ' + String(e && e.message).slice(0, 200)); }
    return;
  }
  try {
    dropFiredTrigger_(e);
    var props = PropertiesService.getScriptProperties();
    var all = props.getProperties();
    Object.keys(all).filter(function (k) { return k.indexOf(JOB_PREFIX_) === 0; }).sort().forEach(function (k) {
      var job = null;
      try { job = JSON.parse(all[k]); } catch (x) { job = null; }
      props.deleteProperty(k); // lấy việc ra khỏi hàng đợi TRƯỚC khi chạy: không chạy 2 lần
      if (!job || Date.now() - job.at > JOB_MAX_AGE_MS_) return;
      CacheService.getScriptCache().put('DONE_' + k.slice(JOB_PREFIX_.length), '1', 21600);
      runJob_(job);
    });
  } finally {
    lock.releaseLock();
  }
  // Có lệnh mới xếp hàng trong lúc đang chạy (trigger của nó đã bị dọn) → hẹn lại 1 lần
  try { if (hasPendingJobs_()) scheduleProcess_(); } catch (e) { console.error('hẹn lại lỗi: ' + String(e && e.message).slice(0, 200)); }
}
