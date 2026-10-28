/**
 * Nạp báo cáo Meta xuất tay từ Ads Manager (Reports → Export .xlsx / .csv). CHỈ ĐỌC file, không gọi Meta.
 * File phải có breakdown theo NGÀY và các cột ID (Campaign ID, Ad set ID, Ad ID) để khớp với CRM qua ad_id.
 * Cột custom conversion nhận theo TÊN (đối chiếu danh mục meta_custom_conversions) → action_type `offsite_conversion.custom.<id>`.
 * Hàm thuần: dùng chung cho Web (preview + ghi) và dòng lệnh `import:meta`.
 */
import { importAdRowToDaily } from './ingest';
import { customConversionAction } from './goal';
import { parseAdName, isSacCampaign } from './parse';
import type { Row } from './util';

export interface CustomConversionRef { id: string; name: string }
export interface MetaReportOptions {
  customConversions: CustomConversionRef[];
  /** Ngày hiện tại theo giờ PT (YYYY-MM-DD): từ chối ngày tương lai; ngày ≥ hôm nay đánh dấu provisional */
  todayPt: string;
}
export interface ReportAdRow {
  date: string; ad_id: string; ad_name: string; campaign_id: string; campaign_name: string; adset_id: string; adset_name: string;
  spend: number; impressions: number; reach: number; frequency: number; link_clicks: number; link_ctr: number; cpm: number;
  landing_page_views: number; leads: number; purchases: number; thruplay: number; outbound_clicks: number;
  video_3s: number; video_p25: number; video_p50: number; video_p75: number; video_p100: number;
}
export interface ActionRow { date: string; ad_id: string; campaign_id: string; action_type: string; count: number }
export interface MetaReportResult {
  ok: boolean;
  /** Lỗi chặn ghi (tiếng Việt, nói rõ cách sửa) */
  problems: string[];
  warnings: string[];
  rows: ReportAdRow[];
  actions: ActionRow[];
  campaigns: { id: string; name: string; spend: number; adRows: number }[];
  dateFrom: string | null; dateTo: string | null; days: number;
  totals: { spend: number; impressions: number };
  fileTotals: { spend: number | null; impressions: number | null };
  customUsed: { id: string; name: string; total: number }[];
  /** Cột trông như custom conversion (có cột "Cost per …" đi kèm) nhưng chưa có trong danh mục → đã bỏ qua */
  customUnknown: string[];
}

const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const ID_RE = /^\d{6,25}$/;
/** Ô của bảng: file thật cho chuỗi; test / nguồn khác có thể cho số. */
export type Cell = string | number | null | undefined;

/** Tên cột (đã chuẩn hóa) → trường. Hỗ trợ giao diện tiếng Anh và vài nhãn tiếng Việt thường gặp. */
const ALIASES: Record<string, string[]> = {
  date: ['day', 'date', 'ngày'],
  campaign_id: ['campaign id', 'id chiến dịch'],
  adset_id: ['ad set id', 'adset id', 'id nhóm quảng cáo'],
  ad_id: ['ad id', 'id quảng cáo'],
  campaign_name: ['campaign name', 'tên chiến dịch'],
  adset_name: ['ad set name', 'adset name', 'tên nhóm quảng cáo'],
  ad_name: ['ad name', 'tên quảng cáo'],
  impressions: ['impressions', 'lượt hiển thị'],
  reach: ['reach', 'phạm vi tiếp cận'],
  frequency: ['frequency', 'tần suất'],
  link_clicks: ['link clicks', 'lượt nhấp vào liên kết'],
  unique_link_clicks: ['unique link clicks'],
  landing_page_views: ['website landing page views', 'landing page views'],
  video_3s: ['3-second video plays'],
  thruplay: ['15-second thruplays', 'thruplays'],
  video_p25: ['video plays at 25%'], video_p50: ['video plays at 50%'], video_p75: ['video plays at 75%'], video_p100: ['video plays at 100%'],
  purchases: ['purchases'], website_purchases: ['website purchases'],
  leads: ['leads'], website_leads: ['website leads'],
  outbound_clicks: ['outbound clicks'],
  starts: ['reporting starts'], ends: ['reporting ends'],
};
const PREFIX: [string, string][] = [['spend', 'amount spent'], ['spend', 'số tiền đã chi tiêu'], ['cpm', 'cpm'], ['cpc', 'cpc'], ['link_ctr', 'ctr (link click-through rate)']];
/** Cột đã biết là chỉ số thường (để không nhầm với custom conversion) */
const KNOWN_METRIC_WORDS = /^(results?|result type|cost per .*|purchases?|website purchases|purchases conversion value|website purchases conversion value|result value type|results value|results roas|unique link clicks|post engagements|facebook likes|post reactions|post comments|post saves|post shares|hook|thruplay rate|hold rate.*|video plays at .*|results \(initial\)|reporting (starts|ends)|ctr .*|cpc .*|cpm .*)$/;

