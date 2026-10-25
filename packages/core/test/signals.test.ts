// @ts-nocheck — chuyển nguyên văn từ bộ test GAS (JavaScript) để chứng minh logic không đổi khi port sang TypeScript.
import { describe, it, expect } from 'vitest';
import * as g from '../src/index';
import { makeCfg } from './helpers';

const AS_OF = '2026-10-18';               // "hôm qua" theo PT
const NOW = '2026-10-19T08:00:00.000Z';   // 15:00 giờ Hà Nội
const WINDOW = ['2026-10-16', '2026-10-17', '2026-10-18'];
const BASELINE = [...g.dateRange('2026-10-02', '2026-10-15')];  // 14 ngày trước cửa sổ
const OLD_DATES = [...g.dateRange('2026-09-20', '2026-10-10')];  // kết thúc trước 7 ngày gần nhất (12–18/10)

// ---------- Dựng dữ liệu giả ----------

function rows(campaignId, adId, dates, day, extra = {}) {
  return dates.map((date) => ({
    date, campaign_id: campaignId, campaign_name: extra.campaign_name || `Camp ${campaignId}`,
    objective: extra.objective || 'OUTCOME_LEADS',
    adset_id: extra.adset_id || `${campaignId}-s`, ad_id: adId, ad_name: extra.ad_name || `Photo ${adId}`,
    creative_concept: extra.concept || `Photo ${adId}`, creative_format: 'photo', funnel_stage: extra.stage || '',
    spend: day.spend ?? 0, leads_meta: day.leads ?? 0, purchases_meta: day.purchases ?? 0,
    link_clicks: day.clicks ?? 0, impressions: day.impressions ?? 0,
  }));
}

function entities({ campaignId, ads = [], learning = '', budgetChangedAt = '', lastSigEdit = '', cbo = false,
  adStatus = {}, freq = {} }) {
  // Mặc định: LEARNING kèm thay đổi lớn cách đây 24h (vẫn trong cửa sổ 72h nên bị chặn)
  const sig = lastSigEdit || (learning ? '2026-10-18T08:00:00.000Z' : '');
  return [
    { level: 'campaign', id: campaignId, effective_status: 'ACTIVE', objective: 'OUTCOME_LEADS',
      daily_budget: cbo ? 100 : '', budget_changed_at: cbo ? budgetChangedAt : '' },
    { level: 'adset', id: `${campaignId}-s`, campaign_id: campaignId, effective_status: 'ACTIVE',
      daily_budget: cbo ? '' : 100, learning_status: learning, budget_changed_at: cbo ? '' : budgetChangedAt,
      last_sig_edit_at: sig },
    ...ads.map((a) => ({ level: 'ad', id: a, campaign_id: campaignId, adset_id: `${campaignId}-s`,
      effective_status: adStatus[a] || 'ACTIVE', frequency_7d: freq[a] ?? 1.5 })),
  ];
}

function run({ metaRows, ents, crmRows = [], crmFresh = true, cfg = makeCfg() }) {
  const ctxs = g.buildCampaignContexts({
    metaRows, entities: ents, crmRows, asOf: AS_OF, config: cfg, nowIso: NOW, crmFresh,
  });
  return ctxs.map((ctx) => ({ ctx, signals: g.computeSignals(ctx, cfg, NOW) }));
}

// Campaign "ổn định": 14 ngày chuẩn CPL = $20 (100 spend / 5 lead mỗi ngày)
const baselineRows = (cid, adId) => rows(cid, adId, BASELINE, { spend: 100, leads: 5, clicks: 100, impressions: 5000 });
const types = (signals) => signals.map((s) => s.type);

// ---------- Mốc chuẩn ----------

