// @ts-nocheck — chuyển nguyên văn từ bộ test GAS (JavaScript) để chứng minh logic không đổi khi port sang TypeScript.
import { describe, it, expect } from 'vitest';
import * as g from '../src/index';

const NOW = '2026-10-19T10:00:00.000Z';

describe('pickAction', () => {
  it('lấy theo thứ tự ưu tiên', () => {
    const actions = [
      { action_type: 'offsite_conversion.fb_pixel_lead', value: '7' },
      { action_type: 'lead', value: '5' },
    ];
    expect(g.pickAction(actions, ['lead', 'offsite_conversion.fb_pixel_lead'])).toBe(5);
    expect(g.pickAction(actions, ['purchase'])).toBe(0);
    expect(g.pickAction(undefined, ['lead'])).toBe(0);
  });
});

describe('normalizeInsightRow', () => {
  const raw = {
    date_start: '2026-10-18', account_id: '763840845228631',
    campaign_id: '120200000000000001', campaign_name: 'RE11 Leads', objective: 'OUTCOME_LEADS',
    adset_id: '120200000000000002', adset_name: 'Broad US',
    ad_id: '120200000000000003', ad_name: 'Photo MOFU Agenda - Bản sao',
    spend: '42.17', impressions: '5200', reach: '3100', frequency: '1.68',
    inline_link_clicks: '61', inline_link_click_ctr: '1.17', cpm: '8.11',
    actions: [
      { action_type: 'lead', value: '3' },
      { action_type: 'landing_page_view', value: '48' },
      { action_type: 'purchase', value: '1' },
      { action_type: 'video_view', value: '900' },
    ],
    video_thruplay_watched_actions: [{ action_type: 'video_view', value: '120' }],
  };

  it('chuẩn hóa số, ID dạng chuỗi, tách concept + stage', () => {
    const r = g.normalizeInsightRow(raw, NOW, {});
    expect(r).toMatchObject({
      date: '2026-10-18', ad_id: '120200000000000003',
      funnel_stage: 'MOFU', creative_format: 'photo', creative_concept: 'Photo Agenda',
      spend: 42.17, link_clicks: 61, leads_meta: 3, purchases_meta: 1,
      landing_page_views: 48, video_3s: 900, thruplay: 120, updated_at: NOW,
    });
    expect(typeof r.campaign_id).toBe('string');
  });

  it('stage lấy từ config theo campaign khi tên không có', () => {
    const r = g.normalizeInsightRow({ ...raw, ad_name: 'Photo KV' }, NOW, { '120200000000000001': 'tofu' });
    expect(r.funnel_stage).toBe('TOFU');
  });
});

describe('resolveBudgetChangedAt', () => {
  const prev = { daily_budget: 50, lifetime_budget: '', budget_changed_at: '2026-10-10T00:00:00.000Z' };

  it('lần đầu thấy entity → chưa biết', () => {
    expect(g.resolveBudgetChangedAt(undefined, { daily_budget: 50 }, NOW, null)).toBe('');
  });
  it('budget không đổi → giữ mốc cũ', () => {
    expect(g.resolveBudgetChangedAt(prev, { daily_budget: 50 }, NOW, null)).toBe(prev.budget_changed_at);
  });
  it('budget đổi, không có activity → thời điểm phát hiện', () => {
    expect(g.resolveBudgetChangedAt(prev, { daily_budget: 60 }, NOW, null)).toBe(NOW);
  });
  it('budget đổi, activity có giờ chính xác → dùng giờ activity', () => {
    const at = '2026-10-19T09:20:00.000Z';
    expect(g.resolveBudgetChangedAt(prev, { daily_budget: 60 }, NOW, at)).toBe(at);
  });
  it('activity cũ hơn mốc đã lưu → bỏ qua', () => {
    expect(g.resolveBudgetChangedAt(prev, { daily_budget: 50 }, NOW, '2026-10-01T00:00:00.000Z'))
      .toBe(prev.budget_changed_at);
  });
});

describe('buildEntityRows', () => {
  it('đổi budget theo đơn vị tiền tệ, gắn learning, frequency 7 ngày', () => {
    const rows = g.buildEntityRows({
      accountId: '1', nowIso: NOW, currency: 'USD',
      campaigns: [{ id: 'c1', name: 'C', objective: 'OUTCOME_LEADS', effective_status: 'ACTIVE' }],
      adsets: [{ id: 's1', name: 'S', campaign_id: 'c1', effective_status: 'ACTIVE', daily_budget: '5000',
        learning_stage_info: { status: 'LEARNING' } }],
      ads: [{ id: 'a1', name: 'Photo KV', campaign_id: 'c1', adset_id: 's1', effective_status: 'ACTIVE' }],
      freq7dByAd: { a1: { reach: '1000', impressions: '3400', frequency: '3.4' } },
      prevByKey: { 'adset||s1': { daily_budget: 40, budget_changed_at: '', first_seen_at: '2026-10-01T00:00:00.000Z' } },
      activityByObject: {},
    });
    const by = Object.fromEntries(rows.map((r) => [r.level, r]));
    expect(by.adset).toMatchObject({ daily_budget: 50, learning_status: 'LEARNING', objective: 'OUTCOME_LEADS',
      budget_changed_at: NOW, first_seen_at: '2026-10-01T00:00:00.000Z' });
    expect(by.ad).toMatchObject({ frequency_7d: 3.4, objective: 'OUTCOME_LEADS' });
    expect(by.campaign.first_seen_at).toBe(NOW);
  });

  it('tiền tệ không có phần thập phân (VND) không chia 100', () => {
    const [c] = g.buildEntityRows({ accountId: '1', nowIso: NOW, currency: 'VND',
      campaigns: [{ id: 'c', name: 'C', daily_budget: '500000' }] });
    expect(c.daily_budget).toBe(500000);
  });
});

describe('latestBudgetActivity', () => {
  it('lấy lần đổi budget mới nhất cho mỗi object', () => {
    const out = g.latestBudgetActivity([
      { object_id: 's1', event_type: 'update_ad_set_budget', event_time: '2026-10-17T01:00:00+0000' },
      { object_id: 's1', event_type: 'update_ad_set_budget', event_time: '2026-10-18T01:00:00+0000' },
      { object_id: 's1', event_type: 'update_ad_set_run_status', event_time: '2026-10-19T01:00:00+0000' },
      { object_id: 'c1', event_type: 'update_campaign_budget', event_time: '2026-10-16T05:00:00+0000' },
    ]);
    expect({ ...out }).toEqual({ s1: '2026-10-18T01:00:00.000Z', c1: '2026-10-16T05:00:00.000Z' });
  });
});