function fieldFor(header: Cell): string | null {
  const h = norm(header);
  if (!h) return null;
  for (const [f, names] of Object.entries(ALIASES)) if (names.includes(h)) return f;
  for (const [f, p] of PREFIX) if (h.startsWith(p)) return f;
  return null;
}

/** "2026-10-27" | số serial Excel (46322) | "10/27/2026" → "2026-10-27"; không hiểu → null */
export function parseReportDate(v: string): string | null {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? null : s;
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000); return d.toISOString().slice(0, 10); }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m && +m[1] <= 12) { const iso = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso; }
  return null;
}

const cellNum = (v: Cell): number => {
  const s = String(v ?? '').trim().replace(/^\$/, '');
  if (!s) return 0;
  const x = Number(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, '') : s);
  return Number.isFinite(x) ? x : 0;
};
const r2 = (x: number) => Math.round(x * 100) / 100;

export function parseMetaReport(table: Cell[][], opts: MetaReportOptions): MetaReportResult {
  const out: MetaReportResult = {
    ok: false, problems: [], warnings: [], rows: [], actions: [], campaigns: [], dateFrom: null, dateTo: null, days: 0,
    totals: { spend: 0, impressions: 0 }, fileTotals: { spend: null, impressions: null }, customUsed: [], customUnknown: [],
  };
  const header = table[0];
  if (!header || table.length < 2) { out.problems.push('File trống hoặc chỉ có dòng tiêu đề.'); return out; }

  const col: Record<string, number> = {};
  header.forEach((h, i) => { const f = fieldFor(h); if (f && col[f] === undefined) col[f] = i; });
  const byName = new Map(opts.customConversions.map((c) => [norm(c.name), c]));
  const customCols: { idx: number; ref: CustomConversionRef }[] = [];
  const headerNorm = header.map(norm);
  const unknown: string[] = [];
  header.forEach((h, i) => {
    const ref = byName.get(norm(h));
    if (ref) { customCols.push({ idx: i, ref }); return; }
    const n = norm(h);
    if (n && fieldFor(h) === null && !KNOWN_METRIC_WORDS.test(n) && headerNorm.includes(`cost per ${n}`)) unknown.push(String(h).trim());
  });
  out.customUnknown = unknown;
  if (unknown.length) out.warnings.push(`Cột "${unknown.join('", "')}" trông như custom conversion nhưng chưa có trong danh mục (meta_custom_conversions) nên đã bỏ qua.`);

  const get = (row: Cell[], f: string): string => (col[f] === undefined ? '' : String(row[col[f]] ?? '').trim());
  const data = table.slice(1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));

  // Dòng tổng của file: không có tên và không có ID
  const isTotal = (r: Cell[]) => !get(r, 'ad_id') && !get(r, 'campaign_id') && !get(r, 'ad_name') && !get(r, 'campaign_name');
  const totalRow = data.find(isTotal);
  if (totalRow) {
    out.fileTotals.spend = cellNum(get(totalRow, 'spend'));
    out.fileTotals.impressions = cellNum(get(totalRow, 'impressions'));
  } else out.warnings.push('File không có dòng tổng nên không đối chiếu được tổng chi tiêu.');

  // ---- Cột bắt buộc ----
  const missingIds = (['campaign_id', 'adset_id', 'ad_id'] as const).filter((f) => col[f] === undefined);
  if (missingIds.length) {
    const label = { campaign_id: 'Campaign ID', adset_id: 'Ad set ID', ad_id: 'Ad ID' } as const;
    out.problems.push(`Thiếu cột ${missingIds.map((f) => label[f]).join(', ')}. Cần ID để khớp với CRM (không dùng tên vì tên đổi / trùng). Trong Ads Manager: Columns → Customize → bật Campaign ID, Ad set ID, Ad ID.`);
  }
  const names = { campaign_name: 'Campaign name', adset_name: 'Ad set name', ad_name: 'Ad name' } as const;
  for (const f of ['campaign_name', 'adset_name', 'ad_name'] as const) if (col[f] === undefined) out.problems.push(`Thiếu cột ${names[f]}.`);
  if (col.spend === undefined) out.problems.push('Thiếu cột Amount spent (số tiền đã chi tiêu).');
  if (col.impressions === undefined) out.problems.push('Thiếu cột Impressions.');
  const hasDay = col.date !== undefined;
  const spansRange = !hasDay && col.starts !== undefined && col.ends !== undefined && data.some((r) => !isTotal(r) && get(r, 'starts') !== get(r, 'ends'));
  if (spansRange || (!hasDay && !(col.starts !== undefined && col.ends !== undefined))) {
    out.problems.push('Thiếu breakdown theo ngày (cột Day). Báo cáo đang gộp cả kỳ nên không vẽ được biểu đồ theo ngày và không so được với CRM theo ngày. Trong Ads Manager: Breakdown → Time → Day.');
  }
  if (out.problems.length) return out;
  if (col.link_clicks === undefined && col.unique_link_clicks !== undefined && col.cpc === undefined) {
    out.warnings.push('Chỉ có cột Unique link clicks (số người), không phải tổng Link clicks. Số click sẽ thấp hơn thực tế. Nên thêm cột Link clicks.');
  }

  const seen = new Set<string>();
  const camp = new Map<string, { id: string; name: string; spend: number; adRows: number; last: string }>();
  const bad: string[] = [];
  let badCount = 0;
  const flag = (msg: string) => { if (badCount++ < 8) bad.push(msg); };

  data.forEach((r, i) => {
    if (r === totalRow) return;
    const line = i + 2;
    let date: string | null;
    if (hasDay) date = parseReportDate(get(r, 'date'));
    else { const a = get(r, 'starts'), b = get(r, 'ends'); date = a && a === b ? parseReportDate(a) : null; }
    if (!date) { flag(`Dòng ${line}: ngày không hợp lệ${hasDay ? ` ("${get(r, 'date')}")` : ' (báo cáo gộp nhiều ngày, cần breakdown Day)'}.`); return; }
    if (date > opts.todayPt) { flag(`Dòng ${line}: ngày ${date} ở tương lai.`); return; }
    const ids = { campaign_id: get(r, 'campaign_id'), adset_id: get(r, 'adset_id'), ad_id: get(r, 'ad_id') };
    for (const [k, v] of Object.entries(ids)) {
      if (!ID_RE.test(v)) { flag(`Dòng ${line}: ${k} "${v}" không hợp lệ${/e\+/i.test(v) ? ' (Excel đổi ID sang số khoa học: xuất lại dạng CSV hoặc định dạng cột ID là văn bản)' : ''}.`); return; }
    }
    const key = `${date}|${ids.ad_id}`;
    if (seen.has(key)) { flag(`Dòng ${line}: trùng ad ${ids.ad_id} ngày ${date} (báo cáo có thêm breakdown khác ngoài Day?).`); return; }
    seen.add(key);

    const spend = cellNum(get(r, 'spend'));
    if (spend < 0) { flag(`Dòng ${line}: chi tiêu âm.`); return; }
    const cpc = cellNum(get(r, 'cpc'));
    let linkClicks = col.link_clicks !== undefined ? cellNum(get(r, 'link_clicks')) : 0;
    if (col.link_clicks === undefined) linkClicks = cpc > 0 ? Math.round(spend / cpc) : cellNum(get(r, 'unique_link_clicks'));
    const row: ReportAdRow = {
      date, ...ids, ad_name: get(r, 'ad_name'), campaign_name: get(r, 'campaign_name'), adset_name: get(r, 'adset_name'),
      spend: r2(spend), impressions: Math.round(cellNum(get(r, 'impressions'))), reach: Math.round(cellNum(get(r, 'reach'))), frequency: cellNum(get(r, 'frequency')),
      link_clicks: Math.round(linkClicks), link_ctr: cellNum(get(r, 'link_ctr')), cpm: cellNum(get(r, 'cpm')),
      landing_page_views: Math.round(cellNum(get(r, 'landing_page_views'))),
      leads: Math.round(cellNum(get(r, 'leads') || get(r, 'website_leads'))),
      purchases: Math.round(cellNum(get(r, 'purchases') || get(r, 'website_purchases'))),
      thruplay: Math.round(cellNum(get(r, 'thruplay'))), outbound_clicks: Math.round(cellNum(get(r, 'outbound_clicks'))),
      video_3s: Math.round(cellNum(get(r, 'video_3s'))), video_p25: Math.round(cellNum(get(r, 'video_p25'))), video_p50: Math.round(cellNum(get(r, 'video_p50'))),
      video_p75: Math.round(cellNum(get(r, 'video_p75'))), video_p100: Math.round(cellNum(get(r, 'video_p100'))),
    };
    out.rows.push(row);
    out.totals.spend += row.spend; out.totals.impressions += row.impressions;
    for (const c of customCols) {
      const n = Math.round(cellNum(r[c.idx]));
      if (n > 0) out.actions.push({ date, ad_id: row.ad_id, campaign_id: row.campaign_id, action_type: customConversionAction(c.ref.id), count: n });
    }
    const c = camp.get(row.campaign_id) ?? { id: row.campaign_id, name: '', spend: 0, adRows: 0, last: '' };
    c.spend += row.spend; c.adRows += 1;
    if (date >= c.last) { c.last = date; c.name = row.campaign_name || c.name; }
    camp.set(row.campaign_id, c);
  });
  if (bad.length) out.problems.push(...bad, ...(badCount > bad.length ? [`… và ${badCount - bad.length} lỗi khác.`] : []));
  if (!out.rows.length && !out.problems.length) out.problems.push('Không có dòng dữ liệu nào (chỉ có dòng tổng?).');

  out.totals.spend = r2(out.totals.spend);
  out.rows.sort((a, b) => a.date.localeCompare(b.date) || a.ad_id.localeCompare(b.ad_id));
  const dates = [...new Set(out.rows.map((r) => r.date))].sort();
  out.dateFrom = dates[0] ?? null; out.dateTo = dates[dates.length - 1] ?? null; out.days = dates.length;
  out.campaigns = [...camp.values()].map(({ last: _l, ...c }) => ({ ...c, spend: r2(c.spend) })).sort((a, b) => b.spend - a.spend);
  out.customUsed = customCols.map((c) => ({
    id: c.ref.id, name: c.ref.name,
    total: out.actions.filter((a) => a.action_type === customConversionAction(c.ref.id)).reduce((s, a) => s + a.count, 0),
  }));

  // Đối chiếu với dòng tổng của file (phát hiện file bị cắt / thiếu dòng)
  if (out.fileTotals.spend !== null && !out.problems.length) {
    const diff = Math.abs(out.totals.spend - out.fileTotals.spend);
    if (diff > Math.max(0.05, out.fileTotals.spend * 0.005)) {
      out.problems.push(`Tổng chi tiêu các dòng ($${out.totals.spend}) lệch dòng tổng của file ($${out.fileTotals.spend}). File có thể bị cắt hoặc thiếu dòng, xuất lại.`);
    }
  }
  const unlabeled = out.rows.filter((r) => !r.ad_name || !r.campaign_name).length;
  if (unlabeled) out.warnings.push(`${unlabeled} dòng thiếu tên ad / campaign.`);
  if (out.dateTo && out.dateTo >= opts.todayPt) out.warnings.push(`Có số của ngày ${opts.todayPt} (hôm nay giờ PT): số chưa chốt, đánh dấu tạm và được ghi đè khi nạp lại.`);
  out.ok = out.problems.length === 0;
  return out;
}

