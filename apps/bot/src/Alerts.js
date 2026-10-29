/**
 * T1.5 — Nhắc việc sau sync. Trigger `tick` chạy mỗi 10 phút (cài bằng installTriggers()).
 * Trạng thái (đã báo run nào) lưu ở Script Properties ALERT_STATE.
 */
function tick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var state = {};
    try { state = JSON.parse(props.getProperty('ALERT_STATE') || '{}'); } catch (e) { state = {}; }
    var now = new Date();
    var since = Utilities.formatDate(new Date(now.getTime() - 3 * 86400000), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
    var runs = botRead_('v_sync_status', since);
    var plan = planAlerts({
      nowMs: now.getTime(),
      ptNow: Utilities.formatDate(now, 'America/Los_Angeles', 'yyyy-MM-dd HH:mm'),
      vnNow: Utilities.formatDate(now, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm'),
      runs: runs,
      state: state
    });
    plan.actions.forEach(function (a) {
      if (a.type === 'sync_ok') {
        var target = a.run.target_date;
        var summary = summarizeDay(target, botRead_('v_campaign_daily', target), botRead_('v_signals_latest'));
        postToChat_('alerts', syncOkMessage_(a, summary));
      } else {
        postToChat_('alerts', { text: alertText(a, null) });
      }
    });
    // Chỉ lưu trạng thái sau khi gửi xong (lỗi giữa chừng → lần sau gửi lại)
    props.setProperty('ALERT_STATE', JSON.stringify(plan.state));
  } finally {
    lock.releaseLock();
  }
}

/** Chạy tay 1 lần trong editor: cài trigger tick (10 phút) và processJobs (1 phút), xóa bản cũ. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'tick' || h === 'processJobs') ScriptApp.deleteTrigger(t); // cả trigger processJobs 1 lần của bản cũ
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('processJobs').timeBased().everyMinutes(1).create();
  Logger.log('Đã cài 2 trigger: tick mỗi 10 phút (nhắc việc sau sync) và processJobs mỗi 1 phút (xử lý lệnh chậm của Chat).');
  processJobs(); // ghi nhịp tim ngay để Chat biết bộ xử lý đã sống
}

/** Chạy tay để kiểm tra kết nối: đọc Supabase + gửi 1 tin thử vào Bé Sugar Alerts. */
function testConnection() {
  var runs = botRead_('v_sync_status');
  Logger.log('Đọc được ' + runs.length + ' dòng sync_runs. Mới nhất: ' + JSON.stringify(runs[0] || null));
  postToChat_('alerts', { text: '✅ Bé Sugar đã kết nối Cohort OS (đọc được ' + runs.length + ' lần sync). Tin thử, anh bỏ qua nha.' });
}

/** Quên trạng thái đã báo (để gửi lại tin của lần sync gần nhất). */
function resetAlertState() {
  PropertiesService.getScriptProperties().deleteProperty('ALERT_STATE');
}
