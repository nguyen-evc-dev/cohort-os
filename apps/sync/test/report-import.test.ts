import { describe, it, expect } from 'vitest';
import { customConversionAction } from '@cohort/core';
import { importReportTable } from '../src/report-import';
import { MemoryStore } from '../src/store';

const ACC = '763840845228631';
const CAMP = '120252652862560233', OTHER = '120252000000000001', ADSET = '120252703228760233';
const AD1 = '120252750913970233', AD2 = '120252743565200233', AD_OTHER = '120252999999999999';
const PID = '11111111-1111-1111-1111-111111111111';
const CHECKOUT = { id: '2050096562303283', name: 'WBN1126 - Check Out' };
const PURCHASED = { id: '1827050228714469', name: 'WBN1126 - Purchased' };
const NOW = new Date('2026-10-28T20:00:00Z'); // 13:00 PT ngày 28/10

const HEADER = ['Day', 'Campaign ID', 'Ad set ID', 'Ad ID', 'Campaign name', 'Ad set name', 'Ad name', 'Amount spent (USD)', 'Impressions', 'Link clicks', 'Video plays at 50%', 'WBN1126 - Check Out', 'WBN1126 - Purchased'];
const row = (day: string, ad: string, spend: number, chk: number, pur: number, camp = CAMP, campName = 'COACH-WBN-RE-PC-SAC') =>
  [day, camp, ADSET, ad, campName, 'MOF', ad === AD1 ? 'Video ban doc_WARM' : 'Photo KV_WARM', String(spend), '1000', '20', '150', String(chk), String(pur)];
const tableOf = (...rows: string[][]) => [HEADER, ['', '', '', '', '', '', '', String(rows.reduce((s, r) => s + Number(r[7]), 0)), String(rows.length * 1000), '', '', '', ''], ...rows];

const seed = () => ({
  projects: [{ id: PID, slug: 'webinar-re11', name: 'Webinar RE11', status: 'active', goal: {} }],
  project_campaigns: [],
  meta_custom_conversions: [{ id: CHECKOUT.id, name: CHECKOUT.name }, { id: PURCHASED.id, name: PURCHASED.name }],
  meta_ads_daily: [{ date: '2026-10-19', ad_id: AD_OTHER, account_id: ACC, campaign_id: OTHER, adset_id: ADSET, spend: 5 }],
  meta_actions_daily: [
    { date: '2026-10-20', ad_id: AD_OTHER, campaign_id: OTHER, action_type: customConversionAction(CHECKOUT.id), count: 9 }, // campaign khác: không được đụng
    { date: '2026-10-20', ad_id: AD1, campaign_id: CAMP, action_type: customConversionAction(CHECKOUT.id), count: 99 }, // số cũ: phải bị thay
  ],
  meta_entities: [{ level: 'campaign', id: OTHER, name: 'OTHER', campaign_id: OTHER, is_sac: false, effective_status: 'ACTIVE' }],
  crm_submissions: [], crm_deals: [], signals: [], creative_assets: [], sync_runs: [], app_config: [],
});
const good = () => tableOf(row('2026-10-20', AD1, 60, 4, 2), row('2026-10-20', AD2, 40, 1, 0), row('2026-10-21', AD1, 50, 2, 1));