// ---------- Chuẩn hóa về bảng meta_ads_daily ----------
/** Cột thêm theo từng migration, mới nhất trước: DB chưa có cột → bỏ dần, vẫn ghi phần còn lại. */
export const OPTIONAL_DAILY_COLS: { migration: string; cols: string[] }[] = [
  { migration: 'video_retention', cols: ['video_p25', 'video_p50', 'video_p75', 'video_p100'] },
  { migration: 'conversion_goals', cols: ['video_3s', 'outbound_clicks'] },
];
const INT_COLS = ['impressions', 'reach', 'link_clicks', 'landing_page_views', 'leads_meta', 'purchases_meta', 'thruplay'];

/** Dòng ad (dạng inbox / báo cáo) → dòng meta_ads_daily. Dùng chung cho sync:push và import:meta. */
export function adRowsToDaily(adRows: Row[], accountId: string, nowIso: string, ptToday: string): Row[] {
  return adRows.map((r) => {
    const d = importAdRowToDaily(r, accountId, nowIso);
    d.video_3s = Math.round(Number(r.video_3s) || 0);
    d.outbound_clicks = Math.round(Number(r.outbound_clicks) || 0);
    for (const c of OPTIONAL_DAILY_COLS[0].cols) d[c] = Math.round(Number(r[c]) || 0);
    for (const c of INT_COLS) d[c] = Math.round(Number(d[c]) || 0);
    const parsed = parseAdName(r.ad_name);
    return { ...d, funnel_stage: d.funnel_stage || null, creative_format: d.creative_format || null, concept_key: parsed.conceptKey, provisional: d.date >= ptToday };
  });
}

/** Entity tối thiểu cho campaign / adset / ad chưa có trong meta_entities (không ghi đè dòng đã có từ sync). */
export function missingEntityRows(rows: ReportAdRow[], accountId: string, existing: Set<string>, nowIso: string): Row[] {
  const out = new Map<string, Row>();
  const add = (level: 'campaign' | 'adset' | 'ad', id: string, name: string, campaignId: string, adsetId: string) => {
    const key = `${level}||${id}`;
    if (existing.has(key) || out.has(key)) return;
    out.set(key, {
      level, id, name: name || null, account_id: accountId, campaign_id: campaignId, adset_id: level === 'ad' ? adsetId : '',
      is_sac: level === 'campaign' ? isSacCampaign(name) : false, last_seen_at: nowIso,
    });
  };
  for (const r of rows) {
    add('campaign', r.campaign_id, r.campaign_name, r.campaign_id, '');
    add('adset', r.adset_id, r.adset_name, r.campaign_id, '');
    add('ad', r.ad_id, r.ad_name, r.campaign_id, r.adset_id);
  }
  return [...out.values()];
}
