import { describe, it, expect } from 'vitest';
import { customConversionAction, GOAL_TEMPLATES, parseGoal } from '@cohort/core';
import { refreshSnapshots } from '../src/snapshots-job';
import { MemoryStore } from '../src/store';

const CAMP = '120252652862560233';
const AD = '120252750913970233';
const PID = '11111111-1111-1111-1111-111111111111';
const PURCHASED = customConversionAction('1827050228714469');
const goal = parseGoal({
  ...GOAL_TEMPLATES.webinar.goal,
  steps: [
    { key: 'purchased', label: 'Purchased', source: 'meta', action_type: PURCHASED },
    { key: 'seat', label: 'Seat', source: 'crm', crm: 'seats' },
  ],
  primary: 'purchased', final: 'seat', compare: { meta: 'purchased', crm: 'seat' },
});

const seed = () => ({
  projects: [{ id: PID, slug: 'webinar-re11', name: 'Webinar RE11', status: 'active', goal }],
  project_campaigns: [{ project_id: PID, campaign_id: CAMP }],
  meta_ads_daily: [{
    date: '2026-10-24', ad_id: AD, campaign_id: CAMP, campaign_name: 'COACH-WBN-RE-PC-SAC', adset_id: '120252703228760233', adset_name: 'MOF', ad_name: 'Video ban doc_WARM',
    creative_concept: 'Video ban doc', concept_key: 'video ban doc', creative_format: 'video', spend: 100, impressions: 1000, link_clicks: 20, leads_meta: 0, purchases_meta: 0, landing_page_views: 15, video_3s: 300, thruplay: 60, provisional: false,
  }],
  meta_entities: [{ level: 'campaign', id: CAMP, name: 'COACH-WBN-RE-PC-SAC', campaign_id: CAMP, is_sac: true, targeting_summary: null }],
  meta_actions_daily: [{ date: '2026-10-24', ad_id: AD, campaign_id: CAMP, action_type: PURCHASED, count: 4 }],
  crm_submissions: [{ conversion_id: 'a', project_id: PID, contact_id: '1001001', converted_on: '2026-10-24', ad_id: AD, source_hint: 'tracked' }],
  crm_deals: [{ deal_id: '1', contact_ids: ['1001001'], deal_type: 'seat', is_won: true, amount: 10, deal_stage: 'Following' }],
  signals: [
    { as_of: '2026-10-23', level: 'ad', entity_id: AD, type: 'burn', color: 'red', action: 'pause_ad', numbers: { campaign_id: CAMP, spend: 5 } },
    { as_of: '2026-10-24', level: 'ad', entity_id: AD, type: 'scale', color: 'green', action: 'increase_budget', numbers: { campaign_id: CAMP, spend: 100 } },
  ],
});

describe('refreshSnapshots', () => {
  it('ghi 6 bản chụp (Project + all × 7d/30d/all), số theo mục tiêu, tín hiệu của ngày mới nhất, không có contact_id', async () => {
    const store = new MemoryStore(seed());
    const res = await refreshSnapshots(store, '2026-10-25T08:00:00Z');
    expect(res).toEqual({ rows: 6, asOf: '2026-10-24' });
    const snaps = store.t('bot_snapshots');
    expect(snaps.map((s) => `${s.slug}/${s.range_key}`).sort()).toEqual(['all/30d', 'all/7d', 'all/all', 'webinar-re11/30d', 'webinar-re11/7d', 'webinar-re11/all']);
    const p = snaps.find((s) => s.slug === 'webinar-re11' && s.range_key === '7d')!;
    expect(p.built_at).toBe('2026-10-25T08:00:00Z');
    expect(p.payload.primary).toMatchObject({ label: 'Purchased', count: 4, cost: 25 });
    expect(p.payload.truth_gap).toMatchObject({ meta_purchases: 4, crm_seats: 1 });
    expect(p.payload.signals.map((s: any) => s.color)).toEqual(['green']);
    expect(JSON.stringify(snaps)).not.toContain('1001001');
  });
  it('chạy lại: thay thế, không nhân đôi; Project bị lưu trữ thì bản chụp biến mất', async () => {
    const store = new MemoryStore(seed());
    await refreshSnapshots(store, '2026-10-25T08:00:00Z');
    await refreshSnapshots(store, '2026-10-25T09:00:00Z');
    expect(store.t('bot_snapshots')).toHaveLength(6);
    store.t('projects')[0].status = 'archived';
    await refreshSnapshots(store, '2026-10-25T10:00:00Z');
    expect(store.t('bot_snapshots').map((s) => s.slug)).toEqual(['all', 'all', 'all']);
  });
  it('chưa có số Meta → không ghi gì', async () => {
    const store = new MemoryStore({ projects: [], project_campaigns: [], meta_entities: [], crm_submissions: [], crm_deals: [], signals: [] });
    expect(await refreshSnapshots(store, '2026-10-25T08:00:00Z')).toEqual({ rows: 0, asOf: null });
  });
});
