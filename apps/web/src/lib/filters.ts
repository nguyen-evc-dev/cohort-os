/**
 * Bộ lọc toàn cục nằm trên URL (chia sẻ / quay lại được):
 *   ?d=7|14|30|all   khoảng ngày kết thúc ở ngày có dữ liệu mới nhất (mặc định 7)
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD   khoảng tùy chọn (thắng ?d)
 *   ?src=meta|crm|both   nguồn số liệu (mặc định both)
 */
import { defaultRange } from '@cohort/core';

export type Src = 'meta' | 'crm' | 'both';
export type Preset = '7' | '14' | '30' | 'all' | 'custom';
export interface Filters { from: string | null; to: string | null; src: Src; preset: Preset }
type SP = Record<string, string | string[] | undefined>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const validDate = (s: string | undefined): s is string => !!s && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function parseFilters(sp: SP, latestDate: string | null): Filters {
  const srcRaw = first(sp.src);
  const src: Src = srcRaw === 'meta' || srcRaw === 'crm' ? srcRaw : 'both';
  const from = first(sp.from);
  const to = first(sp.to);
  if (validDate(from) && validDate(to) && from <= to) return { from, to, src, preset: 'custom' };
  const d = first(sp.d);
  if (d === 'all') return { from: null, to: null, src, preset: 'all' };
  const days = d === '14' ? 14 : d === '30' ? 30 : 7;
  const r = defaultRange(latestDate, days);
  return { from: r?.from ?? null, to: r?.to ?? null, src, preset: String(days) as Preset };
}

/** Giữ các tham số bộ lọc khi chuyển trang. */
export function filterQuery(f: Filters, patch: Partial<{ d: string; src: Src; from: string; to: string }> = {}): string {
  const q = new URLSearchParams();
  const src = patch.src ?? f.src;
  if (src !== 'both') q.set('src', src);
  if (patch.from && patch.to) { q.set('from', patch.from); q.set('to', patch.to); }
  else if (patch.d) { if (patch.d !== '7') q.set('d', patch.d); }
  else if (f.preset === 'custom' && f.from && f.to) { q.set('from', f.from); q.set('to', f.to); }
  else if (f.preset !== '7') q.set('d', f.preset);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const showMeta = (f: Filters) => f.src !== 'crm';
export const showCrm = (f: Filters) => f.src !== 'meta';
