/** Tiện ích thuần: ngày giờ, số, gộp dòng. Không phụ thuộc môi trường chạy. */

export type Row = Record<string, any>;

/** 'yyyy-MM-dd' + n ngày. */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Danh sách ngày từ `from` đến `to` (bao gồm 2 đầu). */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Chuẩn hóa thời gian Meta ("2026-10-19T08:12:33+0000") về ISO UTC. */
export function toIsoUtc(s: string | null | undefined): string {
  if (!s) return '';
  const fixed = String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(fixed);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export function hoursBetween(isoA: string, isoB: string): number {
  return (new Date(isoB).getTime() - new Date(isoA).getTime()) / 3_600_000;
}

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function median(values: number[]): number | null {
  const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Gộp `incoming` vào `existing` theo khóa: dòng trùng khóa bị thay, dòng mới thêm cuối. */
export function mergeRowsByKey<T extends Row>(existing: T[], incoming: T[], keyFields: string[]): T[] {
  const keyOf = (r: T) => keyFields.map((k) => String(r[k])).join('||');
  const index = new Map<string, number>();
  const out = existing.slice();
  out.forEach((r, i) => index.set(keyOf(r), i));
  for (const r of incoming) {
    const k = keyOf(r);
    const i = index.get(k);
    if (i === undefined) { index.set(k, out.length); out.push(r); } else out[i] = r;
  }
  return out;
}

export const round2 = (v: number | null | undefined): number | null =>
  v === null || v === undefined ? null : Math.round(v * 100) / 100;

/** Tỉ lệ → phần trăm, 1 chữ số thập phân. */
export const pct = (v: number | null | undefined): number | null =>
  v === null || v === undefined ? null : Math.round(v * 1000) / 10;
