// @ts-nocheck — chuyển nguyên văn từ bộ test GAS (JavaScript) để chứng minh logic không đổi khi port sang TypeScript.
import { describe, it, expect } from 'vitest';
import * as g from '../src/index';
import { makeCfg } from './helpers';


describe('ngày giờ', () => {
  it('addDays qua tháng/năm và giờ mùa hè', () => {
    expect(g.addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(g.addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(g.addDays('2027-01-01', -1)).toBe('2026-12-31');
  });
  it('dateRange', () => {
    expect([...g.dateRange('2026-10-30', '2026-11-02')])
      .toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });
  it('toIsoUtc chuẩn hóa định dạng của Meta', () => {
    expect(g.toIsoUtc('2026-10-19T08:12:33+0000')).toBe('2026-10-19T08:12:33.000Z');
    expect(g.toIsoUtc('2026-10-19T01:12:33-0700')).toBe('2026-10-19T08:12:33.000Z');
    expect(g.toIsoUtc('')).toBe('');
  });
  it('median', () => {
    expect(g.median([3, 1, 2])).toBe(2);
    expect(g.median([4, 1, 2, 3])).toBe(2.5);
    expect(g.median([])).toBeNull();
  });
});

describe('mergeRowsByKey', () => {
  it('thay dòng trùng khóa, thêm dòng mới, giữ thứ tự', () => {
    const existing = [{ date: 'd1', ad_id: '1', spend: 1 }, { date: 'd1', ad_id: '2', spend: 2 }];
    const incoming = [{ date: 'd1', ad_id: '2', spend: 20 }, { date: 'd2', ad_id: '1', spend: 3 }];
    expect(g.mergeRowsByKey(existing, incoming, ['date', 'ad_id']).map((r) => r.spend)).toEqual([1, 20, 3]);
  });
  it('khóa ad ID dạng chuỗi dài không bị lệch', () => {
    const merged = g.mergeRowsByKey(
      [{ date: 'd', ad_id: '120212345678901234', spend: 1 }],
      [{ date: 'd', ad_id: '120212345678901234', spend: 2 }], ['date', 'ad_id']);
    expect(merged).toHaveLength(1);
  });
});

describe('config', () => {
  it('Sheet ghi đè mặc định, số được đổi kiểu, ô trống bị bỏ qua', () => {
    const cfg = g.mergeWithDefaultConfig(g.parseConfigRows([
      { key: 'fatigue_frequency', scope: 'global', value: '3.5' },
      { key: 'target_cpl', scope: '123', value: '15' },
      { key: 'target_cpl', scope: '456', value: '' },
    ]));
    expect(cfg.global.fatigue_frequency).toBe(3.5);
    expect(cfg.global.burn_cpl_multiple).toBe(2);
    expect(g.configValue(cfg, 'target_cpl', '123')).toBe(15);
    expect(g.configValue(cfg, 'target_cpl', '456')).toBeUndefined();
  });
  it('mặc định có REPORT_TZ và xưng hô', () => {
    const cfg = makeCfg();
    expect(cfg.global.REPORT_TZ).toBe('America/Los_Angeles');
    expect([cfg.global.bot_self, cfg.global.bot_user]).toEqual(['em', 'anh']);
  });
});
