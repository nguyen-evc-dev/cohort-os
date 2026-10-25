import { describe, it, expect } from 'vitest';
import { buildProjectReport, defaultRange, leadOutcomes, pickLeads } from '../src/report';

const P = 'p1';
const CAMP = '120252652862560233';
const OTHER = '120250767837710233';
const AD_VIDEO = '120252750913970233';
const AD_PHOTO = '120252743565200233';
const ADSET1 = '120252703228760233';
const ADSET2 = '120252743565210233';

const meta = (date: string, ad_id: string, o: Record<string, unknown> = {}) => ({
  date, ad_id, campaign_id: CAMP, campaign_name: 'COACH-WBN-RE-PC-SAC', adset_id: ADSET1, adset_name: 'MOF', ad_name: 'Video ban doc_WARM_MOF',
  creative_concept: 'Video ban doc', concept_key: 'video ban doc', creative_format: 'video', funnel_stage: 'MOFU',
  spend: 0, impressions: 0, link_clicks: 0, leads_meta: 0, purchases_meta: 0, landing_page_views: 0, provisional: false, ...o,
});
const photo = { adset_id: ADSET2, adset_name: 'USexc3', ad_name: 'Photo Poster KV_WARM', creative_concept: 'Photo Poster KV', concept_key: 'photo poster kv', creative_format: 'photo' };
const metaRows = [
  meta('2026-10-20', AD_VIDEO, { spend: 60, impressions: 3000, link_clicks: 60, purchases_meta: 2 }),
  meta('2026-10-21', AD_VIDEO, { spend: 40, impressions: 2000, link_clicks: 30, purchases_meta: 1 }),
  meta('2026-10-20', AD_PHOTO, { ...photo, spend: 40, impressions: 4000, link_clicks: 20, purchases_meta: 1, funnel_stage: null }),
  meta('2026-10-21', AD_PHOTO, { ...photo, spend: 10, impressions: 800, link_clicks: 5, provisional: true, funnel_stage: null }),
  meta('2026-10-20', '120250000000000001', { spend: 500, campaign_id: OTHER, campaign_name: 'OTHER', adset_id: '120250000000000002' }), // không thuộc project
];
const subs = [
  { conversion_id: 'c-1', project_id: P, contact_id: '257000000001', converted_on: '2026-10-20', ad_id: AD_VIDEO, campaign_id: CAMP, placement: 'Facebook_Mobile_Reels', source_hint: 'tracked' },
  { conversion_id: 'c-2', project_id: P, contact_id: '257000000002', converted_on: '2026-10-20', ad_id: AD_PHOTO, campaign_id: CAMP, placement: 'Facebook_Mobile_Feed', source_hint: 'tracked' },
  { conversion_id: 'c-3', project_id: P, contact_id: '257000000001', converted_on: '2026-10-21', ad_id: AD_PHOTO, campaign_id: CAMP, placement: 'Facebook_Mobile_Feed', source_hint: 'tracked' },
  { conversion_id: 'c-4', project_id: P, contact_id: '257000000003', converted_on: '2026-10-19', ad_id: null, campaign_id: null, placement: null, source_hint: 'direct' },
  { conversion_id: 'c-5', project_id: P, contact_id: '257000000003', converted_on: '2026-10-22', ad_id: AD_PHOTO, campaign_id: CAMP, placement: 'Facebook_Mobile_Feed', source_hint: 'tracked' },
  { conversion_id: 'c-6', project_id: P, contact_id: '257000000004', converted_on: '2026-10-05', ad_id: null, campaign_id: null, placement: null, source_hint: 'test' },
  { conversion_id: 'c-7', project_id: P, contact_id: '257000000005', converted_on: '2026-10-21', ad_id: '120259999999999999', campaign_id: CAMP, placement: 'Instagram_Reels', source_hint: 'tracked' },
];
const deals = [
  { deal_id: '1', contact_ids: ['257000000001'], deal_type: 'seat', is_won: true, amount: 10 },
  { deal_id: '2', contact_ids: ['257000000002'], deal_type: 'seat', is_won: false, amount: 10 },
  { deal_id: '3', contact_ids: ['257000000003'], deal_type: 'program', is_won: true, amount: 995 },
  { deal_id: '4', contact_ids: ['257000000005'], deal_type: 'seat', is_won: true, amount: 10 },
];

