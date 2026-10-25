import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addDays, dateRange } from '@cohort/core';
import { readInbox } from '../src/inbox';
import { pushBatch } from '../src/pipeline';
import { MemoryStore } from '../src/store';
import { seatsByAdDate } from '../src/signals-job';
import { cleanupInbox } from '../src/cleanup';

const ACC = '763840845228631';
const CAMP_SAC = '120252652862560233';  // COACH-WBN-RE-PC-SAC
const CAMP_AW = '120250767837710233';   // RES-AWARENESS-VIEWS
const ADSET_1 = '120252902600030233';
const ADSET_2 = '120250767837630233';
const AD_MOF = '120252750913970233';
const AD_KV = '120252743565200233';
const AD_VIEW = '120252147898210233';
const DAYS = ['2026-10-22', '2026-10-23', '2026-10-24'];
// 25/10 08:00 UTC = 01:00 PDT 25/10 → ngày 24/10 PT đã kết thúc
const NOW = new Date('2026-10-25T08:00:00Z');

const usd = (v: number | string) => ({ value: String(v), unit: 'USD' });

/** Ghi 1 thư mục inbox giống hệt dữ liệu agent chép từ connector (kể cả dòng rỗng không có id). */
function writeFixture(mut: (f: Record<string, any>) => void = () => {}): string {
  const adDay = (date: string, id: string, name: string, camp: string, campName: string, adset: string, obj: string, spend: number, extra: Record<string, unknown> = {}) => ({
    date_start: date, date_stop: date, amount_spent: usd(spend), impressions: String(Math.round(spend * 100)), reach: String(Math.round(spend * 90)),
    frequency: '1.1', link_click: spend > 5 ? String(Math.round(spend / 2)) : null, website_ctr: '1.2', cpm: usd(9.84),
    lead: null, omni_purchase: null, landing_page_view: null, video_thruplay_watched_actions: null,
    id, name, campaign_id: camp, campaign_name: campName, adset_id: adset, adset_name: 'WARM_Engaged+Follower+Watched_MOF', objective: obj,
    effective_status: 'ACTIVE', ...extra,
  });
  const ads: any[] = [];
  const spend: Record<string, [number, number, number]> = { '2026-10-22': [30.15, 12.4, 4.88], '2026-10-23': [28.0, 11.11, 2.75], '2026-10-24': [31.5, 10.0, 3.1] };
  for (const d of DAYS) {
    const [a, b, c] = spend[d];
    ads.push({ date_start: d, date_stop: d, amount_spent: usd(0), impressions: '0', reach: '0', frequency: '0' }); // dòng rỗng của connector
    ads.push(adDay(d, AD_MOF, 'Video ban doc_WARM_Engaged+Follower+Watched_MOF', CAMP_SAC, 'COACH-WBN-RE-PC-SAC', ADSET_1, 'OUTCOME_SALES', a, { omni_purchase: '1' }));
    ads.push(adDay(d, AD_KV, 'Photo Agenda_WARM_Engaged+Follower+Watched_Photo - Copy', CAMP_SAC, 'COACH-WBN-RE-PC-SAC', ADSET_1, 'OUTCOME_SALES', b));
    ads.push(adDay(d, AD_VIEW, 'Video Giải Mã ADU Từ A-Z_VIEWS 15S_BROAD 18+ exc Engaged+Followers - Copy 2', CAMP_AW, 'RES-AWARENESS-VIEWS', ADSET_2, 'OUTCOME_AWARENESS', c,
      { video_thruplay_watched_actions: '107' }));
  }
  const f: Record<string, any> = {
    'meta.json': { mode: 'daily', account_id: ACC, date_from: DAYS[0], date_to: DAYS[2], run_started_at: '2026-10-25T07:05:00Z' },
    // ads.json lưu nguyên kết quả tool (ad_entities là chuỗi JSON) — sync phải tự mở
    'ads.json': { ad_entities: JSON.stringify(ads) },
    'account.json': DAYS.map((d) => ({ date_start: d, date_stop: d, amount_spent: usd(spend[d].reduce((s, x) => s + x, 0).toFixed(2)) })),
    'campaigns.json': [
      { id: CAMP_SAC, name: 'COACH-WBN-RE-PC-SAC', objective: 'OUTCOME_SALES', effective_status: 'ACTIVE', daily_budget: usd(0), lifetime_budget: usd(0) },
      { id: CAMP_AW, name: 'RES-AWARENESS-VIEWS', objective: 'OUTCOME_AWARENESS', effective_status: 'ACTIVE', daily_budget: usd(10), lifetime_budget: usd(0) },
    ],
    'adsets.json': [
      { id: ADSET_1, name: 'WARM_Engaged+Follower+Watched_MOF', campaign_id: CAMP_SAC, effective_status: 'ACTIVE', daily_budget: usd(60), lifetime_budget: usd(0),
        learning_stage_info: { status: 'LEARNING', last_sig_edit_ts: 1792873124, conversions: 0 },
        targeting_summary: { age_min: 18, age_max: 65, countries: ['US'], custom_audiences: ['00_WARM_EVC_Page engagement_120D'], excluded_custom_audiences: [] } },
      { id: ADSET_2, name: 'VIEWS 15S_BROAD 18+', campaign_id: CAMP_AW, effective_status: 'ACTIVE', daily_budget: usd(0), lifetime_budget: usd(0) },
    ],
    'ads_status.json': [
      { id: AD_MOF, name: 'Video ban doc_WARM_Engaged+Follower+Watched_MOF', campaign_id: CAMP_SAC, adset_id: ADSET_1, effective_status: 'ACTIVE', frequency: '1.8', reach: '4100', impressions: '7380' },
      { id: AD_KV, name: 'Photo Agenda_WARM', campaign_id: CAMP_SAC, adset_id: ADSET_1, effective_status: 'PAUSED', frequency: '1.2', reach: '900', impressions: '1080' },
    ],
    'creatives.json': [
      { ad_id: AD_VIEW, creative_id: '990478514070374', title: null, body: 'Giải Mã ADU Từ A-Z', link_url: null, call_to_action_type: 'SEE_DETAILS', thumbnail_url: 'https://scontent.xx.fbcdn.net/x.jpg' },
    ],
    'activity.json': [
      { event_type: 'Ad set budget updated', actor_id: '100055459140615', actor_name: 'Ai Đó', object_id: ADSET_1, datetime: '10/20/2026 at 8:50 AM',
        extra_data: JSON.stringify({ old_value: { type: 'payment_amount', currency: 'USD', old_value: 2000 }, new_value: { type: 'payment_amount', currency: 'USD', new_value: 2400 } }) },
      { event_type: 'Account billed', object_id: ACC, datetime: '10/20/2026 at 1:22 AM', extra_data: '{"new_value":56850}' },
    ],
  };
  mut(f);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cohort-inbox-'));
  for (const [name, data] of Object.entries(f)) if (data !== undefined) fs.writeFileSync(path.join(dir, name), JSON.stringify(data));
  return dir;
}

