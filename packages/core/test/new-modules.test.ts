import { describe, it, expect } from 'vitest';
import {
  isSacCampaign, syncWindow, syncGate, isAuditableUrl, maskEmail, findPii, assertNoPii,
  signalColor, campaignLight, adLight, lightFromCpa, type Signal,
} from '../src/index';
import { makeCfg } from './helpers';

describe('isSacCampaign', () => {
  it.each([
    ['COACH-WBN-RE-PC-SAC', true],
    ['RES-SELLER-LEAD-SAC Jul 26', true],
    ['res-awareness-views-sac', true],
    ['COACH-WBN-RE-PC-SAC-TEST', true],
    ['SACRAMENTO-LEAD', false],
    ['ISAC Campaign', false],
    ['COACH-RE MS-LEAD MESS Oct 26', false],
    ['', false],
  ])('%s → %s', (name, sac) => expect(isSacCampaign(name)).toBe(sac));
});

describe('syncWindow / syncGate — 5 phút sau khi ngày PT kết thúc', () => {
  it('PDT (25/10): 14:05 VN = 00:05 PT → chạy cho 24/10', () => {
    const w = syncWindow('2026-10-25T07:05:00Z');
    expect(w).toMatchObject({ targetDate: '2026-10-24', ptNow: '2026-10-25 00:05', ready: true });
    expect(syncGate(w, '2026-10-23')).toEqual({ decision: 'RUN', targetDate: '2026-10-24' });
  });
  it('PDT: 15:05 VN cùng ngày → đã sync → bỏ qua', () => {
    expect(syncGate(syncWindow('2026-10-25T08:05:00Z'), '2026-10-24'))
      .toEqual({ decision: 'SKIP', reason: 'already_synced', targetDate: '2026-10-24' });
  });
  it('PST (05/11): 14:05 VN = 23:05 PT hôm trước → ngày đó đã sync hôm qua → bỏ qua', () => {
    const w = syncWindow('2026-11-05T07:05:00Z');
    expect(w.ptNow).toBe('2026-11-04 23:05');
    expect(syncGate(w, '2026-11-03')).toMatchObject({ decision: 'SKIP', reason: 'already_synced' });
  });
  it('PST: 15:05 VN = 00:05 PT → chạy cho 04/11', () => {
    expect(syncGate(syncWindow('2026-11-05T08:05:00Z'), '2026-11-03')).toEqual({ decision: 'RUN', targetDate: '2026-11-04' });
  });
  it('ngày đổi giờ 01/11: vẫn đúng ngày PT', () => {
    expect(syncWindow('2026-11-02T08:05:00Z')).toMatchObject({ targetDate: '2026-11-01', ready: true });
  });
  it('mới 00:02 PT (chưa đủ 5 phút) → chưa chạy', () => {
    expect(syncGate(syncWindow('2026-10-25T07:02:00Z'), null)).toMatchObject({ decision: 'SKIP', reason: 'day_not_closed' });
  });
});

describe('isAuditableUrl', () => {
  it.each([
    ['https://www.evancoaching.com/webinar-re11?h_ad_id=1', true],
    ['https://evancoaching.net/checklist-dangky', true],
    ['https://lp.evancoaching.com/x', true],
    ['https://evancoaching.com.evil.io/x', false],
    ['https://wbn11.vercel.app/index.html', false],
    ['javascript:alert(1)', false],
    ['không phải url', false],
  ])('%s → %s', (url, ok) => expect(isAuditableUrl(url)).toBe(ok));
});

describe('maskEmail', () => {
  it.each([
    ['alex.nguyen326@gmail.com', '*****n326@gmail.com'],
    ['AB@Gmail.com', '*****b@gmail.com'],
    ['a@x.com', '*****@x.com'],
    ['không-có-at', null],
    ['', null],
  ])('%s → %s', (input, out) => expect(maskEmail(input)).toBe(out));
});

describe('findPii / assertNoPii', () => {
  it('bắt email và SĐT, bỏ qua email đã che và ID dài', () => {
    const hits = findPii({
      a: 'liên hệ test.user@example.com', b: '+14085550123', c: '(408) 555-0123', d: '4085550123',
      ok_masked: '*****n326@gmail.com', ad_id: '120252750913970233', contact_id: '257478007363',
      deal_ids: ['66665597586'], count: 4085550123,
    });
    expect(hits.map((h) => h.path).sort()).toEqual(['$.a', '$.b', '$.c', '$.d']);
  });
  it('assertNoPii ném lỗi khi có PII, im lặng khi sạch', () => {
    expect(() => assertNoPii({ rows: [{ email: 'x@y.com' }] }, 'test')).toThrow(/dữ liệu cá nhân/);
    expect(() => assertNoPii({ ad_id: '120252750913970233', spend: 149.7 })).not.toThrow();
  });
});

describe('RYG', () => {
  const cfg = makeCfg();
  const sig = (type: Signal['type'], numbers: Record<string, unknown> = {}, extra: Partial<Signal> = {}): Signal =>
    ({ type, priority: 1, level: 'ad', entityId: 'a1', entityName: 'A1', stage: null, action: 'x', numbers, comparedTo: 'campaign', ...extra });

  it('burn → đỏ; fatigue nhẹ → vàng; fatigue nặng → đỏ; scale → xanh; insufficient → xám', () => {
    expect(signalColor(sig('burn'), cfg).color).toBe('red');
    expect(signalColor(sig('fatigue', { frequency_7d: 3.2, cpa_7d: 30, baseline: 20 }), cfg).color).toBe('yellow');
    expect(signalColor(sig('fatigue', { frequency_7d: 3.8, cpa_7d: 31, baseline: 20 }), cfg).color).toBe('red');
    expect(signalColor(sig('scale', {}, { level: 'campaign' }), cfg).color).toBe('green');
    expect(signalColor(sig('insufficient'), cfg).color).toBe('grey');
    expect(signalColor(sig('learning'), cfg).color).toBe('yellow');
  });
  it('campaignLight: đỏ thắng xanh; không tín hiệu → vàng "watch"', () => {
    expect(campaignLight([sig('scale'), sig('burn')], cfg).color).toBe('red');
    expect(campaignLight([sig('learning'), sig('scale')], cfg).color).toBe('green');
    expect(campaignLight([], cfg)).toMatchObject({ color: 'yellow', action: 'watch' });
  });
  it('adLight: ad tốt nhất của tín hiệu scale → xanh; ad không có tín hiệu → null', () => {
    const scale = sig('scale', { best_ad: { ad_id: 'best' } }, { level: 'campaign', entityId: 'c1' });
    expect(adLight('best', [scale], cfg)?.color).toBe('green');
    expect(adLight('other', [scale], cfg)).toBeNull();
  });
  it('lightFromCpa: khớp kết quả báo cáo demo Webinar RE11 (mốc $39.22)', () => {
    expect(lightFromCpa(149.7, 6, 39.22)).toBe('green');   // Video ban doc MOF: CPA $24.95
    expect(lightFromCpa(43.2, 1, 39.22)).toBe('yellow');   // 1 seat chưa đủ để xanh
    expect(lightFromCpa(57.54, 0, 39.22)).toBe('yellow');  // < 2× mốc, chưa đỏ
    expect(lightFromCpa(90, 0, 39.22)).toBe('red');
    expect(lightFromCpa(17.11, 0, 39.22)).toBe('grey');
  });
});