describe('pickLeads / leadOutcomes', () => {
  it('first-touch ưu tiên tracked; bỏ test', () => {
    expect(pickLeads(subs).map((l) => [l.contact_id, l.conversion_id])).toEqual([
      ['257000000001', 'c-1'], ['257000000002', 'c-2'], ['257000000005', 'c-7'], ['257000000003', 'c-5'],
    ]);
  });
  it('đếm seat/program đã thắng theo contact', () => {
    const o = leadOutcomes(pickLeads(subs), deals);
    expect(o.map((x) => [x.lead.contact_id, x.seats, x.programs, x.programRevenue])).toEqual([
      ['257000000001', 1, 0, 0], ['257000000002', 0, 0, 0], ['257000000005', 1, 0, 0], ['257000000003', 0, 1, 995],
    ]);
  });
});

describe('buildProjectReport — có CRM', () => {
  const r = buildProjectReport({ metaRows, campaignIds: [CAMP], submissions: subs, deals });
  it('tổng Meta chỉ gồm campaign của project', () => {
    expect(r.total.meta).toMatchObject({ spend: 150, impressions: 9800, clicks: 115, purchases: 4 });
    expect(r.total.meta.ctr).toBeCloseTo(0.0117, 4);
  });
  it('CRM: lead / seat / revenue / CPA thực / Cash ROAS', () => {
    expect(r.total.crm).toMatchObject({ leads: 4, tracked: 4, seats: 2, programs: 1, seatRevenue: 20, programRevenue: 995, revenue: 1015, cpaSeat: 75, cashRoas: 6.77 });
  });
  it('Truth gap: Meta báo 4 purchase, CRM 2 seat → over-report 100%', () => {
    expect(r.truthGap).toEqual({ metaPurchases: 4, crmSeats: 2, overreportPct: 100 });
    expect(r.primary).toMatchObject({ kind: 'seat', value: 2, cost: 75 });
  });
  it('funnel', () => { expect(r.funnel).toMatchObject({ leads: 4, seats: 2, programs: 1, leadToSeatPct: 50, seatToProgramPct: 50 }); });
  it('Unattributed = lead có ad không nằm trong project (c-7: ad lạ; c-5: gắn ad photo nên KHÔNG unattributed)', () => {
    // c-7 trỏ tới ad không có spend trong project → unattributed (1 lead, 1 seat). c-5 (ad photo) và c-1, c-2 gắn được.
    expect(r.unattributed.crm).toMatchObject({ leads: 1, seats: 1, programs: 0 });
    expect(r.unattributed.leadIds).toBe(1);
  });
  it('tổng cây + Unattributed = tổng CRM (không mất lead)', () => {
    const sum = r.tree.reduce((s, c) => s + c.crm.leads, 0) + r.unattributed.crm.leads;
    expect(sum).toBe(r.total.crm.leads);
    expect(r.tree.reduce((s, c) => s + c.meta.spend, 0)).toBe(r.total.meta.spend);
  });
  it('cây Campaign → Adset → Ad, sắp theo spend', () => {
    expect(r.tree.length).toBe(1);
    const camp = r.tree[0];
    expect(camp).toMatchObject({ level: 'campaign', id: CAMP });
    expect(camp.children.map((s) => [s.id, s.meta.spend])).toEqual([[ADSET1, 100], [ADSET2, 50]]);
    const ad = camp.children[0].children[0];
    expect(ad).toMatchObject({ level: 'ad', id: AD_VIDEO, concept: 'Video ban doc', format: 'video', stage: 'MOFU' });
    expect(ad.crm).toMatchObject({ leads: 1, seats: 1, cpaSeat: 100 });
    expect(ad.deltaPurchases).toBe(2); // Meta 3 purchase vs CRM 1 seat
  });
  it('placement theo vị trí hiển thị', () => {
    expect(r.placements.find((p) => p.placement === 'Facebook_Mobile_Feed')).toMatchObject({ leads: 2, seats: 0, programs: 1 });
    expect(r.placements.find((p) => p.placement === 'Facebook_Mobile_Reels')).toMatchObject({ leads: 1, seats: 1, sharePct: 25 });
  });
  it('trackedPct', () => { expect(r.trackedPct).toBe(100); });
  it('daily có spend theo ngày và đánh dấu tạm tính', () => {
    expect(r.daily.map((d) => [d.date, d.spend, d.provisional])).toEqual([
      ['2026-10-20', 100, false], ['2026-10-21', 50, true], ['2026-10-22', 0, false],
    ]);
    expect(r.provisionalDates).toEqual(['2026-10-21']);
  });
  it('concept: video ban doc có seat → CPA 100; photo 0 seat', () => {
    const v = r.concepts.find((c) => c.conceptKey === 'video ban doc')!;
    expect(v).toMatchObject({ conversions: 1, cpaReal: 100, light: 'yellow' });
    expect(v.stages).toEqual(['MOFU']);
    expect(r.concepts.find((c) => c.conceptKey === 'photo poster kv')).toMatchObject({ conversions: 0, light: 'grey' });
  });
});

