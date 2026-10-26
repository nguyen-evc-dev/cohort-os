import { describe, it, expect } from 'vitest';
import { buildProjectReport, customConversionAction, GOAL_TEMPLATES, goalActionTypes, parseGoal, readGoal, type ProjectGoal } from '../src/index';

const CAMP = '120252652862560233';
const AD1 = '120252750913970233';
const AD2 = '120252743565200233';
const CHECKOUT = customConversionAction('2050096562303283');
const PURCHASED = customConversionAction('1827050228714469');

const webinar: ProjectGoal = parseGoal({
  ...GOAL_TEMPLATES.webinar.goal,
  steps: [
    { key: 'checkout', label: 'Check Out', source: 'meta', action_type: CHECKOUT },
    { key: 'purchased', label: 'Purchased', source: 'meta', action_type: PURCHASED },
    { key: 'seat', label: 'Seat', source: 'crm', crm: 'seats' },
    { key: 'program', label: 'Khóa học', source: 'crm', crm: 'programs', value: 1750 },
  ],
  target_cost: 40,
});

const row = (date: string, ad: string, spend: number) => ({
  date, ad_id: ad, campaign_id: CAMP, campaign_name: 'COACH-WBN-RE-PC-SAC', adset_id: '120252703228760233', adset_name: 'MOF', ad_name: ad === AD1 ? 'Video ban doc_WARM' : 'Photo KV_WARM',
  creative_concept: ad === AD1 ? 'Video ban doc' : 'Photo KV', concept_key: ad === AD1 ? 'video ban doc' : 'photo kv', creative_format: ad === AD1 ? 'video' : 'photo',
  spend, impressions: 1000, link_clicks: 20, leads_meta: 9, purchases_meta: 9, landing_page_views: 15, video_3s: 300, thruplay: 60, video_p25: 200, video_p50: 150, video_p75: 90, video_p100: 30, provisional: false,
});
const metaRows = [row('2026-10-20', AD1, 60), row('2026-10-20', AD2, 40), row('2026-10-21', AD1, 50)];
const actions = [
  { date: '2026-10-20', ad_id: AD1, action_type: CHECKOUT, count: 4 }, { date: '2026-10-20', ad_id: AD1, action_type: PURCHASED, count: 2 },
  { date: '2026-10-20', ad_id: AD2, action_type: CHECKOUT, count: 1 },
  { date: '2026-10-21', ad_id: AD1, action_type: CHECKOUT, count: 2 }, { date: '2026-10-21', ad_id: AD1, action_type: PURCHASED, count: 1 },
  { date: '2026-10-21', ad_id: '999999999999', action_type: CHECKOUT, count: 50 }, // ad không thuộc project → bỏ
];
const subs = [
  { conversion_id: 'a', project_id: 'p', contact_id: '1001001', converted_on: '2026-10-20', ad_id: AD1, source_hint: 'tracked' },
  { conversion_id: 'b', project_id: 'p', contact_id: '1001002', converted_on: '2026-10-20', ad_id: AD1, source_hint: 'tracked' },
  { conversion_id: 'c', project_id: 'p', contact_id: '1001003', converted_on: '2026-10-21', ad_id: AD2, source_hint: 'tracked' },
];
const deals = [
  { deal_id: '1', contact_ids: ['1001001'], deal_type: 'seat', is_won: true, amount: 10, deal_stage: 'Following' },
  { deal_id: '2', contact_ids: ['1001002'], deal_type: 'seat', is_won: true, amount: 10, deal_stage: 'Following' },
  { deal_id: '3', contact_ids: ['1001001'], deal_type: 'program', is_won: true, amount: 1500, deal_stage: 'Purchased' },
];

describe('parseGoal', () => {
  it('chuẩn hóa mục tiêu hợp lệ', () => {
    expect(webinar).toMatchObject({ primary: 'purchased', final: 'program', compare: { meta: 'purchased', crm: 'seat' }, target_cost: 40 });
  });
  it.each([
    [{ ...webinar, primary: 'khong_co' }, /bước chính/],
    [{ ...webinar, steps: [{ key: 'x', label: 'X', source: 'meta', action_type: '' }], primary: 'x', final: 'x' }, /chưa chọn custom conversion/],
    [{ ...webinar, steps: [...webinar.steps, webinar.steps[0]] }, /bị trùng/],
    [{ ...webinar, compare: { meta: 'seat', crm: 'purchased' } }, /Truth Gap/],
    [{ ...webinar, steps: [{ key: 's', label: 'S', source: 'crm', crm: 'stages', stages: [] }], primary: 's', final: 's', compare: null }, /Deal Stage/],
    [{ ...webinar, focus: 'liên hệ a@b.com' }, /email/],
  ])('từ chối mục tiêu sai (%#)', (g, msg) => { expect(() => parseGoal(g)).toThrow(msg); });
  it('readGoal: rỗng / sai → null (dùng mặc định)', () => {
    expect(readGoal({})).toBeNull();
    expect(readGoal({ steps: [{ key: 'bad key' }] })).toBeNull();
    expect(readGoal(webinar)?.primary).toBe('purchased');
  });
  it('goalActionTypes lấy các custom conversion đang dùng', () => {
    expect(goalActionTypes([webinar, null]).sort()).toEqual([PURCHASED, CHECKOUT].sort());
  });
});

