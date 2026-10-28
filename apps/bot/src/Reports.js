/**
 * T4.2 / T4.4 — Dựng card cho /campaigns, /report, /ryg từ dữ liệu bot.v_* (bản chụp báo cáo đã tính sẵn bằng code của Web).
 * HÀM THUẦN, không gọi API. Số nào hiện ra đều lấy nguyên văn từ dữ liệu, không tính lại ở đây (trừ đổi tỉ lệ sang %).
 * Card v2 của Chat không cho tự chọn màu / font: dùng cấu trúc + emoji + nút mở Cohort OS.
 */

function esc_(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtInt_(v) { return v === null || v === undefined || v === '' || isNaN(Number(v)) ? '—' : Math.round(Number(v)).toLocaleString('en-US'); }
function fmtMoneyOrDash_(v) { return v === null || v === undefined || v === '' || isNaN(Number(v)) ? '—' : fmtMoney_(v); }
function fmtRate_(v) { return v === null || v === undefined || isNaN(Number(v)) ? '—' : (Number(v) * 100).toFixed(1) + '%'; }
function dayVn_(iso) { var m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[2] + '/' + m[1] : '—'; }
function costLabel_(stepLabel) { return /lead|đăng ký|dang ky|form|regist|check ?out/i.test(String(stepLabel)) ? 'CPL' : 'CPA'; }

function kv_(label, text) { return { decoratedText: { topLabel: label, text: text, wrapText: true } }; }
function para_(html) { return { textParagraph: { text: html } }; }
function card_(id, title, subtitle, sections, buttons) {
  var secs = sections.filter(function (s) { return s && s.widgets && s.widgets.length; });
  if (buttons && buttons.length) {
    secs.push({ widgets: [{ buttonList: { buttons: buttons.map(function (b) { return { text: b.text, onClick: { openLink: { url: b.url } } }; }) } }] });
  }
  var header = { title: title };
  if (subtitle) header.subtitle = subtitle;
  return { cardsV2: [{ cardId: id, card: { header: header, sections: secs } }] };
}

var RANGE_LABEL_ = { '7d': '7 ngày gần nhất', '30d': '30 ngày gần nhất', all: 'toàn bộ thời gian' };
function rangeQuery_(range) { return range === '30d' ? '?d=30' : range === 'all' ? '?d=all' : ''; }
var LIGHT_ICON_ = { red: '🔴', yellow: '🟡', green: '🟢', grey: '⚪' };

function payloadSignalLine_(s) {
  var name = s.name || s.campaign || '—';
  var detail = s.type === 'burn' ? ('đã tiêu ' + fmtMoney_(s.spend) + ', 0 chuyển đổi (chuẩn ' + fmtMoney_(s.baseline) + ')')
    : s.type === 'scale' ? ('thấp hơn chuẩn ' + s.below_baseline + '%')
    : s.type === 'fatigue' ? ('frequency ' + s.frequency_7d + ', CTR giảm ' + s.ctr_drop + '%')
    : '';
  return esc_(name) + (detail ? ' · ' + esc_(detail) : '') + ' → ' + esc_(ACTION_LABELS[s.action] || s.action);
}

// ---------- /campaigns ----------
/** rows = bot.v_campaigns */
function campaignsCard_(rows, webBase) {
  var active = (rows || []).filter(function (c) { return c.effective_status === 'ACTIVE' || Number(c.spend_7d) > 0; });
  active.sort(function (a, b) {
    var aa = a.effective_status === 'ACTIVE' ? 1 : 0, bb = b.effective_status === 'ACTIVE' ? 1 : 0;
    return bb - aa || Number(b.spend_7d) - Number(a.spend_7d);
  });
  var running = active.filter(function (c) { return c.effective_status === 'ACTIVE'; }).length;
  var total7 = active.reduce(function (s, c) { return s + Number(c.spend_7d || 0); }, 0);
  var last = active.reduce(function (m, c) { return c.last_spend_date && String(c.last_spend_date) > m ? String(c.last_spend_date) : m; }, '');
  var lines = active.slice(0, 15).map(function (c) {
    var icon = c.effective_status === 'ACTIVE' ? '🟢' : c.effective_status === 'PAUSED' ? '⏸️' : '⚪';
    return icon + ' <b>' + esc_(c.name) + '</b>' + (c.is_sac ? ' <i>[SAC]</i>' : '') + '<br>' +
      '7 ngày ' + fmtMoney_(c.spend_7d) + ' · ' + dayVn_(last) + ' ' + fmtMoney_(c.spend_latest) + (c.project_slug ? ' · Project ' + esc_(c.project_slug) : ' · chưa gán Project');
  });
  var sections = [{ widgets: [para_(lines.length ? lines.join('<br><br>') : 'Chưa có campaign nào có chi tiêu gần đây.')] }];
  if (active.length > 15) sections.push({ widgets: [para_('<i>Còn ' + (active.length - 15) + ' campaign nữa, mở Cohort OS để xem đủ.</i>')] });
  return card_('campaigns', '📋 Campaign', running + ' đang chạy · tổng 7 ngày ' + fmtMoney_(total7) + ' · số tới ' + dayVn_(last), sections,
    [{ text: 'Mở Cohort OS', url: webBase + '/projects' }]);
}

// ---------- /report ----------
function stepLabelByKey_(payload, key) {
  var s = (payload.steps || []).filter(function (x) { return x.key === key; })[0];
  return s ? s.label : key;
}

function chainLines_(payload) {
  return (payload.steps || []).map(function (s) {
    if (!s.available) return '▫️ ' + esc_(s.label) + ': <i>chờ CRM</i>';
    var rate = s.rate_from_prev !== null && s.rate_from_prev !== undefined ? ' · ' + Number(s.rate_from_prev).toFixed(1) + '% từ bước trước' : '';
    return (s.source === 'crm' ? '🟩 ' : '🟦 ') + esc_(s.label) + ': <b>' + fmtInt_(s.count) + '</b> · ' + costLabel_(s.label) + ' ' + fmtMoneyOrDash_(s.cost) + rate;
  });
}

/** row = 1 dòng bot.v_project_snapshot; campaign = phần tử payload.campaigns (hoặc null) */
function reportCard_(row, campaign, range, webBase, note) {
  var p = row.payload || {};
  var total = p.total || {};
  var url = webBase + '/p/' + row.slug;
  var buttons = [
    { text: 'Mở báo cáo', url: url + rangeQuery_(range) },
    { text: 'Creative Vault', url: url + '/creatives' + rangeQuery_(range) },
    { text: 'Đèn RYG', url: url + '/ryg' }
  ];
  var title = (campaign ? '🔎 ' + campaign.campaign : '🔎 ' + (p.project || row.name));
  var subtitle = (campaign ? (p.project || row.name) + ' · ' : '') + (RANGE_LABEL_[range] || range) + ' · số Meta tới ' + dayVn_(row.as_of);
  var sections = [];
  if (note) sections.push({ widgets: [para_('<i>' + esc_(note) + '</i>')] });

  if (campaign) {
    var cs = campaign.steps || {};
    var rows = (p.steps || []).filter(function (s) { return cs[s.key]; }).map(function (s) {
      return '🟦 ' + esc_(s.label) + ': <b>' + fmtInt_(cs[s.key].count) + '</b> · ' + costLabel_(s.label) + ' ' + fmtMoneyOrDash_(cs[s.key].cost);
    });
    sections.push({ widgets: [
      kv_('Spend', '<b>' + fmtMoney_(campaign.spend) + '</b> · CPM ' + fmtMoneyOrDash_(campaign.cpm) + ' · CTR ' + fmtRate_(campaign.ctr)),
      para_(rows.length ? rows.join('<br>') : '<i>Campaign này chưa có số cho các bước Meta của mục tiêu.</i>')
    ] });
    return card_('report-' + row.slug + '-' + campaign.campaign_id, title, subtitle, sections, buttons);
  }

  var pr = p.primary || {};
  var hit = pr.target && pr.cost !== null && pr.cost !== undefined ? (Number(pr.cost) <= Number(pr.target) ? '🟢 đạt target ' + fmtMoney_(pr.target) : '🔴 vượt target ' + fmtMoney_(pr.target)) : '';
  var headline = '<b>' + esc_(pr.label || 'Chuyển đổi chính') + ': ' + fmtInt_(pr.count) + '</b> · ' + costLabel_(pr.label) + ' <b>' + fmtMoneyOrDash_(pr.cost) + '</b>' + (hit ? ' · ' + hit : '');
  var widgets = [kv_('Chuyển đổi chính' + (pr.fallback_meta ? ' (tạm dùng bước Meta, chờ CRM)' : ''), headline), kv_('Spend', '<b>' + fmtMoney_(total.spend) + '</b> · CPM ' + fmtMoneyOrDash_(total.cpm) + ' · CTR ' + fmtRate_(total.ctr))];
  var fin = p.final || {};
  if (fin.available && Number(fin.value) > 0) widgets.push(kv_('Bước cuối · ' + fin.label, fmtInt_(fin.count) + ' · giá trị ' + fmtMoney_(fin.value) + (fin.roas !== null && fin.roas !== undefined ? ' · ROAS ' + fin.roas + 'x (phụ)' : '')));
  sections.push({ widgets: widgets });
  sections.push({ header: 'Chuỗi chuyển đổi', widgets: [para_(chainLines_(p).join('<br>') || '<i>Chưa có bước nào.</i>')] });

  if (p.truth_gap && p.goal && p.goal.compare) {
    var g = p.truth_gap, ml = stepLabelByKey_(p, p.goal.compare.meta), cl = stepLabelByKey_(p, p.goal.compare.crm);
    var gapTxt = g.overreport_pct === null || g.overreport_pct === undefined ? '' : (Number(g.overreport_pct) > 0 ? ' · Meta báo nhiều hơn ' + g.overreport_pct + '%' : ' · Meta báo ít hơn ' + Math.abs(g.overreport_pct) + '%');
    sections.push({ header: 'Truth Gap', widgets: [para_('🟡 Meta <b>' + fmtInt_(g.meta_purchases) + '</b> ' + esc_(ml) + ' vs CRM <b>' + fmtInt_(g.crm_seats) + '</b> ' + esc_(cl) + gapTxt)] });
  }
  var vid = total.hook_rate !== null && total.hook_rate !== undefined ? 'Hook ' + fmtRate_(total.hook_rate) + ' · Hold ' + fmtRate_(total.hold_rate) : null;
  var concepts = (p.concepts || []).slice(0, 3).map(function (c) {
    return (LIGHT_ICON_[c.light] || '⚪') + ' ' + esc_(c.concept) + ' · ' + fmtMoney_(c.spend) + ' · ' + fmtInt_(c.primary_count) + ' chuyển đổi · ' + costLabel_(pr.label) + ' ' + fmtMoneyOrDash_(c.primary_cost);
  });
  if (concepts.length || vid) sections.push({ header: 'Creative', widgets: [para_((vid ? vid + '<br>' : '') + concepts.join('<br>'))] });
  var sig = p.signals || [];
  if (sig.length) {
    var n = function (c) { return sig.filter(function (s) { return s.color === c; }).length; };
    sections.push({ widgets: [kv_('Đèn (tín hiệu mới nhất)', '🔴 ' + n('red') + ' · 🟡 ' + n('yellow') + ' · 🟢 ' + n('green'))] });
  }
  if (p.goal && p.goal.configured === false) sections.push({ widgets: [para_('<i>Project chưa khai báo mục tiêu: đang đo theo Lead / Purchase mặc định của Meta. Vào Cohort OS → Project để khai báo.</i>')] });
  return card_('report-' + row.slug, title, subtitle, sections, buttons);
}

// ---------- /ryg ----------
/** signals = mảng tín hiệu dạng payload (đã gọn). title/asOf để hiển thị. Màu do code quyết định, ở đây chỉ trình bày. */
function rygCard_(signals, title, asOf, webBase, slug) {
  var groups = [['red', '🔴 Cần xử lý', 5], ['green', '🟢 Có thể tăng', 3], ['yellow', '🟡 Theo dõi', 4], ['grey', '⚪ Chưa đủ dữ liệu', 2]];
  var sections = [];
  groups.forEach(function (g) {
    var items = (signals || []).filter(function (s) { return s.color === g[0]; });
    if (!items.length) return;
    var shown = items.slice(0, g[2]).map(function (s) { return payloadSignalLine_(s); });
    if (items.length > g[2]) shown.push('<i>… và ' + (items.length - g[2]) + ' tín hiệu nữa</i>');
    sections.push({ header: g[1] + ' (' + items.length + ')', widgets: [para_(shown.join('<br><br>'))] });
  });
  if (!sections.length) sections.push({ widgets: [para_('Chưa có tín hiệu nào cho ngày này.')] });
  return card_('ryg' + (slug ? '-' + slug : ''), '🚦 Đèn ' + title, 'Tính theo số Meta ngày ' + dayVn_(asOf) + ' · màu do code quyết định', sections,
    [{ text: 'Mở Đèn RYG', url: webBase + (slug ? '/p/' + slug + '/ryg' : '/') }]);
}

/** v_signals_latest (hàng thô) → dạng gọn như payload.signals, dùng khi không chọn Project. */
function rawSignalsToPayload_(rows) {
  return (rows || []).map(function (s) {
    var n = s.numbers || {};
    return {
      color: s.color, type: s.type, level: s.level, name: n.entity_name || n.campaign_name || s.entity_id, campaign: n.campaign_name || null, action: s.action,
      spend: n.spend === undefined ? null : n.spend, baseline: n.baseline === undefined ? null : n.baseline, frequency_7d: n.frequency_7d === undefined ? null : n.frequency_7d,
      ctr_drop: n.ctr_drop === undefined ? null : n.ctr_drop, below_baseline: n.below_baseline === undefined ? null : n.below_baseline
    };
  }).sort(function (a, b) { return Number(b.spend || 0) - Number(a.spend || 0); });
}