describe('mốc chuẩn (baseline)', () => {
  it('lấy trung vị CPL 14 ngày của campaign, không lẫn cửa sổ đánh giá', () => {
    const [{ ctx }] = run({
      metaRows: [...baselineRows('c1', 'a1'), ...rows('c1', 'a1', WINDOW, { spend: 300, leads: 1 })],
      ents: entities({ campaignId: 'c1', ads: ['a1'] }),
    });
    expect(ctx.baseline).toEqual({ value: 20, source: 'campaign' });
  });

  it('campaign mới chưa đủ lead → dùng mốc toàn tài khoản cùng objective', () => {
    const out = run({
      metaRows: [
        ...rows('old', 'x', OLD_DATES, { spend: 90, leads: 3 }),              // CPL 30, đã tắt trước 7 ngày gần nhất
        ...rows('new', 'y', WINDOW, { spend: 40, leads: 2 }),
      ],
      ents: [...entities({ campaignId: 'old', ads: ['x'] }), ...entities({ campaignId: 'new', ads: ['y'] })],
    });
    expect(out.map((o) => o.ctx.campaign.id)).toEqual(['new']);  // campaign không spend 7 ngày bị bỏ qua
    const { ctx } = out[0];
    expect(ctx.baseline).toEqual({ value: 30, source: 'account' });
  });

  it('target trong config ghi đè mốc chuẩn', () => {
    const cfg = makeCfg({}, { c1: { target_cpl: 15 } });
    const [{ ctx }] = run({
      metaRows: [...baselineRows('c1', 'a1'), ...rows('c1', 'a1', WINDOW, { spend: 50, leads: 3 })],
      ents: entities({ campaignId: 'c1', ads: ['a1'] }), cfg,
    });
    expect(ctx.baseline).toEqual({ value: 15, source: 'target' });
  });

  it('không đủ dữ liệu ở đâu cả → tín hiệu "thiếu dữ liệu"', () => {
    const [{ ctx, signals }] = run({
      metaRows: rows('c1', 'a1', WINDOW, { spend: 30, leads: 1 }),
      ents: entities({ campaignId: 'c1', ads: ['a1'] }),
    });
    expect(ctx.baseline.source).toBe('none');
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ type: 'insufficient', numbers: { reason: 'no_baseline' } });
  });
});

// ---------- Tín hiệu ----------

describe('🛑 đốt tiền', () => {
  it('ad tiêu ≥ 2× CPL chuẩn trong 3 ngày mà 0 lead → tắt', () => {
    const [{ signals }] = run({
      metaRows: [
        ...baselineRows('c1', 'good'),
        ...rows('c1', 'good', WINDOW, { spend: 60, leads: 4 }),
        ...rows('c1', 'bad', WINDOW, { spend: 15, leads: 0 }, { ad_name: 'Photo MOFU Agenda', stage: 'MOFU' }),
      ],
      ents: entities({ campaignId: 'c1', ads: ['good', 'bad'] }),
    });
    expect(signals[0]).toMatchObject({
      type: 'burn', level: 'ad', entityId: 'bad', stage: 'MOFU', action: 'pause_ad',
      numbers: { spend: 45, conversions: 0, baseline: 20, days: 3 }, comparedTo: 'campaign',
    });
  });

  it('ad đã tạm dừng (kể cả do adset dừng) không bị báo', () => {
    const [{ signals }] = run({
      metaRows: [...baselineRows('c1', 'good'), ...rows('c1', 'bad', WINDOW, { spend: 20, leads: 0 })],
      ents: entities({ campaignId: 'c1', ads: ['good', 'bad'], adStatus: { bad: 'ADSET_PAUSED' } }),
    });
    expect(types(signals)).not.toContain('burn');
  });
});

