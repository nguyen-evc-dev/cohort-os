import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { adRowsToDaily, customConversionAction, missingEntityRows, parseMetaReport, parseReportDate, readCsv, readTable, readXlsx } from '../src/index';

/** Dựng file .xlsx nhỏ (sharedStrings + 1 sheet) để thử bộ đọc. */
function makeXlsx(rows: (string | number | null)[][]): Uint8Array {
  const shared: string[] = [];
  const idx = (s: string) => { let i = shared.indexOf(s); if (i < 0) { shared.push(s); i = shared.length - 1; } return i; };
  const col = (i: number) => String.fromCharCode(65 + i);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    if (v === null || v === '') return '';
    return typeof v === 'number' ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="s"><v>${idx(v)}</v></c>`;
  }).join('')}</row>`).join('');
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`),
    'xl/sharedStrings.xml': strToU8(`<?xml version="1.0"?><sst>${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`),
  });
}

const CHECKOUT = { id: '2050096562303283', name: 'WBN1126 - Check Out' };
const PURCHASED = { id: '1827050228714469', name: 'WBN1126 - Purchased' };
const CATALOG = [CHECKOUT, PURCHASED];
const CAMP = '120252652862560233', ADSET = '120252703228760233', AD1 = '120252750913970233', AD2 = '120252743565200233';

const HEADER = ['Day', 'Campaign ID', 'Ad set ID', 'Ad ID', 'Campaign name', 'Ad set name', 'Ad name', 'Amount spent (USD)', 'Impressions', 'Reach', 'Frequency',
  'CPM (cost per 1,000 impressions)', 'Link clicks', 'CPC (cost per link click)', 'CTR (link click-through rate)', 'Website landing page views',
  '3-second video plays', '15-second ThruPlays', 'Video plays at 25%', 'Video plays at 50%', 'Video plays at 75%', 'Video plays at 100%',
  'Purchases', 'WBN1126 - Check Out', 'Cost per WBN1126 - Check Out', 'WBN1126 - Purchased', 'Cost per WBN1126 - Purchased', 'Cost per purchase', 'Hook'];
const row = (day: string, ad: string, name: string, spend: number, extra: Partial<Record<string, string | number>> = {}) => {
  const v: Record<string, string | number> = {
    Day: day, 'Campaign ID': CAMP, 'Ad set ID': ADSET, 'Ad ID': ad, 'Campaign name': 'COACH-WBN-RE-PC-SAC', 'Ad set name': 'MOF', 'Ad name': name,
    'Amount spent (USD)': spend, Impressions: 1000, Reach: 800, Frequency: 1.25, 'CPM (cost per 1,000 impressions)': spend, 'Link clicks': 20, 'CPC (cost per link click)': spend / 20,
    'CTR (link click-through rate)': 2, 'Website landing page views': 15, '3-second video plays': 300, '15-second ThruPlays': 60, 'Video plays at 25%': 200,
    'Video plays at 50%': 150, 'Video plays at 75%': 90, 'Video plays at 100%': 30, Purchases: 2, 'WBN1126 - Check Out': 4, 'Cost per WBN1126 - Check Out': 5, 'WBN1126 - Purchased': 2,
    'Cost per WBN1126 - Purchased': 10, 'Cost per purchase': 10, Hook: 0.3, ...extra,
  };
  return HEADER.map((h) => v[h] ?? '');
};
const total = (spend: number, impressions: number) => HEADER.map((h) => (h === 'Amount spent (USD)' ? spend : h === 'Impressions' ? impressions : ''));
const good = () => [HEADER, total(110, 3000), row('2026-10-20', AD1, 'Video ban doc_WARM', 60), row('2026-10-20', AD2, 'Photo KV_WARM', 40, { 'WBN1126 - Purchased': '' }), row('2026-10-21', AD1, 'Video ban doc_WARM', 10)];
const opts = { customConversions: CATALOG, todayPt: '2026-10-28' };

describe('readXlsx / readCsv', () => {
  it('đọc .xlsx: chuỗi dùng chung, số, ô trống giữa dòng, ký tự đặc biệt', () => {
    const t = readXlsx(makeXlsx([['Ad name', 'Spend', 'Note'], ['Photo & KV <A> "q"', 12.5, ''], ['', 3, 'x+y']]));
    expect(t).toEqual([['Ad name', 'Spend', 'Note'], ['Photo & KV <A> "q"', '12.5'], ['', '3', 'x+y']]);
  });
  it('readTable chọn theo đuôi file; từ chối loại khác và file hỏng', () => {
    expect(readTable(makeXlsx([['a'], ['1']]), 'x.XLSX')).toEqual([['a'], ['1']]);
    expect(readTable(new TextEncoder().encode('a,b\n1,2\n'), 'x.csv')).toEqual([['a', 'b'], ['1', '2']]);
    expect(() => readTable(new Uint8Array(4), 'x.pdf')).toThrow(/xlsx hoặc .csv/);
    expect(() => readXlsx(new Uint8Array([1, 2, 3, 4]))).toThrow(/Không đọc được file Excel/);
  });
  it('CSV: BOM, ô có ngoặc kép / dấu phẩy / xuống dòng / ngoặc kép đôi, CRLF', () => {
    expect(readCsv('\uFEFFa,b\r\n"x, y","He said ""hi"""\r\n"multi\nline",3\r\n')).toEqual([['a', 'b'], ['x, y', 'He said "hi"'], ['multi\nline', '3']]);
  });
});

describe('parseReportDate', () => {
  it.each([['2026-10-27', '2026-10-27'], ['46322', '2026-10-27'], ['10/27/2026', '2026-10-27'], ['27/10/2026', null], ['2026-13-40', null], ['', null], ['abc', null]])('%s → %s', (v, e) => {
    expect(parseReportDate(v)).toBe(e);
  });
});

describe('parseMetaReport — báo cáo theo ngày có ID', () => {
  const r = parseMetaReport(good(), opts);
  it('đọc đủ dòng, đối chiếu đúng dòng tổng, khoảng ngày', () => {
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.rows).toHaveLength(3);
    expect(r.totals).toEqual({ spend: 110, impressions: 3000 });
    expect(r.fileTotals).toEqual({ spend: 110, impressions: 3000 });
    expect([r.dateFrom, r.dateTo, r.days]).toEqual(['2026-10-20', '2026-10-21', 2]);
  });
  it('chỉ số mỗi dòng: click, LPV, video 3s / ThruPlay / 25–100%, purchases', () => {
    expect(r.rows[0]).toMatchObject({ date: '2026-10-20', ad_id: AD2 < AD1 ? AD2 : AD1, impressions: 1000, link_clicks: 20, landing_page_views: 15, video_3s: 300, thruplay: 60, video_p25: 200, video_p50: 150, video_p75: 90, video_p100: 30, purchases: 2 });
  });
  it('custom conversion nhận theo TÊN → action_type theo ID, bỏ ô trống / 0', () => {
    const checkout = customConversionAction(CHECKOUT.id), purchased = customConversionAction(PURCHASED.id);
    expect(r.actions.filter((a) => a.action_type === checkout)).toHaveLength(3);
    expect(r.actions.filter((a) => a.action_type === purchased)).toHaveLength(2); // dòng AD2 ô Purchased trống
    expect(r.customUsed).toEqual([{ ...CHECKOUT, total: 12 }, { ...PURCHASED, total: 4 }]);
  });
  it('campaign tìm thấy, kèm chi tiêu', () => {
    expect(r.campaigns).toEqual([{ id: CAMP, name: 'COACH-WBN-RE-PC-SAC', spend: 110, adRows: 3 }]);
  });
  it('không có cột Link clicks → suy từ chi tiêu / CPC', () => {
    const t = good().map((rw, i) => rw.filter((_, c) => HEADER[c] !== 'Link clicks' || i === -1));
    const h = HEADER.filter((x) => x !== 'Link clicks');
    expect(h).not.toContain('Link clicks');
    const res = parseMetaReport(t, opts);
    expect(res.rows[0].link_clicks).toBe(20);
  });
  it('cột lạ có "Cost per" đi kèm mà chưa có trong danh mục → cảnh báo, không ghi nhầm', () => {
    const res = parseMetaReport(good(), { ...opts, customConversions: [CHECKOUT] });
    expect(res.customUnknown).toEqual(['WBN1126 - Purchased']);
    expect(res.warnings.join(' ')).toMatch(/WBN1126 - Purchased.*danh mục/);
    expect(res.actions.every((a) => a.action_type === customConversionAction(CHECKOUT.id))).toBe(true);
  });
  it('nhận file giao diện tiếng Việt cơ bản', () => {
    const vi = [['Ngày', 'ID chiến dịch', 'ID nhóm quảng cáo', 'ID quảng cáo', 'Tên chiến dịch', 'Tên nhóm quảng cáo', 'Tên quảng cáo', 'Số tiền đã chi tiêu (USD)', 'Lượt hiển thị'],
      ['2026-10-20', CAMP, ADSET, AD1, 'C', 'S', 'A', '12.5', '900']];
    const res = parseMetaReport(vi, opts);
    expect(res.ok).toBe(true);
    expect(res.rows[0]).toMatchObject({ spend: 12.5, impressions: 900 });
  });
});

describe('parseMetaReport — lỗi chặn ghi (nói rõ cách sửa)', () => {
  it('báo cáo gộp cả kỳ, không có ID (đúng như file mẫu thật 28/10)', () => {
    const agg = [['Campaign name', 'Ad set name', 'Ad name', 'WBN1126 - Check Out', 'Cost per WBN1126 - Check Out', 'Amount spent (USD)', 'Impressions', 'Reporting starts', 'Reporting ends'],
      ['', '', '', 78, 17.2, 1343.9, 55787, '2026-10-01', '2026-10-27'], ['COACH-WBN-RE-PC-SAC', 'MOF', 'Photo', 15, 14.5, 218.27, 9982, '2026-10-01', '2026-10-27']];
    const res = parseMetaReport(agg, opts);
    expect(res.ok).toBe(false);
    expect(res.problems.join('\n')).toMatch(/Thiếu cột Campaign ID, Ad set ID, Ad ID/);
    expect(res.problems.join('\n')).toMatch(/Breakdown → Time → Day/);
  });
  it('có ID nhưng gộp cả kỳ (Reporting starts ≠ ends) → báo thiếu breakdown Day', () => {
    const t = good().map((rw, i) => (i === 0 ? [...rw.slice(1), 'Reporting starts', 'Reporting ends'] : [...rw.slice(1), '2026-10-01', '2026-10-27']));
    const res = parseMetaReport(t, opts);
    expect(res.ok).toBe(false);
    expect(res.problems[0]).toMatch(/Thiếu breakdown theo ngày/);
  });
  it('xuất theo từng ngày không có cột Day nhưng Reporting starts = ends → dùng làm ngày', () => {
    const t = good().map((rw, i) => (i === 0 ? [...rw.slice(1), 'Reporting starts', 'Reporting ends'] : [...rw.slice(1), String(rw[0]), String(rw[0])]));
    t[1][t[1].length - 2] = ''; t[1][t[1].length - 1] = '';
    const res = parseMetaReport(t, opts);
    expect(res.ok).toBe(true);
    expect(res.rows.map((r) => r.date)).toEqual(['2026-10-20', '2026-10-20', '2026-10-21']);
  });
  it('ID bị Excel đổi sang số khoa học', () => {
    const g = good(); g[2][HEADER.indexOf('Ad ID')] = '1.20252750913970E+17';
    const res = parseMetaReport(g, opts);
    expect(res.problems.join(' ')).toMatch(/số khoa học/);
  });
  it('trùng (ngày, ad), ngày tương lai, chi tiêu âm', () => {
    const g = good(); g.push(row('2026-10-21', AD1, 'dup', 1)); g.push(row('2026-11-05', AD2, 'future', 1)); g.push(row('2026-10-22', AD2, 'neg', -3));
    const msgs = parseMetaReport(g, opts).problems.join('\n');
    expect(msgs).toMatch(/trùng ad/);
    expect(msgs).toMatch(/ở tương lai/);
    expect(msgs).toMatch(/chi tiêu âm/);
  });
  it('tổng các dòng lệch dòng tổng (file bị cắt) → chặn', () => {
    const g = good(); g[1] = total(250, 3000);
    const res = parseMetaReport(g, opts);
    expect(res.ok).toBe(false);
    expect(res.problems[0]).toMatch(/lệch dòng tổng.*bị cắt/);
  });
  it('ngày hôm nay (PT) → cảnh báo số chưa chốt', () => {
    const g = good(); g.push(row('2026-10-28', AD2, 'today', 0)); g[1] = total(110, 4000);
    expect(parseMetaReport(g, opts).warnings.join(' ')).toMatch(/chưa chốt/);
  });
  it('file trống', () => { expect(parseMetaReport([['a']], opts).problems).toEqual(['File trống hoặc chỉ có dòng tiêu đề.']); });
});

describe('adRowsToDaily / missingEntityRows', () => {
  const rep = parseMetaReport(good(), opts);
  it('ra dòng meta_ads_daily đủ cột video, concept từ tên ad, provisional theo ngày PT', () => {
    const d = adRowsToDaily(rep.rows as any, '763840845228631', '2026-10-28T10:00:00Z', '2026-10-21');
    const x = d.find((r) => r.ad_id === AD1 && r.date === '2026-10-21')!;
    expect(x).toMatchObject({ account_id: '763840845228631', spend: 10, video_3s: 300, video_p50: 150, thruplay: 60, concept_key: 'video ban doc', creative_format: 'video', provisional: true });
    expect(d.find((r) => r.date === '2026-10-20')!.provisional).toBe(false);
  });
  it('entity tối thiểu cho campaign / adset / ad chưa có; không ghi đè cái đã có; cờ SAC theo tên', () => {
    const rows = missingEntityRows(rep.rows, '763840845228631', new Set([`ad||${AD1}`]), '2026-10-28T10:00:00Z');
    expect(rows.map((e) => `${e.level}:${e.id}`).sort()).toEqual([`ad:${AD2}`, `adset:${ADSET}`, `campaign:${CAMP}`].sort());
    expect(rows.find((e) => e.level === 'campaign')).toMatchObject({ is_sac: true, name: 'COACH-WBN-RE-PC-SAC', adset_id: '' });
  });
});

// Chạy trên máy Nguyên khi có file thật; bỏ qua ở CI
const REAL = process.env.REAL_META_REPORT ?? 'D:/VIBE CODE/Cohort OS/reports-raw/Webinar-RE11-28.10.xlsx';
describe.skipIf(!fs.existsSync(REAL))('file xuất thật từ Ads Manager (28/10)', () => {
  const table = () => readTable(new Uint8Array(fs.readFileSync(REAL)), 'x.xlsx');
  it('đọc đúng 38 dòng + tiêu đề, dòng tổng khớp tổng các dòng', () => {
    const t = table();
    expect(t[0][0]).toBe('Campaign name');
    expect(t).toHaveLength(38);
    const res = parseMetaReport(t, opts);
    expect(res.fileTotals.spend).toBe(1343.9);
  });
  it('chưa nạp được: thiếu Day và ID, báo đúng cách sửa', () => {
    const res = parseMetaReport(table(), opts);
    expect(res.ok).toBe(false);
    expect(res.problems.join('\n')).toMatch(/Campaign ID, Ad set ID, Ad ID/);
    expect(res.problems.join('\n')).toMatch(/Day/);
    expect(res.customUnknown).toEqual([]);
  });
});
