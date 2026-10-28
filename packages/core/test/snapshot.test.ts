import { describe, it, expect } from 'vitest';
import { buildBotSnapshots, customConversionAction, GOAL_TEMPLATES, hashString, parseGoal } from '../src/index';

const CAMP = '120252652862560233';
const OTHER = '120252000000000001';
const AD1 = '120252750913970233';
const CHECKOUT = customConversionAction('2050096562303283');
const PURCHASED = customConversionAction('1827050228714469');
const PID = '11111111-1111-1111-1111-111111111111';

const goal = parseGoal({
  ...GOAL_TEMPLATES.webinar.goal,
  steps: [
    { key: 'checkout', label: 'Check Out', source: 'meta', action_type: CHECKOUT },
    { key: 'purchased', label: 'Purchased', source: 'meta', action_type: PURCHASED },
    { key: 'seat', label: 'Seat', source: 'crm', crm: 'seats' },
    { key: 'program', label: 'Khóa học', source: 'crm', crm: 'programs', value: 1750 },
  ],
  target_cost: 40,
});

const row = (date: string, campaign: string, ad: string, spend: number) => ({
  date, ad_id: ad, campaign_id: campaign, campaign_name: campaign === CAMP ? 'COACH-WBN-RE-PC-SAC' : 'Other camp', adset_id: '120252703228760233', adset_name: 'MOF',
  ad_name: 'Video ban doc_WARM', creative_concept: 'Video ban doc', concept_key: 'video ban doc', creative_format: 'video',
  spend, impressions: 1000, link_clicks: 20, leads_meta: 9, purchases_meta: 9, landing_page_views: 15, video_3s: 300, thruplay: 60, provisional: false,
});
const base = () => ({
  projects: [{ id: PID, slug: 'webinar-re11', name: 'Webinar RE11', status: 'active', goal }],
  projectCampaigns: [{ project_id: PID, campaign_id: CAMP }],
  metaRows: [row('2026-09-01', CAMP, AD1, 50), row('2026-10-20', CAMP, AD1, 60), row('2026-10-21', CAMP, AD1, 50), row('2026-10-21', OTHER, '120252999999999999', 30)],
  entities: [],
  actions: [
    { date: '2026-10-20', ad_id: AD1, action_type: CHECKOUT, count: 4 }, { date: '2026-10-20', ad_id: AD1, action_type: PURCHASED, count: 2 },
    { date: '2026-10-21', ad_id: AD1, action_type: PURCHASED, count: 1 }, { date: '2026-09-01', ad_id: AD1, action_type: PURCHASED, count: 5 },
  ],
  submissions: [{ conversion_id: 'a', project_id: PID, contact_id: '1001001', converted_on: '2026-10-20', ad_id: AD1, source_hint: 'tracked' }],
  deals: [{ deal_id: '1', contact_ids: ['1001001'], deal_type: 'seat', is_won: true, amount: 10, deal_stage: 'Following' }],
  signals: [
    { type: 'burn', color: 'red', level: 'ad', entity_id: AD1, action: 'pause_ad', numbers: { campaign_id: CAMP, spend: 60, entity_name: 'Video ban doc' } },
    { type: 'burn', color: 'red', level: 'ad', entity_id: '120252999999999999', action: 'pause_ad', numbers: { campaign_id: OTHER, spend: 30 } },
  ],
  signalsAsOf: '2026-10-21',
});

describe('buildBotSnapshots', () => {
  const snaps = buildBotSnapshots(base());
  const get = (slug: string, range: string) => snaps.find((s) => s.slug === slug && s.range_key === range)!;

  it('mỗi Project + "all" × 3 khoảng ngày; as_of = ngày Meta mới nhất', () => {
    expect(snaps.map((s) => `${s.slug}/${s.range_key}`).sort()).toEqual(['all/30d', 'all/7d', 'all/all', 'webinar-re11/30d', 'webinar-re11/7d', 'webinar-re11/all']);
    expect(new Set(snaps.map((s) => s.as_of))).toEqual(new Set(['2026-10-21']));
    expect(get('webinar-re11', '7d').project_id).toBe(PID);
    expect(get('all', '7d').project_id).toBeNull();
  });
  it('đo theo mục tiêu: 7 ngày = Purchased 3, CPA $36.67; "all" thêm 5 purchased tháng 9', () => {
    const p7 = get('webinar-re11', '7d').payload;
    expect(p7.primary).toMatchObject({ label: 'Purchased', count: 3, cost: 36.67, target: 40 });
    expect(p7.steps.map((s) => [s.key, s.count])).toEqual([['checkout', 4], ['purchased', 3], ['seat', 1], ['program', 0]]);
    expect(get('webinar-re11', 'all').payload.primary).toMatchObject({ count: 8 });
  });
  it('chỉ campaign của Project; "all" gồm cả campaign khác và đo theo mặc định', () => {
    expect(get('webinar-re11', '7d').payload.total).toMatchObject({ spend: 110 });
    expect(get('all', '7d').payload.total).toMatchObject({ spend: 140 });
    expect(get('webinar-re11', '7d').payload.campaigns).toEqual([expect.objectContaining({ campaign_id: CAMP, campaign: 'COACH-WBN-RE-PC-SAC' })]);
  });
  it('tín hiệu chỉ của campaign thuộc Project', () => {
    expect(get('webinar-re11', '7d').payload.signals).toHaveLength(1);
    expect(get('all', '7d').payload.signals).toHaveLength(2);
  });
  it('Truth Gap & CRM có trong payload nhưng không có contact_id', () => {
    const p = get('webinar-re11', '7d').payload;
    expect(p.truth_gap).toMatchObject({ meta_purchases: 3, crm_seats: 1 });
    expect(JSON.stringify(p)).not.toContain('1001001');
  });
  it('data_version đổi khi số đổi, giữ nguyên khi chạy lại', () => {
    expect(buildBotSnapshots(base()).map((s) => s.data_version)).toEqual(snaps.map((s) => s.data_version));
    const more = base(); more.actions.push({ date: '2026-10-21', ad_id: AD1, action_type: PURCHASED, count: 9 });
    expect(get('webinar-re11', '7d').data_version).not.toBe(buildBotSnapshots(more).find((s) => s.slug === 'webinar-re11' && s.range_key === '7d')!.data_version);
  });
  it('bỏ Project đã lưu trữ; chưa có số Meta → không có bản chụp', () => {
    const arch = base(); arch.projects[0].status = 'archived';
    expect(buildBotSnapshots(arch).map((s) => s.slug)).not.toContain('webinar-re11');
    expect(buildBotSnapshots({ ...base(), metaRows: [] })).toEqual([]);
  });
  it('chặn payload nghi có PII (tên campaign chứa email)', () => {
    const bad = base(); bad.metaRows[2].campaign_name = 'khach a@b.com';
    expect(() => buildBotSnapshots(bad)).toThrow(/PII|email/i);
  });
});

describe('hashString', () => {
  it('ổn định và phân biệt chuỗi', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
    expect(hashString('abc')).toHaveLength(14);
  });
});
