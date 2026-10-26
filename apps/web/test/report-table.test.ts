import { describe, it, expect } from 'vitest';
import { buildPresets, defaultPreset, type TableStep } from '../src/components/ReportTable';

// Webinar RE11: Check Out → Purchased (Meta) → Seat → Khóa học $1750 (CRM)
const steps: TableStep[] = [
  { key: 'checkout', label: 'Check Out', source: 'meta', count: 61, available: true },
  { key: 'purchased', label: 'Purchased (mua vé)', source: 'meta', count: 26, available: true },
  { key: 'seat', label: 'Seat', source: 'crm', count: 14, available: true },
  { key: 'program', label: 'Mua khóa học', source: 'crm', count: 0, available: true },
];
const opts = { hasCrm: true, finalKey: 'program', compare: { meta: 'purchased', crm: 'seat' } };
const ids = (p: { cols: { id: string }[] }) => p.cols.map((c) => c.id);

describe('mẫu xem bảng báo cáo', () => {
  const presets = buildPresets(steps, opts);
  it('có 4 mẫu: Cơ bản, Ad → Seat, Ad → Mua khóa học, Giữ chân', () => {
    expect(presets.map((p) => p.id)).toEqual(['basic', 'to:seat', 'to:program', 'retention']);
  });
  it('Ad → Seat: Check Out, Purchased, CPA Purchased, Seat, CPA Seat, Δ — không có cột khóa học / ROAS', () => {
    expect(ids(presets[1])).toEqual(['spend', 'step:checkout', 'step:purchased', 'cost:purchased', 'step:seat', 'cost:seat', 'delta']);
  });
  it('Ad → Mua khóa học: thêm khóa học, CPA khóa học, giá trị, ROAS', () => {
    expect(ids(presets[2])).toEqual(['spend', 'step:checkout', 'step:purchased', 'cost:purchased', 'step:seat', 'cost:seat', 'step:program', 'cost:program', 'value:program', 'roas', 'delta']);
  });
  it('Giữ chân: hook, ThruPlay, xem 50%… và không có số CRM', () => {
    expect(ids(presets[3])).toEqual(expect.arrayContaining(['hookRate', 'thruplay', 'holdRate', 'p50Rate', 'clicks', 'ctr']));
    expect(presets[3].cols.every((c) => c.group === 'meta')).toBe(true);
  });
  it('Cơ bản: spend, views, từng bước Meta + chi phí', () => {
    expect(ids(presets[0])).toEqual(['spend', 'impressions', 'clicks', 'ctr', 'lpv', 'video3s', 'step:checkout', 'cost:checkout', 'step:purchased', 'cost:purchased']);
  });
  it('mặc định = bước CRM xa nhất đã có số: chưa ai mua khóa học → Ad → Seat', () => {
    expect(defaultPreset(presets, steps)).toBe('to:seat');
    const sold = steps.map((s) => (s.key === 'program' ? { ...s, count: 1 } : s));
    expect(defaultPreset(presets, sold)).toBe('to:program');
  });
  it('chưa import CRM → không có mẫu CRM, mặc định Cơ bản', () => {
    const noCrm = buildPresets(steps, { ...opts, hasCrm: false });
    expect(noCrm.map((p) => p.id)).toEqual(['basic', 'retention']);
    expect(defaultPreset(noCrm, steps)).toBe('basic');
  });
});
