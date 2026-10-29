/**
 * T4.1 — Hàng đợi việc, KHÔNG tạo trigger theo từng lệnh.
 * Bài học: trigger hẹn giờ tạo trong lúc Chat gọi bot gắn với "tài liệu" của add-on, không tự mất sau khi chạy và code không dọn được
 * → đầy giới hạn 20 → lỗi "too many time-based triggers". Nên:
 *   • Lệnh nhanh, không cần Claude (/campaigns, /report) chạy NGAY trong lúc nhận lệnh (vài giây, dưới giới hạn 30 giây của Chat)
 *   • Lệnh chậm (/ryg có giải thích, /analyze, /audit) chỉ XẾP VIỆC vào Script Properties (JOB_<id>); MỘT trigger cố định chạy mỗi phút
 *     (installTriggers tạo 1 lần từ trình soạn thảo) lấy việc ra làm rồi gửi kết quả vào đúng thread qua webhook của agent.
 *   • processJobs ghi "nhịp tim" mỗi phút: nếu không thấy nhịp tim thì bot báo ngay là chưa cài trigger, không xếp việc vào hư không.
 */

var JOB_PREFIX_ = 'JOB_';
var JOB_MAX_AGE_MS_ = 10 * 60 * 1000;
var HEARTBEAT_KEY_ = 'PROCESSOR_HEARTBEAT';
var HEARTBEAT_MAX_AGE_MS_ = 5 * 60 * 1000;
/** Lệnh chạy ngay (không gọi Claude) */
var INLINE_CMDS_ = ['campaigns', 'report'];

/** Id việc từ tên tin nhắn Chat (Chat có thể gửi lại cùng 1 sự kiện → không chạy 2 lần). */
function jobId_(info) {
  var base = String(info.messageName || ('m' + Date.now() + Math.floor(Math.random() * 1000)));
  return base.replace(/[^A-Za-z0-9]+/g, '_').slice(-70);
}

/** Nhận việc về mình: true = chưa ai làm (và đánh dấu đã nhận); false = đã làm / đang làm (Chat gửi lại sự kiện). */
function claimJob_(id) {
  var cache = CacheService.getScriptCache();
  if (cache.get('DONE_' + id)) return false;
  cache.put('DONE_' + id, '1', 21600);
  return true;
}

/** Bộ xử lý nền (trigger mỗi phút) còn sống không? */
function processorAlive_() {
  var t = Number(PropertiesService.getScriptProperties().getProperty(HEARTBEAT_KEY_) || 0);
  return t > 0 && Date.now() - t < HEARTBEAT_MAX_AGE_MS_;
}

/** true = đã xếp việc; false = việc này đã có / đã chạy (bỏ qua). */
function enqueueJob_(job) {
  var props = PropertiesService.getScriptProperties();
  var key = JOB_PREFIX_ + job.id;
  if (props.getProperty(key) !== null) return false;
  if (CacheService.getScriptCache().get('DONE_' + job.id)) return false;
  props.setProperty(key, JSON.stringify({ cmd: job.cmd, arg: String(job.arg || '').slice(0, 300), thread: job.thread || null, at: Date.now() }));
  return true;
}

/** Chạy 1 việc: trả kết quả vào thread của lệnh; lỗi thì báo lỗi dễ hiểu vào cùng thread. Trả số tin gửi được. */
function runJob_(job) {
  var agent = AGENT_FOR[job.cmd] || 'alerts';
  var messages;
  try {
    messages = handleCommand_(job.cmd, job.arg);
  } catch (e) {
    console.error('job ' + job.cmd + ' lỗi: ' + String(e && e.message).slice(0, 300));
    messages = [{ text: '⚠️ Em chưa làm xong lệnh /' + job.cmd + ': ' + friendlyError_(e) + '.' }];
  }
  var sent = 0;
  messages.forEach(function (m) {
    try { postToChat_(agent, m, job.thread); sent += 1; }
    catch (e) { console.error('gửi webhook ' + agent + ' lỗi: ' + String(e && e.message).slice(0, 300)); }
  });
  return sent;
}

/** Trigger cố định mỗi phút. Có `e` (sự kiện trigger) hay không đều chạy được. */
function processJobs(e) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(HEARTBEAT_KEY_, String(Date.now())); // nhịp tim: để Chat biết bộ xử lý còn sống
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return; // đang bận việc khác; phút sau trigger chạy lại, việc vẫn nằm trong hàng đợi
  try {
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
}