describe('buildProjectReport — lọc ngày', () => {
  it('Meta lọc theo date, CRM lọc theo ngày đăng ký', () => {
    const r = buildProjectReport({ metaRows, campaignIds: [CAMP], submissions: subs, deals, range: { from: '2026-10-21', to: '2026-10-21' } });
    expect(r.total.meta.spend).toBe(50);
    expect(r.total.crm).toMatchObject({ leads: 1, seats: 1 }); // chỉ c-7 (c-3 là lượt thứ 2 của contact 1, không phải first-touch)
  });
});

describe('buildProjectReport — chưa có CRM (Step 1)', () => {
  const r = buildProjectReport({ metaRows, campaignIds: [CAMP] });
  it('chuyển sang chế độ Meta', () => {
    expect(r.hasCrm).toBe(false);
    expect(r.truthGap).toBeNull();
    expect(r.primary).toMatchObject({ kind: 'meta', value: 4, cost: 37.5 });
    expect(r.total.crm).toMatchObject({ leads: 0, seats: 0, cashRoas: null, cpaSeat: null });
  });
  it('toàn tài khoản (campaignIds = null) gồm cả campaign khác', () => {
    expect(buildProjectReport({ metaRows, campaignIds: null }).total.meta.spend).toBe(650);
  });
});

describe('defaultRange', () => {
  it('7 ngày kết thúc ở ngày mới nhất', () => { expect(defaultRange('2026-10-24', 7)).toEqual({ from: '2026-10-18', to: '2026-10-24' }); });
  it('không có dữ liệu → null', () => { expect(defaultRange(null)).toBeNull(); });
});

describe('stageOverrides (gắn stage thủ công)', () => {
  const rows = [
    meta('2026-10-20', AD_VIDEO, { spend: 10, funnel_stage: null }),
    meta('2026-10-20', AD_PHOTO, { ...photo, spend: 10, funnel_stage: 'TOFU' }),
  ];
  it('không có override → giữ stage tự nhận (ad không có từ khóa thì rỗng)', () => {
    const r = buildProjectReport({ metaRows: rows, campaignIds: [CAMP] });
    expect(r.concepts.find((c) => c.conceptKey === 'video ban doc')!.stages).toEqual([]);
    expect(r.concepts.find((c) => c.conceptKey === 'photo poster kv')!.stages).toEqual(['TOFU']);
  });
  it('override theo concept gắn nhãn cho concept không có từ khóa', () => {
    const r = buildProjectReport({ metaRows: rows, campaignIds: [CAMP], stageOverrides: { byConcept: { 'video ban doc': 'MOFU' } } });
    expect(r.concepts.find((c) => c.conceptKey === 'video ban doc')!.stages).toEqual(['MOFU']);
    const ad = r.tree[0].children.flatMap((s) => s.children).find((a) => a.id === AD_VIDEO)!;
    expect(ad.stage).toBe('MOFU');
  });
  it('override theo ad thắng override theo concept; override ghi đè cả stage tự nhận', () => {
    const r = buildProjectReport({ metaRows: rows, campaignIds: [CAMP],
      stageOverrides: { byConcept: { 'photo poster kv': 'BOFU' }, byAd: { [AD_PHOTO]: 'MOFU' } } });
    expect(r.concepts.find((c) => c.conceptKey === 'photo poster kv')!.stages).toEqual(['MOFU']);
    const r2 = buildProjectReport({ metaRows: rows, campaignIds: [CAMP], stageOverrides: { byConcept: { 'photo poster kv': 'BOFU' } } });
    expect(r2.concepts.find((c) => c.conceptKey === 'photo poster kv')!.stages).toEqual(['BOFU']);
  });
});