let store: MemoryStore;
beforeEach(() => { store = new MemoryStore(); });

describe('readInbox', () => {
  it('mở kết quả tool lưu nguyên, bỏ dòng rỗng không có id, bỏ tên người sửa', () => {
    const b = readInbox(writeFixture());
    expect(b.problems).toEqual([]);
    expect(b.adRows.length).toBe(9);
    expect(b.checkRows.map((c) => c.account_spend)).toEqual([47.43, 41.86, 44.6]);
    expect(b.activity).toEqual([{ object_id: ADSET_1, event_type: 'Ad set budget updated', datetime_raw: '10/20/2026 at 8:50 AM', old_value: 20, new_value: 24 }]);
    expect(JSON.stringify(b)).not.toMatch(/actor|Ai Đó/);
  });
  it('thiếu file bắt buộc / JSON hỏng → ghi lỗi', () => {
    const b = readInbox(writeFixture((f) => { delete f['account.json']; f['ads.json'] = undefined; }));
    expect(b.problems.map((p) => p.reason)).toEqual(expect.arrayContaining(['missing_file']));
  });
});

describe('pushBatch', () => {
  it('dữ liệu khớp → ghi đủ bảng, số khớp từng ngày, sync_runs ok', async () => {
    const res = await pushBatch(store, readInbox(writeFixture()), { now: NOW, accountId: ACC });
    expect(res.status).toBe('ok');
    const daily = store.t('meta_ads_daily');
    expect(daily.length).toBe(9);
    for (const d of DAYS) {
      const sum = Math.round(daily.filter((r) => r.date === d).reduce((s, r) => s + r.spend, 0) * 100) / 100;
      expect(sum).toBe(res.spendByDate[d]);
    }
    const kv = daily.find((r) => r.ad_id === AD_KV)!;
    expect(kv).toMatchObject({ creative_concept: 'Photo Agenda', concept_key: 'photo agenda', creative_format: 'photo', funnel_stage: 'MOFU', provisional: false });
    expect(daily.find((r) => r.ad_id === AD_MOF)).toMatchObject({ funnel_stage: 'MOFU', purchases_meta: 1, creative_format: 'video' });

    const camp = store.t('meta_entities').find((e) => e.id === CAMP_SAC)!;
    expect(camp.is_sac).toBe(true);
    expect(camp.daily_budget).toBeNull();
    const adset = store.t('meta_entities').find((e) => e.id === ADSET_1)!;
    expect(adset).toMatchObject({ learning_status: 'LEARNING', daily_budget: 60, budget_changed_at: '2026-10-20T15:50:00.000Z' });
    expect(adset.targeting_summary).toMatchObject({ age_min: 18, countries: ['US'] });
    expect(store.t('meta_entities').find((e) => e.id === AD_KV)).toMatchObject({ effective_status: 'PAUSED', frequency_7d: 1.2, campaign_id: CAMP_SAC });

    expect(store.t('meta_budget_events')).toEqual([{ object_id: ADSET_1, event_time: '2026-10-20T15:50:00.000Z', event_type: 'Ad set budget updated', old_value: 20, new_value: 24 }]);
    expect(store.t('meta_creatives')[0]).toMatchObject({ ad_id: AD_VIEW, cta: 'SEE_DETAILS', creative_id: '990478514070374' });
    expect(store.t('sync_runs')).toMatchObject([{ kind: 'meta', target_date: '2026-10-24', status: 'ok', rows: 9 }]);
    expect(await store.lastMetaSyncedDate()).toBe('2026-10-24');
  });

  it('agent chép sai 1 số → bị từ chối, DB không đổi', async () => {
    const dir = writeFixture((f) => {
      const ads = JSON.parse(f['ads.json'].ad_entities);
      ads.find((r: any) => r.id === AD_KV && r.date_start === '2026-10-23').amount_spent = usd(1.11); // đúng là 11.11
      f['ads.json'] = ads;
    });
    const res = await pushBatch(store, readInbox(dir), { now: NOW, accountId: ACC });
    expect(res.status).toBe('rejected');
    expect(res.problems).toEqual([{ date: '2026-10-23', ads_spend: 31.86, account_spend: 41.86, diff_ratio: 0.239 }]);
    expect(store.t('meta_ads_daily')).toEqual([]);
    expect(store.t('meta_entities')).toEqual([]);
    expect(store.t('signals')).toEqual([]);
    expect(store.t('sync_runs')).toMatchObject([{ status: 'rejected' }]);
    expect(await store.lastMetaSyncedDate()).toBeNull();
  });

  it.each([
    ['thiếu 1 dòng ad', (f: any) => { const a = JSON.parse(f['ads.json'].ad_entities); f['ads.json'] = a.filter((r: any) => !(r.id === AD_MOF && r.date_start === '2026-10-24')); }, 'diff_ratio'],
    ['trùng dòng (chép lặp 1 trang)', (f: any) => { const a = JSON.parse(f['ads.json'].ad_entities); f['ads.json'] = [...a, a[1]]; }, 'duplicate_ad_row'],
    ['thiếu tổng tài khoản 1 ngày', (f: any) => { f['account.json'] = f['account.json'].slice(1); }, 'missing_account_total'],
    ['sai tài khoản', (f: any) => { f['meta.json'].account_id = '1234567890'; }, 'wrong_account'],
    ['ngày ngoài khoảng', (f: any) => { f['meta.json'].date_from = '2026-10-23'; }, 'date_out_of_range'],
  ])('%s → từ chối', async (_n, mut, reason) => {
    const res = await pushBatch(store, readInbox(writeFixture(mut)), { now: NOW, accountId: ACC });
    expect(res.status).toBe('rejected');
    expect(JSON.stringify(res.problems)).toContain(reason);
    expect(store.t('meta_ads_daily')).toEqual([]);
  });

  it('ngày PT chưa kết thúc → provisional', async () => {
    const res = await pushBatch(store, readInbox(writeFixture()), { now: new Date('2026-10-24T20:00:00Z'), accountId: ACC });
    expect(res.status).toBe('ok');
    expect(store.t('meta_ads_daily').filter((r) => r.provisional).map((r) => r.date)).toEqual(['2026-10-24', '2026-10-24', '2026-10-24']);
  });

  it('chạy lại cùng thư mục → upsert, không nhân đôi', async () => {
    const dir = writeFixture();
    await pushBatch(store, readInbox(dir), { now: NOW, accountId: ACC });
    await pushBatch(store, readInbox(dir), { now: NOW, accountId: ACC });
    expect(store.t('meta_ads_daily').length).toBe(9);
  });

  it('tính tín hiệu: ad đốt tiền (0 lead, spend ≥ 2× CPL chuẩn) → đèn đỏ, gắn project', async () => {
    const LEAD_CAMP = '120240000000000233';
    const AD_GOOD = '120240000000001233';
    const AD_BURN = '120240000000002233';
    // 14 ngày trước cửa sổ: CPL chuẩn $10 (spend 20, 2 lead/ngày)
    const hist = dateRange(addDays(DAYS[0], -14), addDays(DAYS[0], -1)).map((d) => ({
      date: d, ad_id: AD_GOOD, account_id: ACC, campaign_id: LEAD_CAMP, campaign_name: 'RES-SELLER-LEAD-SAC Jul 26', objective: 'OUTCOME_LEADS',
      adset_id: '120240000000003233', ad_name: 'Photo KV_COLD', creative_concept: 'Photo KV', creative_format: 'photo', funnel_stage: null,
      spend: 20, leads_meta: 2, purchases_meta: 0, link_clicks: 10, impressions: 1000,
    }));
    store = new MemoryStore({ meta_ads_daily: hist, project_campaigns: [{ campaign_id: LEAD_CAMP, project_id: 'p-seller' }] });
    const dir = writeFixture((f) => {
      const a = JSON.parse(f['ads.json'].ad_entities);
      for (const d of DAYS) {
        a.push({ date_start: d, amount_spent: usd(12), impressions: '800', reach: '700', frequency: '1.1', id: AD_BURN, name: 'Video Ban doc_COLD',
          campaign_id: LEAD_CAMP, campaign_name: 'RES-SELLER-LEAD-SAC Jul 26', adset_id: '120240000000003233', adset_name: 'COLD', objective: 'OUTCOME_LEADS', lead: null });
      }
      f['ads.json'] = a;
      f['account.json'] = f['account.json'].map((r: any) => ({ ...r, amount_spent: usd((Number(r.amount_spent.value) + 12).toFixed(2)) }));
    });
    const res = await pushBatch(store, readInbox(dir), { now: NOW, accountId: ACC });
    expect(res.status).toBe('ok');
    const burn = store.t('signals').find((s) => s.type === 'burn')!;
    expect(burn).toMatchObject({ as_of: '2026-10-24', level: 'ad', entity_id: AD_BURN, color: 'red', action: 'pause_ad', project_id: 'p-seller', compared_to: 'campaign' });
    expect(burn.numbers).toMatchObject({ spend: 36, conversions: 0, baseline: 10, campaign_id: LEAD_CAMP, entity_name: 'Video Ban doc_COLD' });
  });
});

