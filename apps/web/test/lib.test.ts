import { describe, it, expect } from 'vitest';
import { fmtAgo, fmtDelta, fmtMoney, fmtPct, fmtRoas, fmtVnTime, slugify, DASH } from '../src/lib/format';
import { filterQuery, parseFilters } from '../src/lib/filters';

describe('format (Design Proposal 2.5)', () => {
  it('tiền ≥ $100 không thập phân, < $100 có 2 thập phân, null → —', () => {
    expect(fmtMoney(12480)).toBe('$12,480');
    expect(fmtMoney(42.1)).toBe('$42.10');
    expect(fmtMoney(99.995)).toBe('$100.00');
    expect(fmtMoney(0)).toBe('$0.00');
    expect(fmtMoney(null)).toBe(DASH);
    expect(fmtMoney(undefined)).toBe(DASH);
  });
  it('ROAS, %, delta', () => {
    expect(fmtRoas(3.4219)).toBe('3.42x');
    expect(fmtRoas(null)).toBe(DASH);
    expect(fmtPct(56.24)).toBe('56.2%');
    expect(fmtDelta(0.384)).toBe('▲ 38%');
    expect(fmtDelta(-0.1)).toBe('▼ 10%');
    expect(fmtDelta(0)).toBe('0%');
  });
  it('thời gian', () => {
    const now = Date.parse('2026-10-25T10:00:00Z');
    expect(fmtAgo('2026-10-25T09:48:00Z', now)).toBe('12 phút trước');
    expect(fmtAgo('2026-10-25T07:00:00Z', now)).toBe('3 giờ trước');
    expect(fmtAgo('2026-10-22T10:00:00Z', now)).toBe('3 ngày trước');
    expect(fmtVnTime('2026-10-25T07:26:03Z')).toBe('25/10 14:26');
  });
  it('slug tiếng Việt', () => { expect(slugify('Webinar RE11 — Đợt 2')).toBe('webinar-re11-dot-2'); });
});

describe('parseFilters', () => {
  it('mặc định 7 ngày kết thúc ở ngày dữ liệu mới nhất, nguồn both', () => {
    expect(parseFilters({}, '2026-10-24')).toEqual({ from: '2026-10-18', to: '2026-10-24', src: 'both', preset: '7' });
  });
  it('preset 14 / 30 / all', () => {
    expect(parseFilters({ d: '14' }, '2026-10-24')).toMatchObject({ from: '2026-10-11', preset: '14' });
    expect(parseFilters({ d: '30' }, '2026-10-24')).toMatchObject({ from: '2026-09-25', preset: '30' });
    expect(parseFilters({ d: 'all' }, '2026-10-24')).toMatchObject({ from: null, to: null, preset: 'all' });
  });
  it('khoảng tùy chọn thắng preset; sai định dạng / đảo ngược bị bỏ qua', () => {
    expect(parseFilters({ from: '2026-10-01', to: '2026-10-10', d: '30' }, '2026-10-24')).toMatchObject({ from: '2026-10-01', to: '2026-10-10', preset: 'custom' });
    expect(parseFilters({ from: '2026-10-10', to: '2026-10-01' }, '2026-10-24').preset).toBe('7');
    expect(parseFilters({ from: "2026-10-01'; drop", to: '2026-10-10' }, '2026-10-24').preset).toBe('7');
  });
  it('src không hợp lệ → both', () => {
    expect(parseFilters({ src: 'crm' }, null).src).toBe('crm');
    expect(parseFilters({ src: 'hack' }, null).src).toBe('both');
  });
  it('chưa có dữ liệu → from/to null', () => { expect(parseFilters({}, null)).toMatchObject({ from: null, to: null }); });
});

describe('filterQuery', () => {
  const f = parseFilters({ d: '14', src: 'meta' }, '2026-10-24');
  it('giữ bộ lọc khi chuyển trang', () => { expect(filterQuery(f)).toBe('?src=meta&d=14'); });
  it('đổi preset / nguồn; mặc định thì không in ra', () => {
    expect(filterQuery(f, { d: '7', src: 'both' })).toBe('');
    expect(filterQuery(f, { src: 'crm' })).toBe('?src=crm&d=14');
    expect(filterQuery(f, { from: '2026-10-01', to: '2026-10-05' })).toBe('?src=meta&from=2026-10-01&to=2026-10-05');
  });
});