describe('⚠️ creative mỏi', () => {
  it('frequency > 3 và CTR giảm ≥ 25% so với 7 ngày trước → thay creative', () => {
    const prev7 = [...g.dateRange('2026-10-05', '2026-10-11')];
    const last7 = [...g.dateRange('2026-10-12', '2026-10-18')];
    const [{ signals }] = run({
      metaRows: [
        ...rows('c1', 'a1', [...g.dateRange('2026-10-02', '2026-10-04')], { spend: 100, leads: 5 }),
        ...rows('c1', 'a1', prev7, { spend: 100, leads: 5, clicks: 100, impressions: 5000 }),  // CTR 2%
        ...rows('c1', 'a1', last7, { spend: 100, leads: 5, clicks: 50, impressions: 5000 }),   // CTR 1%
      ],
      ents: entities({ campaignId: 'c1', ads: ['a1'], freq: { a1: 3.6 } }),
    });
    const s = signals.find((x) => x.type === 'fatigue');
    expect(s).toMatchObject({ entityId: 'a1', action: 'replace_creative',
      numbers: { frequency_7d: 3.6, ctr_7d: 1, ctr_prev_7d: 2, ctr_drop: 50 } });
  });

  it('frequency cao nhưng CTR và CPL vẫn tốt → không báo mỏi', () => {
    const [{ signals }] = run({
      metaRows: rows('c1', 'a1', [...g.dateRange('2026-10-02', '2026-10-18')],
        { spend: 100, leads: 5, clicks: 100, impressions: 5000 }),
      ents: entities({ campaignId: 'c1', ads: ['a1'], freq: { a1: 3.6 } }),
    });
    expect(types(signals)).not.toContain('fatigue');
  });
});

describe('🔥 scale / ⏳ learning / ⏳ vừa đổi budget', () => {
  // Cửa sổ: CPL $12.5 mỗi ngày, thấp hơn 80% chuẩn ($16)
  const goodWindow = (cid) => [
    ...baselineRows(cid, 'a1'),
    ...rows(cid, 'a1', WINDOW, { spend: 70, leads: 6 }, { ad_name: 'Video TOFU Ad buyer', concept: 'Video Ad buyer' }),
    ...rows(cid, 'a2', WINDOW, { spend: 30, leads: 2 }),
  ];

  it('3 ngày đều tốt, budget đã ổn định > 48h → tăng 20%, nêu ad tốt nhất', () => {
    const [{ signals }] = run({
      metaRows: goodWindow('c1'),
      ents: entities({ campaignId: 'c1', ads: ['a1', 'a2'], budgetChangedAt: '2026-10-15T00:00:00.000Z' }),
    });
    const s = signals.find((x) => x.type === 'scale');
    expect(s).toMatchObject({ level: 'campaign', action: 'increase_budget', numbers: {
      cpa_window: 12.5, baseline: 20, below_baseline: 37.5, scale_step: 0.2, hours_since_budget_change: 104,
    } });
    expect(s.numbers.best_ad).toMatchObject({ ad_id: 'a1', concept: 'Video Ad buyer', cpa: 11.67 });
  });

  it('CBO: lấy mốc đổi budget ở cấp campaign', () => {
    const [{ signals }] = run({
      metaRows: goodWindow('c1'),
      ents: entities({ campaignId: 'c1', ads: ['a1', 'a2'], cbo: true, budgetChangedAt: '2026-10-18T20:00:00.000Z' }),
    });
    expect(types(signals)).toEqual(['budget_wait']);
    expect(signals[0].numbers).toEqual({ hours_since_budget_change: 12, hours_required: 48 });
  });

  it('learning + thay đổi lớn mới 24h → giữ nguyên, không khuyên scale', () => {
    const [{ signals }] = run({
      metaRows: goodWindow('c1'),
      ents: entities({ campaignId: 'c1', ads: ['a1', 'a2'], learning: 'LEARNING' }),
    });
    expect(types(signals)).toEqual(['learning', 'budget_wait']);
  });

  it('learning kéo dài (thay đổi lớn đã > 72h, budget nhỏ) → vẫn đánh giá, khuyên scale', () => {
    const [{ signals }] = run({
      metaRows: goodWindow('c1'),
      ents: entities({ campaignId: 'c1', ads: ['a1', 'a2'], learning: 'LEARNING', lastSigEdit: '2026-10-14T00:00:00.000Z' }),
    });
    expect(types(signals)).toEqual(['scale']);
  });

  it('thay đổi lớn (không phải budget) trong 48h cũng phải chờ', () => {
    const [{ signals }] = run({
      metaRows: goodWindow('c1'),
      ents: entities({ campaignId: 'c1', ads: ['a1', 'a2'], budgetChangedAt: '2026-10-10T00:00:00.000Z',
        lastSigEdit: '2026-10-18T20:00:00.000Z' }),
    });
    expect(types(signals)).toEqual(['budget_wait']);
  });

  it('chưa từng thấy đổi budget → coi như đã ổn định', () => {
    const [{ signals }] = run({ metaRows: goodWindow('c1'), ents: entities({ campaignId: 'c1', ads: ['a1', 'a2'] }) });
    expect(types(signals)).toContain('scale');
  });

  it('chỉ 1 ngày trong cửa sổ xấu → không scale', () => {
    const [{ signals }] = run({
      metaRows: [
        ...baselineRows('c1', 'a1'),
        ...rows('c1', 'a1', WINDOW.slice(0, 2), { spend: 100, leads: 8 }),
        ...rows('c1', 'a1', WINDOW.slice(2), { spend: 100, leads: 3 }),
      ],
      ents: entities({ campaignId: 'c1', ads: ['a1'] }),
    });
    expect(types(signals)).not.toContain('scale');
  });
});

