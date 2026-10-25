import { describe, it, expect } from 'vitest';
import { buildProjectReport, buildShareSnapshot, hideMoneyInReport } from '../src/index';

const CAMP = '120252652862560233';
const AD = '120252750913970233';
const row = (date: string, spend: number, extra: Record<string, unknown> = {}) => ({
  date, ad_id: AD, campaign_id: CAMP, campaign_name: 'COACH-WBN-RE-PC-SAC', adset_id: '120252703228760233', adset_name: 'MOF', ad_name: 'Video ban doc_WARM_MOF',
  creative_concept: 'Video ban doc', concept_key: 'video ban doc', creative_format: 'video', funnel_stage: 'MOFU', spend, impressions: 1000, link_clicks: 20,
  leads_meta: 0, purchases_meta: 2, landing_page_views: 15, provisional: false, ...extra,
});
const report = buildProjectReport({
  metaRows: [row('2026-10-20', 123.45), row('2026-10-21', 76.55)], campaignIds: [CAMP],
  submissions: [{ conversion_id: 'c-1', project_id: 'p', contact_id: '257000000001', converted_on: '2026-10-20', ad_id: AD, campaign_id: CAMP, placement: 'Facebook_Mobile_Reels', source_hint: 'tracked' }],
  deals: [{ deal_id: '1', contact_ids: ['257000000001'], deal_type: 'seat', is_won: true, amount: 997.77 }],
});

describe('buildShareSnapshot', () => {
  it('không có contact_id / deal_id / email trong snapshot', () => {
    const s = buildShareSnapshot({ title: 'Báo cáo', projectName: 'Webinar RE11', report, src: 'both', hideMoney: false });
    const json = JSON.stringify(s);
    expect(json).not.toContain('257000000001');
    const { daily: _daily, ...withoutDaily } = s.report; // daily.spend là chỉ số tương đối 0–100, không phải tiền
    expect(JSON.stringify(withoutDaily)).not.toMatch(/contact_id|deal_id|@/);
    expect(s.report.total.meta.spend).toBe(200);
    expect(s.report.total.crm.revenue).toBe(997.77);
  });
  it('ẩn số tiền: không còn BẤT KỲ số tiền nào trong JSON, vẫn giữ số đếm và tỉ lệ', () => {
    const s = buildShareSnapshot({ title: 'Báo cáo', projectName: 'Webinar RE11', report, src: 'both', hideMoney: true });
    const json = JSON.stringify(s);
    for (const secret of ['123.45', '76.55', '997.77', '"spend":200', '"revenue":997']) expect(json).not.toContain(secret);
    const { daily: _daily, ...withoutDaily } = s.report; // daily.spend là chỉ số tương đối 0–100, không phải tiền
    expect(JSON.stringify(withoutDaily)).not.toMatch(/"(spend|revenue|seatRevenue|programRevenue|cpaSeat|cpl|cpaMeta|cpm|cost|cpaReal)":[1-9]/);
    expect(s.report.total.meta.spend).toBeNull();
    expect(s.report.total.crm).toMatchObject({ revenue: null, cpaSeat: null, seats: 1, leads: 1 });
    expect(s.report.total.meta).toMatchObject({ purchases: 4, impressions: 2000 });
    expect(s.report.total.crm.cashRoas).toBe(4.99); // tỉ lệ vẫn được phép hiện
    expect(s.report.primary.cost).toBeNull();
    expect(s.report.tree[0].children[0].children[0].meta.spend).toBeNull();
    expect(s.report.concepts[0].meta.spend).toBeNull();
  });
  it('biểu đồ theo ngày chuyển sang chỉ số tương đối (cao nhất = 100)', () => {
    const r = hideMoneyInReport(report);
    expect(r.daily.map((d) => d.spend)).toEqual([100, 62]);
  });
  it('không sửa báo cáo gốc', () => {
    hideMoneyInReport(report);
    expect(report.total.meta.spend).toBe(200);
  });
  it('chặn nếu có email lọt vào (vd tên ad chứa email)', () => {
    const bad = buildProjectReport({ metaRows: [row('2026-10-20', 5, { ad_name: 'nguyen@evancoaching.net' })], campaignIds: [CAMP] });
    expect(() => buildShareSnapshot({ title: 't', projectName: 'p', report: bad, src: 'meta', hideMoney: false })).toThrow(/dữ liệu cá nhân/);
  });
});
