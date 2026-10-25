/**
 * Bé Sugar — logic nhắc việc sau sync (T1.5). HÀM THUẦN: không gọi API, không đọc Properties.
 * Chạy được cả trong Apps Script (global) lẫn Node (test Vitest nạp file bằng vm).
 *
 * planAlerts(input) → { actions: [...], state }
 *   input.ptNow     'YYYY-MM-DD HH:mm' giờ America/Los_Angeles (lúc chạy)
 *   input.vnNow     'YYYY-MM-DD HH:mm' giờ Asia/Ho_Chi_Minh
 *   input.nowMs     epoch ms
 *   input.runs      bot.v_sync_status (mới nhất trước): { id, kind, target_date, status, started_at, finished_at, rows, problems, note }
 *   input.state     { notified: [runId], missingFor: 'YYYY-MM-DD'|null, reminded: [runId] }
 */

var ALERT_RULES = {
  quietStartHour: 22,        // 22:00–08:00 VN: không gửi gì
  quietEndHour: 8,
  missingAfterPtMinutes: 90, // 01:30 PT = 15:30 VN (PDT) / 16:30 VN (PST)
  missingUntilPtMinutes: 360,
  reminderAfterHours: 2,
  maxAgeHours: 20,           // bỏ qua lần sync quá cũ (vd lần đầu cài bot)
  keepIds: 30
};

function addDaysStr_(dateStr, n) {
  var p = String(dateStr).split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n));
  return d.toISOString().slice(0, 10);
}

function minutesOf_(hhmm) {
  var t = String(hhmm).split(' ')[1] || '00:00';
  var p = t.split(':');
  return Number(p[0]) * 60 + Number(p[1]);
}

function planAlerts(input) {
  var rules = ALERT_RULES;
  var state = {
    notified: ((input.state && input.state.notified) || []).slice(),
    missingFor: (input.state && input.state.missingFor) || null,
    reminded: ((input.state && input.state.reminded) || []).slice()
  };
  var actions = [];
  var vnHour = Math.floor(minutesOf_(input.vnNow) / 60);
  if (vnHour >= rules.quietStartHour || vnHour < rules.quietEndHour) return { actions: actions, state: state };

  var runs = (input.runs || []).filter(function (r) { return r.kind === 'meta'; });
  var ageHours = function (iso) { return (input.nowMs - new Date(iso).getTime()) / 3600000; };

  // ① Sync vừa xong (ok / bị từ chối / lỗi) mà chưa báo
  runs.slice().reverse().forEach(function (r) {
    if (!r.finished_at || r.status === 'running' || state.notified.indexOf(r.id) >= 0) return;
    if (ageHours(r.finished_at) > rules.maxAgeHours) return;
    actions.push({ type: r.status === 'ok' ? 'sync_ok' : 'sync_failed', run: r });
    state.notified.push(r.id);
  });

  // ② Quá 01:30 PT mà chưa có lần sync nào cho ngày PT hôm qua
  var ptDate = String(input.ptNow).split(' ')[0];
  var target = addDaysStr_(ptDate, -1);
  var ptMin = minutesOf_(input.ptNow);
  var hasRunForTarget = runs.some(function (r) { return r.target_date === target; });
  if (!hasRunForTarget && ptMin >= rules.missingAfterPtMinutes && ptMin < rules.missingUntilPtMinutes && state.missingFor !== target) {
    actions.push({ type: 'sync_missing', targetDate: target });
    state.missingFor = target;
  }

  // ③ 2 giờ sau sync thành công mà chưa có import HubSpot nào kể từ lúc đó → nhắc lần 2 (1 lần duy nhất)
  var lastOk = runs.filter(function (r) { return r.status === 'ok' && r.finished_at; })[0];
  if (lastOk && state.notified.indexOf(lastOk.id) >= 0 && state.reminded.indexOf(lastOk.id) < 0) {
    var age = ageHours(lastOk.finished_at);
    var imported = (input.runs || []).some(function (r) {
      return r.kind === 'hubspot_import' && new Date(r.started_at).getTime() >= new Date(lastOk.finished_at).getTime();
    });
    if (!imported && age >= rules.reminderAfterHours && age <= rules.maxAgeHours) {
      actions.push({ type: 'import_reminder', run: lastOk });
      state.reminded.push(lastOk.id);
    }
  }

  state.notified = state.notified.slice(-rules.keepIds);
  state.reminded = state.reminded.slice(-rules.keepIds);
  return { actions: actions, state: state };
}

// ---------- Tóm tắt số Meta cho tin E1 ----------

var ACTION_LABELS = {
  pause_ad: 'Tắt ad', replace_creative: 'Thay creative', increase_budget: 'Tăng budget +20%',
  hold: 'Giữ nguyên (đang learning)', wait: 'Chờ budget ổn định', trust_crm: 'Tin số CRM', wait_for_data: 'Chờ thêm dữ liệu'
};