describe('seatsByAdDate', () => {
  it('first-touch có tracking + deal seat đã thắng', () => {
    const subs = [
      { project_id: 'p', contact_id: '1', conversion_id: 'a', converted_on: '2026-10-20', ad_id: '111111', source_hint: 'tracked' },
      { project_id: 'p', contact_id: '1', conversion_id: 'b', converted_on: '2026-10-21', ad_id: '222222', source_hint: 'tracked' },
      { project_id: 'p', contact_id: '2', conversion_id: 'c', converted_on: '2026-10-21', ad_id: null, source_hint: 'direct' },
    ];
    const deals = [{ deal_type: 'seat', is_won: true, contact_ids: ['1'] }, { deal_type: 'seat', is_won: false, contact_ids: ['2'] }];
    expect(seatsByAdDate(subs, deals)).toEqual([{ ad_id: '111111', date: '2026-10-20', seats: 1 }]);
  });
});

describe('cleanupInbox', () => {
  it('xóa thư mục cũ hơn 14 ngày, giữ thư mục mới và file lạ', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cohort-root-'));
    for (const n of ['2026-10-01', '2026-10-09-backfill-1', '2026-10-11', '2026-10-24', 'ghi-chu']) fs.mkdirSync(path.join(root, n));
    expect(cleanupInbox(root, '2026-10-24').sort()).toEqual(['2026-10-01', '2026-10-09-backfill-1']);
    expect(fs.readdirSync(root).sort()).toEqual(['2026-10-11', '2026-10-24', 'ghi-chu']);
  });
});
