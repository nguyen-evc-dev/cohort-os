/**
 * T4.1 / T4.4 — Định tuyến lệnh. HÀM THUẦN (không gọi API), có test.
 *   • norm_              chuẩn hóa chữ: bỏ dấu tiếng Việt, hạ chữ thường
 *   • classifyIntent_    câu tự do khi @Bé Sugar → lệnh phù hợp (luật từ khóa, không tốn token)
 *   • parseReportArg_    "/report webinar 30d" → { range, rest }
 *   • resolveSnapshot_   chọn Project / campaign từ chữ người dùng gõ
 * Tin người dùng gõ chỉ là DỮ LIỆU: chỉ dùng để chọn lệnh và tìm tên, không bao giờ đưa vào system prompt.
 */

/** lệnh → agent (webhook) trả lời. Thiếu webhook của agent thì Cards.js dùng Alerts thay thế. */
var AGENT_FOR = { campaigns: 'analyst', report: 'analyst', analyze: 'analyst', ryg: 'ryg', audit: 'auditor' };

function norm_(s) {
  return String(s === null || s === undefined ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
}

/** { cmd: 'help'|'campaigns'|'report'|'ryg'|'analyze'|'audit', arg } cho câu tự do. Mặc định: analyze (hỏi tự do). */
function classifyIntent_(text) {
  var t = norm_(text);
  if (!t) return { cmd: 'help', arg: '' };
  var has = function (re) { return re.test(t); };
  var cmd;
  if (has(/(^| )(help|huong dan|lam duoc gi|biet lam gi)( |$)/)) cmd = 'help';
  else if (has(/(audit|chinh sach|policy|vi pham|(^| )sac( |$)|landing|duyet|bi tu choi|reject)/)) cmd = 'audit';
  else if (has(/(phan tich|tai sao|vi sao|nen lam gi|chan doan|insight|giai thich|lam sao)/)) cmd = 'analyze';
  else if (has(/((^| )ryg( |$)|den (do|vang|xanh|giao thong)|tin hieu|nen tat|nen tang budget|scale|burn|fatigue|met moi)/)) cmd = 'ryg';
  else if (has(/(danh sach campaign|campaign nao|dang chay|liet ke campaign|list campaign)/)) cmd = 'campaigns';
  else if (has(/(bao cao|report|tom tat|ket qua|so lieu|chi tieu|spend)/)) cmd = 'report';
  else cmd = 'analyze';
  return { cmd: cmd, arg: String(text || '').replace(/^\s+|\s+$/g, '') };
}

/** Tách khoảng ngày khỏi phần còn lại: "webinar re11 30d" → { range:'30d', rest:'webinar re11' }. Mặc định 7d. */
function parseReportArg_(arg) {
  var rest = ' ' + norm_(arg) + ' ';
  var range = '7d';
  var m = /\s(7d|7 ngay|30d|30 ngay|all|tat ca|toan bo)\s/.exec(rest);
  if (m) {
    range = /^30/.test(m[1]) ? '30d' : /^7/.test(m[1]) ? '7d' : 'all';
    rest = rest.replace(m[0], ' ');
  }
  return { range: range, rest: rest.replace(/^\s+|\s+$/g, '') };
}

/**
 * Chọn bản chụp: snapshots = bot.v_project_snapshot (mọi Project × khoảng ngày).
 * Trả { row, campaign, defaulted, query }. campaign = dòng trong payload.campaigns nếu chữ gõ trùng tên campaign.
 */
function resolveSnapshot_(snapshots, restText, range) {
  var rows = (snapshots || []).filter(function (s) { return s.range_key === range; });
  var q = norm_(restText);
  var projects = rows.filter(function (s) { return s.slug !== 'all'; });
  var spendOf = function (s) { return Number(s.payload && s.payload.total && s.payload.total.spend || 0); };
  var res = { row: null, campaign: null, defaulted: false, query: q };
  if (q.length >= 2) {
    var byProject = projects.filter(function (s) { var n = norm_(s.name), sl = norm_(s.slug); return n.indexOf(q) >= 0 || q.indexOf(n) >= 0 || sl.indexOf(q) >= 0 || q.indexOf(sl) >= 0; });
    if (byProject.length) { res.row = byProject.sort(function (a, b) { return spendOf(b) - spendOf(a); })[0]; return res; }
    for (var i = 0; i < projects.length; i++) {
      var camps = (projects[i].payload && projects[i].payload.campaigns) || [];
      var hit = camps.filter(function (c) { return norm_(c.campaign).indexOf(q) >= 0; })[0];
      if (hit) { res.row = projects[i]; res.campaign = hit; return res; }
    }
    // Câu tự do ("báo cáo webinar tuần này"): thử từng từ đáng kể (bỏ từ phổ thông)
    var tokens = q.split(' ').filter(function (w) { return w.length >= 4 && STOP_WORDS_.indexOf(w) < 0; });
    if (tokens.length) {
      var scored = projects.map(function (s) {
        var hay = norm_(s.name) + ' ' + norm_(s.slug);
        return { s: s, score: tokens.filter(function (w) { return hay.indexOf(w) >= 0; }).length };
      }).filter(function (x) { return x.score > 0; }).sort(function (a, b) { return b.score - a.score || spendOf(b.s) - spendOf(a.s); });
      if (scored.length) { res.row = scored[0].s; return res; }
    }
  }
  res.defaulted = true;
  res.row = projects.filter(function (s) { return spendOf(s) > 0; }).sort(function (a, b) { return spendOf(b) - spendOf(a); })[0] || rows.filter(function (s) { return s.slug === 'all'; })[0] || null;
  return res;
}

var STOP_WORDS_ = ['bao', 'cao', 'report', 'phan', 'tich', 'campaign', 'project', 'cho', 'cua', 'tuan', 'nay', 'thang', 'ngay', 'sao', 'nao', 'hom', 'qua', 'dang', 'chay', 'tom', 'tat', 'ket', 'spend', 'cac', 'nhung', 'khong', 'cua', 'anh', 'minh', 'cho', 'toi', 'hien', 'tai', 'xem', 'giup', 'dung', 'nen', 'lam', 'gi'];

/** Tên lệnh gõ trong Chat → mã nội bộ (lệnh gạch chéo). */
var COMMAND_BY_ID = { 1: 'campaigns', 2: 'report', 3: 'ryg', 4: 'analyze', 5: 'audit', 6: 'help' };