describe('importReportTable (import:meta)', () => {
  it('ghi số ad×ngày + chuyển đổi custom, tạo entity thiếu, gán Project, làm mới bản chụp, ghi sync_runs', async () => {
    const store = new MemoryStore(seed());
    const res = await importReportTable(store, good(), { now: NOW, projectSlug: 'webinar-re11', fileName: 'Webinar-RE11-28.10.xlsx' });
    expect(res).toMatchObject({ status: 'ok', rows: 3, actions: 5, campaigns: 1, assigned: 1, dateFrom: '2026-10-20', dateTo: '2026-10-21', spend: 150 });
    expect(res.warnings).toEqual([]);
    const daily = store.t('meta_ads_daily').filter((r) => r.campaign_id === CAMP);
    expect(daily).toHaveLength(3);
    expect(daily[0]).toMatchObject({ account_id: ACC, video_p50: 150, link_clicks: 20, concept_key: expect.any(String), provisional: false });
    expect(store.t('project_campaigns')).toEqual([{ campaign_id: CAMP, project_id: PID, mapped_by: 'auto' }]);
    expect(store.t('meta_entities').filter((e) => e.campaign_id === CAMP).map((e) => e.level).sort()).toEqual(['ad', 'ad', 'adset', 'campaign']);
    expect(store.t('meta_entities').find((e) => e.level === 'campaign' && e.id === CAMP)).toMatchObject({ is_sac: true });
    expect(store.t('meta_entities').find((e) => e.id === OTHER)).toMatchObject({ effective_status: 'ACTIVE' }); // không bị ghi đè
    expect(store.t('bot_snapshots').length).toBe(6);
    expect(store.t('sync_runs')).toEqual([expect.objectContaining({ kind: 'meta_upload', status: 'ok', target_date: '2026-10-21', rows: 3 })]);
  });
  it('chuyển đổi: thay đúng phần của campaign × loại × khoảng ngày; campaign khác giữ nguyên; số cũ bị thay', async () => {
    const store = new MemoryStore(seed());
    await importReportTable(store, good(), { now: NOW });
    const acts = store.t('meta_actions_daily');
    expect(acts.find((a) => a.ad_id === AD_OTHER)!.count).toBe(9);
    const chk = acts.filter((a) => a.campaign_id === CAMP && a.action_type === customConversionAction(CHECKOUT.id));
    expect(chk.map((a) => [a.date, a.ad_id, a.count]).sort()).toEqual([['2026-10-20', AD2, 1], ['2026-10-20', AD1, 4], ['2026-10-21', AD1, 2]]);
    expect(acts.filter((a) => a.action_type === customConversionAction(PURCHASED.id)).reduce((s, a) => s + a.count, 0)).toBe(3);
  });
  it('nhập lại cùng file: không nhân đôi', async () => {
    const store = new MemoryStore(seed());
    await importReportTable(store, good(), { now: NOW, projectSlug: 'webinar-re11' });
    const second = await importReportTable(store, good(), { now: NOW, projectSlug: 'webinar-re11' });
    expect(second).toMatchObject({ status: 'ok', assigned: 0, entities: 0 });
    expect(store.t('meta_ads_daily').filter((r) => r.campaign_id === CAMP)).toHaveLength(3);
    expect(store.t('meta_actions_daily').filter((a) => a.campaign_id === CAMP)).toHaveLength(5);
    expect(store.t('project_campaigns')).toHaveLength(1);
  });
  it('ghi đè số cũ của cùng (ngày, ad) — Meta điều chỉnh số theo thời gian', async () => {
    const store = new MemoryStore(seed());
    await importReportTable(store, good(), { now: NOW });
    await importReportTable(store, tableOf(row('2026-10-20', AD1, 75, 4, 2)), { now: NOW });
    expect(Number(store.t('meta_ads_daily').find((r) => r.date === '2026-10-20' && r.ad_id === AD1)!.spend)).toBe(75);
  });
  it('file gộp cả kỳ / thiếu ID → từ chối, DB không đổi', async () => {
    const store = new MemoryStore(seed());
    const before = JSON.stringify(store.tables);
    const res = await importReportTable(store, [['Campaign name', 'Ad set name', 'Ad name', 'Amount spent (USD)', 'Impressions', 'Reporting starts', 'Reporting ends'], ['A', 'B', 'C', '10', '100', '2026-10-01', '2026-10-27']], { now: NOW });
    expect(res.status).toBe('rejected');
    expect(res.problems.join(' ')).toMatch(/Campaign ID, Ad set ID, Ad ID/);
    expect(JSON.stringify(store.tables)).toBe(before);
  });
  it('Project không tồn tại → lỗi, không ghi số', async () => {
    const store = new MemoryStore(seed());
    const res = await importReportTable(store, good(), { now: NOW, projectSlug: 'khong-co' });
    expect(res.status).toBe('error');
    expect(store.t('meta_ads_daily').filter((r) => r.campaign_id === CAMP)).toHaveLength(0);
  });
  it('campaign đã thuộc Project khác không bị chuyển', async () => {
    const seeded = seed();
    seeded.project_campaigns = [{ campaign_id: CAMP, project_id: '22222222-2222-2222-2222-222222222222' }] as never[];
    const store = new MemoryStore(seeded);
    const res = await importReportTable(store, good(), { now: NOW, projectSlug: 'webinar-re11' });
    expect(res.assigned).toBe(0);
    expect(store.t('project_campaigns')[0].project_id).toBe('22222222-2222-2222-2222-222222222222');
  });
});