describe('📉 Meta over-report & campaign bán seat', () => {
  it('purchase Meta > seat CRM quá 20% → tin số CRM', () => {
    const [{ signals }] = run({
      metaRows: [...baselineRows('c1', 'a1'), ...rows('c1', 'a1', WINDOW, { spend: 100, leads: 5, purchases: 4 })],
      ents: entities({ campaignId: 'c1', ads: ['a1'] }),
      crmRows: [{ date: '2026-10-18', ad_id: 'a1', seats: 3 }],
    });
    expect(signals.find((s) => s.type === 'overreport').numbers)
      .toEqual({ purchases_meta_7d: 12, seats_crm_7d: 3 });
  });

  it('CRM cũ → không so over-report', () => {
    const [{ signals }] = run({
      metaRows: [...baselineRows('c1', 'a1'), ...rows('c1', 'a1', WINDOW, { spend: 100, leads: 5, purchases: 4 })],
      ents: entities({ campaignId: 'c1', ads: ['a1'] }), crmFresh: false,
    });
    expect(types(signals)).not.toContain('overreport');
  });

  it('OUTCOME_SALES + CRM mới + đủ seat → đo theo CPA seat', () => {
    const sales = { objective: 'OUTCOME_SALES' };
    const crmRows = BASELINE.map((date) => ({ date, ad_id: 'a1', seats: 1 }));
    const [{ ctx }] = run({
      metaRows: [...rows('c1', 'a1', BASELINE, { spend: 40, leads: 5 }, sales),
        ...rows('c1', 'a1', WINDOW, { spend: 40, leads: 5 }, sales)],
      ents: entities({ campaignId: 'c1', ads: ['a1'] }), crmRows,
    });
    expect(ctx.conv).toBe('seats');
    expect(ctx.baseline).toEqual({ value: 40, source: 'campaign' });
  });
});

describe('thứ tự & giới hạn', () => {
  it('tối đa 3 tín hiệu, đốt tiền đứng trước, ad tiêu nhiều hơn đứng trước', () => {
    const [{ signals }] = run({
      metaRows: [
        ...baselineRows('c1', 'ok'),
        ...rows('c1', 'b1', WINDOW, { spend: 20 }), ...rows('c1', 'b2', WINDOW, { spend: 30 }),
        ...rows('c1', 'b3', WINDOW, { spend: 25 }), ...rows('c1', 'b4', WINDOW, { spend: 15 }),
      ],
      ents: entities({ campaignId: 'c1', ads: ['ok', 'b1', 'b2', 'b3', 'b4'], learning: 'LEARNING' }),
    });
    expect(signals.map((s) => s.entityId)).toEqual(['b2', 'b3', 'b1']);
  });

  it('campaign không có spend 7 ngày gần nhất → không dựng ngữ cảnh', () => {
    const out = run({
      metaRows: rows('c1', 'a1', OLD_DATES, { spend: 100, leads: 5 }),
      ents: entities({ campaignId: 'c1', ads: ['a1'] }),
    });
    expect(out).toHaveLength(0);
  });
});
