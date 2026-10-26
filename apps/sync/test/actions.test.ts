import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { costPerActions, deriveCounts, readInbox } from '../src/inbox';
import { checkActionTotals, pushBatch } from '../src/pipeline';
import { MemoryStore } from '../src/store';

const ACC = '763840845228631';
const CAMP = '120252652862560233';
const AD = '120252750913970233';
const CHECKOUT = 'offsite_conversion.custom.2050096562303283';
const PURCHASED = 'offsite_conversion.custom.1827050228714469';
const usd = (v: number | string) => ({ value: String(v), unit: 'USD' });

describe('costPerActions / deriveCounts (custom conversion = spend / cost)', () => {
  it('đọc khóa phẳng của connector, chỉ giữ loại cần thiết', () => {
    const r = {
      [`cost_per_action_type:${CHECKOUT}`]: '16.268525', [`cost_per_action_type:${PURCHASED}`]: '38.168462',
      'cost_per_action_type:link_click': '1.47', 'cost_per_action_type:video_view': '0.174285', 'cost_per_action_type:post_engagement': '0.15',
    };
    expect(costPerActions(r)).toEqual({ [CHECKOUT]: 16.268525, [PURCHASED]: 38.168462, video_view: 0.174285 });
  });
  it('đọc dạng object / mảng { action_type, value }', () => {
    expect(costPerActions({ cost_per_action_type: { [CHECKOUT]: '5' } })).toEqual({ [CHECKOUT]: 5 });
    expect(costPerActions({ cost_per_action_type: [{ action_type: PURCHASED, value: '2.5' }] })).toEqual({ [PURCHASED]: 2.5 });
  });
  it('khớp số thật: $992.38 / $16.268525 = 61 Check Out, / $38.168462 = 26 Purchased', () => {
    expect(deriveCounts(992.38, { [CHECKOUT]: 16.268525, [PURCHASED]: 38.168462 })).toEqual({ [CHECKOUT]: 61, [PURCHASED]: 26 });
  });
  it('bỏ kết quả không gần số nguyên (dữ liệu chép sai) và spend = 0', () => {
    expect(deriveCounts(100, { [CHECKOUT]: 30 })).toEqual({}); // 3.33 → bỏ
    expect(deriveCounts(0, { [CHECKOUT]: 10 })).toEqual({});
  });
});

function inbox(adCost: Record<string, string>, accCost: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cohort-act-'));
  const w = (f: string, d: unknown) => fs.writeFileSync(path.join(dir, f), JSON.stringify(d));
  w('meta.json', { mode: 'daily', account_id: ACC, date_from: '2026-10-24', date_to: '2026-10-24' });
  w('ads.json', [{ date_start: '2026-10-24', id: AD, name: 'Video ban doc_WARM_MOF', campaign_id: CAMP, campaign_name: 'COACH-WBN-RE-PC-SAC',
    adset_id: '120252703228760233', adset_name: 'MOF', objective: 'OUTCOME_SALES', amount_spent: usd(30), impressions: '1000', outbound_clicks: '12',
    ...Object.fromEntries(Object.entries(adCost).map(([k, v]) => [`cost_per_action_type:${k}`, v])) }]);
  w('account.json', [{ date_start: '2026-10-24', amount_spent: usd(30), ...Object.fromEntries(Object.entries(accCost).map(([k, v]) => [`cost_per_action_type:${k}`, v])) }]);
  w('customconversions.json', [{ id: '2050096562303283', name: 'WBN1126 - Check Out', custom_event_type: 'INITIATED_CHECKOUT', is_archived: false, last_fired_time: '2026-10-24T21:19:54-07:00', default_conversion_value: 0, pixel_rule: '{"x":1}' }]);
  return dir;
}

describe('sync:push ghi chuyển đổi', () => {
  it('ghi meta_actions_daily, video_3s, outbound, danh mục custom conversion', async () => {
    const store = new MemoryStore();
    const res = await pushBatch(store, readInbox(inbox({ [CHECKOUT]: '10', [PURCHASED]: '15', video_view: '0.1' }, { [CHECKOUT]: '10' })),
      { now: new Date('2026-10-25T08:00:00Z'), accountId: ACC });
    expect(res.status).toBe('ok');
    expect(store.t('meta_actions_daily').map((a) => [a.action_type, a.count]).sort()).toEqual([[PURCHASED, 2], [CHECKOUT, 3]].sort());
    expect(store.t('meta_ads_daily')[0]).toMatchObject({ video_3s: 300, outbound_clicks: 12 });
    expect(store.t('meta_custom_conversions')[0]).toMatchObject({ id: '2050096562303283', name: 'WBN1126 - Check Out', event_type: 'INITIATED_CHECKOUT', is_archived: false });
    expect(store.t('meta_custom_conversions')[0]).not.toHaveProperty('pixel_rule');
    expect(res.warnings).toEqual([]);
  });
  it('tổng theo ad lệch tổng tài khoản → cảnh báo (không chặn)', () => {
    const b = readInbox(inbox({ [CHECKOUT]: '10' }, { [CHECKOUT]: '3' })); // ad: 3, tài khoản: 10
    expect(checkActionTotals(b)).toEqual([`2026-10-24 ${CHECKOUT}: ads 3 vs tài khoản 10`]);
  });
  it('chạy lại thay số chuyển đổi cũ của cùng khoảng ngày (không cộng dồn)', async () => {
    const store = new MemoryStore();
    const opt = { now: new Date('2026-10-25T08:00:00Z'), accountId: ACC };
    await pushBatch(store, readInbox(inbox({ [CHECKOUT]: '10' }, {})), opt);
    await pushBatch(store, readInbox(inbox({ [CHECKOUT]: '15' }, {})), opt);
    expect(store.t('meta_actions_daily')).toMatchObject([{ action_type: CHECKOUT, count: 2 }]);
  });
});
