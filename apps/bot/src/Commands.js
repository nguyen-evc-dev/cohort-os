/**
 * T4.2 / T4.4 / T4.5 — Thực thi lệnh. Mỗi hàm trả về MẢNG tin nhắn (card / text) để Jobs.js gửi qua webhook của agent.
 * Đọc dữ liệu chỉ qua botRead_ (view bot.v_*, chỉ đọc). Không có gì ở đây chạm vào Meta.
 */

var NO_SNAPSHOT_TEXT_ = 'Em chưa có bản chụp báo cáo nào để đọc. Sếp chạy `npm run sync:snapshots` (hoặc sync / import report Meta) trên máy rồi gõ lại nha.';
var DEFAULT_QUESTION_ = 'Phân tích tổng quan: khâu nào đang yếu nhất và 3 việc nên làm trước?';

function handleCommand_(cmd, arg) {
  if (cmd === 'campaigns') return [campaignsCard_(botRead_('v_campaigns'), webBaseUrl_())];
  if (cmd === 'report') return doReport_(arg);
  if (cmd === 'ryg') return doRyg_(arg);
  if (cmd === 'analyze') return doAnalyze_(arg);
  if (cmd === 'audit') return doAudit_(arg);
  return [{ text: helpText_() }];
}

function pickSnapshot_(arg) {
  var a = parseReportArg_(arg);
  var snaps = botRead_('v_project_snapshot');
  if (!snaps.length) return { empty: true };
  var r = resolveSnapshot_(snaps, a.rest, a.range);
  var note = null;
  if (r.row && r.defaulted) note = (a.rest ? 'Em không thấy "' + a.rest + '" nên lấy ' : 'Anh chưa chọn Project nên em lấy ') + 'Project có chi tiêu cao nhất: ' + (r.row.name || r.row.slug) + '.';
  return { a: a, r: r, note: note, empty: !r.row };
}

// ---------- /report ----------
function doReport_(arg) {
  var p = pickSnapshot_(arg);
  if (p.empty) return [{ text: NO_SNAPSHOT_TEXT_ }];
  return [reportCard_(p.r.row, p.r.campaign, p.a.range, webBaseUrl_(), p.note)];
}

// ---------- /ryg ----------
function doRyg_(arg) {
  var p = pickSnapshot_(arg);
  var useProject = !p.empty && !p.r.defaulted;
  var signals, title, asOf, slug = null;
  if (useProject) {
    signals = p.r.row.payload.signals || []; title = p.r.row.name; asOf = p.r.row.payload.signals_as_of || p.r.row.as_of; slug = p.r.row.slug;
  } else {
    signals = rawSignalsToPayload_(botRead_('v_signals_latest'));
    title = 'toàn tài khoản';
    asOf = signals.length ? (botRead_('v_signals_latest')[0] || {}).as_of : null;
  }
  var out = [rygCard_(signals, title, asOf, webBaseUrl_(), slug)];
  if (signals.length && anthropicKey_()) {
    try {
      var payload = { scope: title, signals_as_of: asOf, signals: signals.slice(0, 12) };
      assertNoPii_(payload, 'ryg');
      var user = 'Giải thích ngắn các đèn sau cho anh (màu do code quyết định, em không đổi màu).\n\nDữ liệu (JSON):\n' + JSON.stringify(payload);
      var r = askGrounded_('ryg', systemPrompt_(['ryg-decision']), user, payload);
      out.push({ text: chatText_(r.text + ungroundedNote_(r.ungrounded)) });
    } catch (e) { logClaude_({ kind: 'claude_error', tag: 'ryg', error: String(e.message).slice(0, 200) }); }
  }
  return out;
}

