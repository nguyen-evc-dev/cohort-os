/** Định dạng số theo Design Proposal mục 2.5. Không có dữ liệu → "—" (không hiện 0). */
export const DASH = '—';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** ≥ $100: không thập phân, có phân cách nghìn. < $100: 2 thập phân. */
export function fmtMoney(v: number | null | undefined): string {
  if (!isNum(v)) return DASH;
  const abs = Math.abs(v);
  const s = abs >= 100
    ? Math.round(abs).toLocaleString('en-US')
    : abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : ''}$${s}`;
}
export const fmtRoas = (v: number | null | undefined) => (isNum(v) ? `${v.toFixed(2)}x` : DASH);
export const fmtInt = (v: number | null | undefined) => (isNum(v) ? Math.round(v).toLocaleString('en-US') : DASH);
/** Tỉ lệ 0–1 → "1.17%". */
export const fmtRate = (v: number | null | undefined) => (isNum(v) ? `${(v * 100).toFixed(2)}%` : DASH);
/** Đã là phần trăm (vd 56.2) → "56.2%". */
export const fmtPct = (v: number | null | undefined) => (isNum(v) ? `${v.toFixed(1)}%` : DASH);
/** Chênh lệch Meta vs CRM: ▲ khi Meta báo nhiều hơn. Nhận tỉ lệ (0.56 = 56%). */
export function fmtDelta(v: number | null | undefined): string {
  if (!isNum(v)) return DASH;
  if (v === 0) return '0%';
  return `${v > 0 ? '▲' : '▼'} ${Math.abs(Math.round(v * 100))}%`;
}

/** 'YYYY-MM-DD' → '24/10'. */
export function fmtDay(d: string | null | undefined): string {
  const m = String(d || '').match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : DASH;
}
export function fmtRange(from: string | null, to: string | null): string {
  if (!from && !to) return 'Toàn bộ thời gian';
  return `${fmtDay(from)} → ${fmtDay(to)}`;
}

/** Thời gian trôi qua: "12 phút trước", "3 giờ trước", "2 ngày trước". */
export function fmtAgo(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return DASH;
  const min = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'vừa xong';
  if (min < 60) return `${min} phút trước`;
  if (min < 48 * 60) return `${Math.round(min / 60)} giờ trước`;
  return `${Math.round(min / 1440)} ngày trước`;
}

/** Giờ VN dạng "15/10 14:26". */
export function fmtVnTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))) p[x.type] = x.value;
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
