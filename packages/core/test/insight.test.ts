import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildInsightPayload, buildProjectReport, findUngroundedNumbers, insightSystemPrompt, insightUserMessage, SKILLS } from '../src/index';

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
const signals = [{ type: 'burn', color: 'red', level: 'ad', entity_id: AD, action: 'pause_ad', compared_to: 'campaign', numbers: { spend: 36, baseline: 10, entity_name: 'Video ban doc_COLD', campaign_name: 'COACH-WBN-RE-PC-SAC' } }];
const payload = buildInsightPayload({ projectName: 'Webinar RE11', report, signals, signalsAsOf: '2026-10-24' });

describe('buildInsightPayload', () => {
  it('có số tổng, Truth Gap, phễu; không có contact / deal id', () => {
    expect(payload).toMatchObject({ mode: 'crm', total: { spend: 200, seats: 1, revenue: 997.77, cash_roas: 4.99 }, truth_gap: { meta_purchases: 4, crm_seats: 1, overreport_pct: 300 } });
    const json = JSON.stringify(payload);
    expect(json).not.toMatch(/257000000001|contact_id|deal_id|@/);
  });
  it('chế độ Meta khi chưa có CRM: không có trường CRM', () => {
    const p = buildInsightPayload({ projectName: 'X', report: buildProjectReport({ metaRows: [row('2026-10-20', 50)], campaignIds: [CAMP] }) });
    expect(p.mode).toBe('meta');
    expect(p.total).not.toHaveProperty('seats');
    expect(p.truth_gap).toBeNull();
  });
  it('insightUserMessage chặn PII lọt vào payload', () => {
    const bad = { ...payload, project: 'Webinar a@b.com' };
    expect(() => insightUserMessage(bad)).toThrow(/dữ liệu cá nhân/);
  });
});

describe('findUngroundedNumbers (AC T2.8: mọi con số trong câu trả lời đều có trong payload)', () => {
  it('câu trả lời chỉ dùng số trong payload → sạch', () => {
    const text = 'Spend $200 cho 1 seat, Cash ROAS 4.99x. Meta báo 4 purchase, CRM chỉ 1 seat, lệch 300%. Ad Video ban doc_COLD đã tiêu $36, mốc $10. Chiều 20/10 tốt nhất.';
    expect(findUngroundedNumbers(text, payload)).toEqual([]);
  });
  it('bắt số bịa / số tự tính', () => {
    const text = 'CPA thực khoảng $198 và ROAS 5.1x, tăng 47% so với tuần trước.';
    expect(findUngroundedNumbers(text, payload).sort()).toEqual(['$198', '47%', '5.1'].sort());
  });
  it('bỏ qua ngày, số thứ tự nhỏ và đánh số hành động', () => {
    expect(findUngroundedNumbers('Việc nên làm trước: 1) tắt ad 2) giữ 3) chờ. Từ 20/10 đến 2026-10-24, top 3 concept.', payload)).toEqual([]);
  });
  it('số nhỏ có $ hoặc % vẫn phải có căn cứ', () => {
    expect(findUngroundedNumbers('Giảm 8% và $7', payload).sort()).toEqual(['$7', '8%']);
  });
  it('dấu phẩy nghìn: $1,234 khớp 1234', () => {
    expect(findUngroundedNumbers('Doanh thu $998', { revenue: 998 })).toEqual([]);
    expect(findUngroundedNumbers('Doanh thu $1,234', { revenue: 1234 })).toEqual([]);
  });
});

describe('skill', () => {
  it('skills.generated.ts khớp file skills/ads-deep-analysis.md (chạy pnpm build:skills nếu lỗi)', () => {
    const md = readFileSync(new URL('../../../skills/ads-deep-analysis.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(SKILLS['ads-deep-analysis']).toBe(md);
  });
  it('system prompt có luật số liệu và luật chỉ-gợi-ý', () => {
    const s = insightSystemPrompt();
    expect(s).toMatch(/LUẬT SỐ LIỆU/);
    expect(s).toMatch(/không được thay đổi gì trên tài khoản quảng cáo/);
  });
});