describe('báo cáo theo mục tiêu Webinar (custom conversion, không theo Lead)', () => {
  const r = buildProjectReport({ metaRows, campaignIds: [CAMP], actions, goal: webinar, submissions: subs, deals });
  it('bước chính = Purchased: 3 lượt, CPA $50; vượt target $40', () => {
    expect(r.primary).toMatchObject({ key: 'purchased', kind: 'meta', label: 'Purchased', value: 3, cost: 50, target: 40, fallback: false });
  });
  it('chuỗi bước: Check Out 7 → Purchased 3 → Seat 2 → Khóa học 1 ($1,750 giá trị cố định)', () => {
    expect(r.steps.map((s) => [s.key, s.count, s.cost, s.value, s.rateFromPrev])).toEqual([
      ['checkout', 7, 21.43, 0, null], ['purchased', 3, 50, 0, 42.9], ['seat', 2, 75, 20, 66.7], ['program', 1, 150, 1750, 50],
    ]);
  });
  it('bước cuối mang giá trị thật; ROAS chỉ là phụ', () => {
    expect(r.final).toMatchObject({ key: 'program', count: 1, value: 1750, cost: 150, roas: 11.67 });
  });
  it('Truth Gap theo cặp Purchased (Meta) ↔ Seat (CRM)', () => {
    expect(r.truthGap).toMatchObject({ metaLabel: 'Purchased', crmLabel: 'Seat', metaPurchases: 3, crmSeats: 2, overreportPct: 50 });
  });
  it('Lead Meta (9 mỗi dòng) KHÔNG được dùng làm thước đo', () => {
    expect(r.steps.some((s) => s.key === 'lead')).toBe(false);
    expect(r.primary.value).not.toBe(r.total.meta.leads);
  });
  it('ad × concept đo theo bước chính', () => {
    const v = r.concepts.find((c) => c.conceptKey === 'video ban doc')!;
    expect(v).toMatchObject({ conversions: 3, cpaReal: 36.67 });
    const p = r.concepts.find((c) => c.conceptKey === 'photo kv')!;
    expect(p).toMatchObject({ conversions: 0, light: 'yellow' }); // tiêu $40 = target $40, 0 chuyển đổi → theo dõi
    const ad = r.tree[0].children[0].children.find((a) => a.id === AD1)!;
    expect(ad.steps.checkout.count).toBe(6);
  });
  it('theo ngày có số từng bước (biểu đồ chọn chỉ số)', () => {
    expect(r.daily.map((d) => [d.date, d.steps.checkout ?? 0, d.steps.purchased ?? 0, d.steps.seat ?? 0])).toEqual([
      ['2026-10-20', 5, 2, 2], ['2026-10-21', 2, 1, 0],
    ]);
    expect(r.total.meta).toMatchObject({ video3s: 900, thruplay: 180, hookRate: 0.3, holdRate: 0.2, videoP50: 450, p25Rate: 0.6667, p50Rate: 0.5, p75Rate: 0.3, p100Rate: 0.1 });
  });
  it('chưa có CRM: bước chính CRM → tạm dùng bước Meta cuối, bước cuối "Chờ CRM"', () => {
    const g = parseGoal({ ...webinar, primary: 'seat' });
    const m = buildProjectReport({ metaRows, campaignIds: [CAMP], actions, goal: g });
    expect(m.primary).toMatchObject({ key: 'purchased', fallback: true });
    expect(m.final.available).toBe(false);
    expect(m.steps.find((s) => s.key === 'seat')).toMatchObject({ available: false, cost: null });
  });
});

describe('mục tiêu Event: bước CRM theo Deal Stage, cộng dồn', () => {
  const event = parseGoal({
    ...GOAL_TEMPLATES.event.goal,
    steps: [
      { key: 'register', label: 'Đăng ký event', source: 'meta', action_type: CHECKOUT },
      { key: 'lead', label: 'Lead (CRM)', source: 'crm', crm: 'registrations' },
      { key: 'showing', label: 'Buyer showing', source: 'crm', crm: 'stages', stages: ['Buyer Showing'] },
      { key: 'escrow', label: 'Escrow', source: 'crm', crm: 'stages', stages: ['Escrow', 'Closed Won'] },
    ],
  });
  const evDeals = [
    { deal_id: '7', contact_ids: ['1001001'], deal_type: 'unknown', is_won: false, amount: 0, deal_stage: 'Buyer Showing' },
    { deal_id: '8', contact_ids: ['1001002'], deal_type: 'unknown', is_won: false, amount: 12000, deal_stage: 'escrow' },
    { deal_id: '9', contact_ids: ['1001003'], deal_type: 'test', is_won: false, amount: 1, deal_stage: 'Escrow' },
  ];
  const r = buildProjectReport({ metaRows, campaignIds: [CAMP], actions, goal: event, submissions: subs, deals: evDeals });
  it('deal ở Escrow cũng tính là đã qua Buyer showing; deal test bị bỏ; stage không phân biệt hoa thường', () => {
    expect(r.steps.map((s) => [s.key, s.count])).toEqual([['register', 7], ['lead', 3], ['showing', 2], ['escrow', 1]]);
    expect(r.final).toMatchObject({ key: 'escrow', count: 1, value: 12000 });
  });
});