// ---------- /analyze ----------
function doAnalyze_(arg) {
  if (!anthropicKey_()) return [{ text: 'Em chưa có ANTHROPIC_API_KEY trong Script Properties nên chưa phân tích sâu được. Lệnh /report vẫn dùng bình thường nha.' }];
  var p = pickSnapshot_(arg);
  if (p.empty) return [{ text: NO_SNAPSHOT_TEXT_ }];
  var question = String(arg || '').replace(/^\s+|\s+$/g, '').slice(0, 300) || DEFAULT_QUESTION_;
  var payload = p.r.row.payload;
  assertNoPii_({ question: question, payload: payload }, 'analyze');
  var user = 'Câu hỏi của anh: ' + question + '\n\nDữ liệu (JSON):\n' + JSON.stringify(payload);
  var r = askGrounded_('analyze:' + p.r.row.slug, systemPrompt_(['ads-deep-analysis', 'meta-ads-playbook']), user, payload);
  var head = '🔎 ' + (payload.project || p.r.row.name) + ' · ' + (RANGE_LABEL_[p.a.range] || p.a.range) + ' · số Meta tới ' + dayVn_(p.r.row.as_of) + (p.note ? '\n(' + p.note + ')' : '') + '\n\n';
  return [{ text: chatText_(head + r.text + ungroundedNote_(r.ungrounded)) }];
}

// ---------- /audit ----------
var AUDIT_MAX_ADS_ = 3;
var AUDIT_SEV_ICON_ = { red: '🔴', yellow: '🟡', info: 'ℹ️', green: '🟢' };

/** Che email / SĐT trong nội dung quảng cáo (công khai nhưng có thể có liên hệ) trước khi gửi Claude. */
function redactPii_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email ẩn]')
    .replace(/(\+\d{8,15})|(\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b)/g, '[sđt ẩn]');
}

function pickAdsForAudit_(rows, arg) {
  var q = norm_(arg);
  var id = (/\d{6,25}/.exec(String(arg)) || [])[0] || null;
  var list = rows;
  if (id) list = rows.filter(function (r) { return String(r.ad_id) === id || String(r.campaign_id) === id; });
  else if (q.length >= 2) {
    var tokens = q.split(' ').filter(function (w) { return w.length >= 2 && ['audit', 'kiem', 'tra', 'chinh', 'sach', 'campaign', 'ad', 'cho', 'cua'].indexOf(w) < 0; });
    var needle = tokens.join(' ');
    list = needle ? rows.filter(function (r) { var h = norm_(r.ad_name) + ' ' + norm_(r.campaign_name); return h.indexOf(needle) >= 0 || tokens.every(function (t) { return h.indexOf(t) >= 0; }); }) : rows;
  }
  if (!id && q.length < 2) list = rows.filter(function (r) { return r.effective_status === 'ACTIVE'; }).sort(function (a, b) { return (b.is_sac ? 1 : 0) - (a.is_sac ? 1 : 0) || Number(b.spend_30d) - Number(a.spend_30d); });
  return { matched: list.length, ads: list.slice(0, AUDIT_MAX_ADS_) };
}

function auditCard_(audits, matched) {
  var c = CohortCore.countFindings(audits);
  var sections = audits.map(function (a) {
    var lines = a.findings.map(function (f) {
      return (AUDIT_SEV_ICON_[f.severity] || '•') + ' ' + esc_(f.message) + (f.quote ? ' <i>("' + esc_(f.quote) + '")</i>' : '');
    });
    return { header: esc_(a.adName) + (a.isSac ? ' [SAC]' : ''), widgets: [para_(lines.join('<br>') || '🟢 Không thấy vấn đề code kiểm được.')] };
  });
  var sub = '🔴 ' + c.red + ' · 🟡 ' + c.yellow + ' · 🟢 ' + c.green + (matched > audits.length ? ' · khớp ' + matched + ' ad, soát ' + audits.length + ' ad chi tiêu cao nhất' : '');
  return card_('audit', '🛡️ Audit chính sách', sub, sections, [{ text: 'Mở Cohort OS', url: webBaseUrl_() + '/projects' }]);
}

function stripForeignUrls_(text, allowed) {
  return String(text).replace(/https?:\/\/[^\s)>\]"']+/g, function (u) {
    var clean = u.replace(/[.,;:!?]+$/, '');
    return allowed.indexOf(clean) >= 0 ? u : '[link đã ẩn]';
  });
}