function fmtMoney_(v) {
  var n = Math.round(Number(v || 0) * 100) / 100;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

/** Tổng của ngày target từ bot.v_campaign_daily + top đỏ/xanh từ bot.v_signals_latest. */
function summarizeDay(targetDate, campaignDaily, signals) {
  var spend = 0, leads = 0, purchases = 0, campaigns = 0;
  (campaignDaily || []).forEach(function (r) {
    if (String(r.date) !== targetDate) return;
    spend += Number(r.spend || 0); leads += Number(r.leads_meta || 0); purchases += Number(r.purchases_meta || 0);
    if (Number(r.spend || 0) > 0) campaigns += 1;
  });
  var sigs = (signals || []).filter(function (s) { return String(s.as_of) === targetDate; });
  var bySpend = function (a, b) { return Number((b.numbers || {}).spend || 0) - Number((a.numbers || {}).spend || 0); };
  var red = sigs.filter(function (s) { return s.color === 'red'; }).sort(bySpend)[0] || null;
  var green = sigs.filter(function (s) { return s.color === 'green'; })[0] || null;
  return {
    spend: Math.round(spend * 100) / 100, leads: leads, purchases: purchases, campaigns: campaigns,
    cpl: leads ? Math.round((spend / leads) * 100) / 100 : null,
    red: red, green: green,
    counts: {
      red: sigs.filter(function (s) { return s.color === 'red'; }).length,
      yellow: sigs.filter(function (s) { return s.color === 'yellow'; }).length,
      green: sigs.filter(function (s) { return s.color === 'green'; }).length
    }
  };
}

function signalLine_(s) {
  if (!s) return null;
  var n = s.numbers || {};
  var name = n.entity_name || n.campaign_name || s.entity_id;
  var detail = s.type === 'burn' ? ('đã tiêu ' + fmtMoney_(n.spend) + ', 0 chuyển đổi (chuẩn ' + fmtMoney_(n.baseline) + ')')
    : s.type === 'scale' ? ('CPA ' + fmtMoney_(n.cpa_window) + ' thấp hơn chuẩn ' + n.below_baseline + '%')
    : s.type === 'fatigue' ? ('frequency ' + n.frequency_7d + ', CTR giảm ' + n.ctr_drop + '%')
    : '';
  return name + (detail ? ' · ' + detail : '') + ' → ' + (ACTION_LABELS[s.action] || s.action);
}

/** Nội dung chữ của các tin (card dựng ở Cards.js). */
function alertText(action, summary) {
  if (action.type === 'sync_ok') {
    var r = action.run;
    var lines = ['☀️ Số Meta ngày ' + r.target_date + ' đã về: Spend ' + fmtMoney_(summary.spend) + ' · Lead ' + summary.leads +
      (summary.cpl !== null ? ' · CPL ' + fmtMoney_(summary.cpl) : '') + ' · ' + summary.campaigns + ' campaign có chi tiêu.'];
    lines.push('Đèn: 🔴 ' + summary.counts.red + ' · 🟡 ' + summary.counts.yellow + ' · 🟢 ' + summary.counts.green);
    if (summary.red) lines.push('🔴 ' + signalLine_(summary.red));
    if (summary.green) lines.push('🟢 ' + signalLine_(summary.green));
    lines.push('Sếp Nguyên ơi, xuất HubSpot nha 🙏');
    return lines.join('\n');
  }
  if (action.type === 'sync_failed') {
    var why = action.run.status === 'rejected'
      ? 'bị từ chối vì số không khớp tổng tài khoản (' + describeProblems_(action.run.problems) + ')'
      : 'lỗi: ' + String(action.run.note || 'không rõ').slice(0, 300);
    return '⚠️ Sync Meta ngày ' + action.run.target_date + ' ' + why + '.\nDB chưa đổi. Cách chạy lại: Claude Desktop → Scheduled → cohort-meta-sync-1405 → Run now (đợi 30 phút rồi thử lại nếu Meta chưa chốt số).';
  }
  if (action.type === 'sync_missing') {
    return '⏰ Sync Meta ngày ' + action.targetDate + ' chưa chạy. Có thể máy đang tắt/ngủ hoặc app Claude đang đóng.\nAnh mở app Claude là việc tự chạy bù, hoặc vào Scheduled → Run now.';
  }
  if (action.type === 'import_reminder') {
    return '🔔 Nhắc lần 2: số Meta ngày ' + action.run.target_date + ' đã về hơn 2 tiếng mà em chưa thấy file HubSpot. Sếp Nguyên export 2 file rồi import giúp em nha.';
  }
  return '';
}

function describeProblems_(problems) {
  var list = problems || [];
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) { list = []; } }
  if (!list.length) return 'không có chi tiết';
  return list.slice(0, 3).map(function (p) {
    if (p.ads_spend !== undefined) return p.date + ': ads ' + fmtMoney_(p.ads_spend) + ' vs tài khoản ' + fmtMoney_(p.account_spend);
    return (p.reason || 'lỗi') + (p.date ? ' ' + p.date : '');
  }).join('; ') + (list.length > 3 ? '; +' + (list.length - 3) + ' lỗi khác' : '');
}

var HUBSPOT_CHECKLIST = [
  '① Form submissions (Marketing → Forms → form của đợt → Submissions → Export): Conversion ID · Conversion Date · Conversion Page · Contact ID',
  '② Deals (view "nguyen-coaching", Create date 60 ngày): Record ID · Associated Contact IDs · Deal Name · Deal Stage · Amount · Create Date · Close Date',
  '⚠️ Không mở file bằng Excel trước khi import (Contact ID bị đổi thành 2.57E+11)'
];

if (typeof module !== 'undefined') {
  module.exports = { planAlerts: planAlerts, summarizeDay: summarizeDay, alertText: alertText, HUBSPOT_CHECKLIST: HUBSPOT_CHECKLIST, ALERT_RULES: ALERT_RULES };
}
