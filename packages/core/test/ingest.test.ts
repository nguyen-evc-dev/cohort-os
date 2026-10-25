// @ts-nocheck — chuyển nguyên văn từ bộ test GAS (JavaScript) để chứng minh logic không đổi khi port sang TypeScript.
import { describe, it, expect } from 'vitest';
import * as g from '../src/index';

const NOW = '2026-10-24T08:00:00.000Z';

// Dữ liệu thật lấy từ connector Meta ngày 24/10/2026 (tài khoản EVC), rút gọn
const adRows = [
  { date: '2026-10-22', ad_id: '120252750913970233', ad_name: 'Video ban doc_WARM_Engaged+Follower+Watched_MOF',
    adset_id: '120252703228760233', adset_name: 'WARM_Engaged+Follower+Watched_MOF_Video',
    campaign_id: '120252652862560233', campaign_name: 'COACH-WBN-RE-PC-SAC', objective: 'OUTCOME_SALES',
    effective_status: 'ACTIVE', spend: '19.36', impressions: '708', reach: '615', frequency: '1.15122',
    link_clicks: '18', link_ctr: '2.542373', cpm: '27.34', leads: '', purchases: '', landing_page_views: '14', thruplay: '115' },
  { date: '2026-10-22', ad_id: '120252743565200233', ad_name: 'Photo Poster KV_WARM_Engaged+Follower+Watched_Photo_USexc3',
    adset_id: '120252743565210233', adset_name: 'WARM_Engaged+Follower+Watched_Photo_USexc3',
    campaign_id: '120252652862560233', campaign_name: 'COACH-WBN-RE-PC-SAC', objective: 'OUTCOME_SALES',
    effective_status: 'ACTIVE', spend: '21', impressions: '933', reach: '757', frequency: '1.232497',
    link_clicks: '12', link_ctr: '1.286174', cpm: '22.51', leads: '', purchases: '1', landing_page_views: '10', thruplay: '' },
];

describe('importAdRowToDaily', () => {
  it('chuyển dòng agent ghi → dòng meta_ads_daily, tách concept/stage từ tên thật', () => {
    const r = g.importAdRowToDaily(adRows[0], '763840845228631', NOW, {});
    expect(r).toMatchObject({
      date: '2026-10-22', ad_id: '120252750913970233', creative_format: 'video', creative_concept: 'Video ban doc',
      funnel_stage: 'MOFU', spend: 19.36, link_clicks: 18, leads_meta: 0, thruplay: 115, objective: 'OUTCOME_SALES',
    });
    expect(g.importAdRowToDaily(adRows[1], '1', NOW, {})).toMatchObject({
      creative_concept: 'Photo Poster KV', funnel_stage: '', purchases_meta: 1,
    });
  });
});

describe('validateImport — chặn dữ liệu agent chép sai', () => {
  it('tổng ad khớp tổng tài khoản → cho nạp', () => {
    expect(g.validateImport(adRows, [{ date: '2026-10-22', account_spend: 40.36 }], 0.01).ok).toBe(true);
  });
  it('agent bỏ sót 1 dòng → lệch → từ chối', () => {
    const out = g.validateImport(adRows.slice(0, 1), [{ date: '2026-10-22', account_spend: 40.36 }], 0.01);
    expect(out.ok).toBe(false);
    expect(out.problems[0]).toMatchObject({ date: '2026-10-22', ads_spend: 19.36, account_spend: 40.36 });
  });
  it('agent chép sai 1 số → từ chối', () => {
    const typo = [{ ...adRows[0], spend: '193.6' }, adRows[1]];
    expect(g.validateImport(typo, [{ date: '2026-10-22', account_spend: 40.36 }], 0.01).ok).toBe(false);
  });
  it('lệch làm tròn vài cent → vẫn cho nạp', () => {
    expect(g.validateImport(adRows, [{ date: '2026-10-22', account_spend: 40.39 }], 0.01).ok).toBe(true);
  });
  it('thiếu số tổng tài khoản, hoặc có ngày không được đối chiếu → từ chối', () => {
    expect(g.validateImport(adRows, [], 0.01).ok).toBe(false);
    expect(g.validateImport(adRows, [{ date: '2026-10-21', account_spend: 0 }], 0.01).ok).toBe(false);
  });
});

describe('parseActivityDatetime', () => {
  it('giờ PT → UTC, tự xử lý giờ mùa hè (PDT) và mùa đông (PST)', () => {
    expect(g.parseActivityDatetime('10/20/2026 at 8:50 AM', 'America/Los_Angeles')).toBe('2026-10-20T15:50:00.000Z');
    expect(g.parseActivityDatetime('10/18/2026 at 11:40 PM', 'America/Los_Angeles')).toBe('2026-10-19T06:40:00.000Z');
    expect(g.parseActivityDatetime('11/05/2026 at 8:50 AM', 'America/Los_Angeles')).toBe('2026-11-05T16:50:00.000Z');
    expect(g.parseActivityDatetime('12/01/2026 at 12:05 AM', 'America/Los_Angeles')).toBe('2026-12-01T08:05:00.000Z');
    expect(g.parseActivityDatetime('rác', 'America/Los_Angeles')).toBe('');
  });
});

describe('importEntitiesToRows', () => {
  it('learning, budget, last_sig_edit thật từ connector', () => {
    const activity = g.latestBudgetFromImport([
      { object_id: '120252743565210233', event_type: 'Ad set budget updated', datetime_raw: '10/20/2026 at 8:50 AM' },
      { object_id: '763840845228631', event_type: 'Account billed', datetime_raw: '10/20/2026 at 1:22 AM' },
    ], 'America/Los_Angeles');
    const [row] = g.importEntitiesToRows([{
      level: 'adset', id: '120252743565210233', name: 'WARM_Engaged+Follower+Watched_Photo_USexc3',
      campaign_id: '120252652862560233', effective_status: 'ACTIVE', daily_budget: '24', lifetime_budget: '0',
      learning_status: 'LEARNING', last_sig_edit_ts: '1792758058',
    }], '763840845228631', {
      'adset||120252743565210233': { daily_budget: 20, budget_changed_at: '', first_seen_at: '2026-10-01T00:00:00.000Z' },
    }, activity, NOW);
    expect(row).toMatchObject({
      daily_budget: 24, lifetime_budget: '', learning_status: 'LEARNING',
      budget_changed_at: '2026-10-20T15:50:00.000Z',
      last_sig_edit_at: '2026-10-23T12:20:58.000Z',
      first_seen_at: '2026-10-01T00:00:00.000Z', campaign_id: '120252652862560233', adset_id: '120252743565210233',
    });
    expect(Object.keys({ ...activity })).toEqual(['120252743565210233']);
  });
});