function doAudit_(arg) {
  var rows = botRead_('v_ad_creatives');
  if (!rows.length) return [{ text: 'Em chưa có nội dung ad nào để audit. Cần sync số Meta (có copy + targeting) trước nha.' }];
  var pick = pickAdsForAudit_(rows, arg);
  if (!pick.ads.length) return [{ text: 'Em không thấy ad hay campaign nào khớp "' + String(arg).slice(0, 80) + '". Gõ /campaigns để xem tên, hoặc dán ID ad.' }];
  var audits = pick.ads.map(function (r) {
    return CohortCore.auditAd({ ad_id: r.ad_id, ad_name: r.ad_name, campaign_name: r.campaign_name, objective: r.objective, is_sac: r.is_sac, targeting_summary: r.targeting_summary, title: r.title, body: r.body, link_url: r.link_url, cta: r.cta });
  });
  var out = [auditCard_(audits, pick.matched)];

  if (anthropicKey_()) {
    var inScope = [];
    audits.forEach(function (a) { if (a.lp.url && inScope.indexOf(a.lp.url) < 0) inScope.push(a.lp.url); });
    var outScope = audits.filter(function (a) { return a.lp.scope === 'out'; }).map(function (a) { return a.adName; });
    var payload = {
      ads: pick.ads.map(function (r, i) {
        return {
          ad_id: r.ad_id, name: r.ad_name, campaign: r.campaign_name, is_sac: !!r.is_sac, objective: r.objective || null, cta: r.cta || null,
          title: redactPii_(r.title).slice(0, 300), body: redactPii_(r.body).slice(0, 1200), landing_page: audits[i].lp.url,
          fixed_findings: audits[i].findings.map(function (f) { return { severity: f.severity, code: f.code, message: f.message, quote: f.code === 'LP_OUT_OF_SCOPE' ? null : (f.quote || null) }; })
        };
      }),
      lp_in_scope: inScope, lp_out_of_scope: outScope.length ? outScope : []
    };
    try {
      assertNoPii_(payload, 'audit');
      var user = 'Audit các ad sau. Các kết luận trong fixed_findings do code tính, em không đổi.' +
        (inScope.length ? '\nLanding page được phép đọc (và chỉ các link này): ' + inScope.join(' , ') : '\nKhông có landing page nào trong phạm vi để đọc.') +
        '\n\nDữ liệu (JSON):\n' + JSON.stringify(payload);
      var tools = inScope.length ? [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 3, allowed_domains: CohortCore.AUDIT_DOMAINS.slice(), max_content_tokens: 15000 }] : undefined;
      var r = claudeRun_(systemPrompt_(['policy-sac-audit']), user, { maxTokens: 1500, tools: tools });
      var text = stripForeignUrls_(r.text, inScope);
      logClaude_({ kind: 'claude', tag: 'audit', model: CohortCore.INSIGHT_MODEL, input_chars: user.length, fetch_enabled: !!tools, answer: text.slice(0, 2000) });
      out.push({ text: chatText_(text) });
    } catch (e) {
      logClaude_({ kind: 'claude_error', tag: 'audit', error: String(e.message).slice(0, 200) });
      out.push({ text: 'Phần đọc nội dung / landing page em chưa làm được lần này (' + friendlyError_(e) + '). Các kết luận 🔴🟡 ở card trên do code tính nên vẫn đúng.' });
    }
  }
  return out;
}

/** Câu báo lỗi dễ hiểu, không lộ chi tiết kỹ thuật / key. */
function friendlyError_(e) {
  var m = String((e && e.message) || e);
  if (m.indexOf('NO_ANTHROPIC_KEY') === 0) return 'chưa có ANTHROPIC_API_KEY';
  if (m.indexOf('PII:') === 0) return 'dữ liệu có vẻ chứa email / SĐT nên em không gửi đi';
  if (/CLAUDE_HTTP_401/.test(m)) return 'API key Claude không hợp lệ';
  if (/CLAUDE_HTTP_429/.test(m)) return 'Claude đang giới hạn tốc độ, thử lại sau ít phút';
  if (/CLAUDE_HTTP_(5\d\d)/.test(m)) return 'Claude đang quá tải, thử lại sau';
  if (/CLAUDE_HTTP_400/.test(m)) return 'Claude từ chối yêu cầu (có thể web_fetch chưa được bật cho tổ chức)';
  if (/timed out|Timeout|deadline/i.test(m)) return 'quá thời gian chờ';
  return 'có lỗi khi xử lý';
}
