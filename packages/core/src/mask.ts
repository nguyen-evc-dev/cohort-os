/** Che mờ và phát hiện dữ liệu cá nhân (PII). Dùng trước khi gửi bất cứ thứ gì ra khỏi máy / vào prompt. */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// SĐT có dấu hiệu định dạng: +E.164, (408) 966-7987, 408-966-7987, 408.966.7987
const PHONE_FORMATTED_RE = /(\+\d{8,15}\b)|(\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b)/;
// 9–11 chữ số trơn: có thể là SĐT — chỉ kiểm tra ở trường KHÔNG phải ID
const PHONE_BARE_RE = /^\+?\d{9,11}$/;
// Trường là ID (ad_id, contact_id, deal_ids, id…) chứa số dài hợp lệ
const ID_KEY_RE = /(^|_)ids?$/i;

/** Giữ min(4, floor(len/2)) ký tự cuối trước @ và giữ domain. "alex.nguyen326@gmail.com" → "*****n326@gmail.com". */
export function maskEmail(email: string | null | undefined): string | null {
  const s = String(email || '').trim().toLowerCase();
  const at = s.lastIndexOf('@');
  if (at <= 0 || at === s.length - 1) return null;
  const local = s.slice(0, at);
  const keep = Math.min(4, Math.floor(local.length / 2));
  return `*****${keep ? local.slice(-keep) : ''}${s.slice(at)}`;
}

export function looksLikeEmail(v: string): boolean {
  return EMAIL_RE.test(v);
}

export function looksLikePhone(v: string): boolean {
  const s = String(v).trim();
  return PHONE_FORMATTED_RE.test(s) || PHONE_BARE_RE.test(s.replace(/[\s.-]/g, ''));
}

export interface PiiHit { path: string; kind: 'email' | 'phone' }

/**
 * Duyệt object/array, trả về các vị trí nghi chứa PII.
 * Email đã che mờ ("*****n326@…") không tính. Trường ID không bị kiểm tra SĐT (ID Meta/HubSpot là số dài).
 */
export function findPii(value: unknown, path = '$'): PiiHit[] {
  const hits: PiiHit[] = [];
  const walk = (v: unknown, p: string, key: string) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`, key)); return; }
    if (typeof v === 'object') { for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${p}.${k}`, k); return; }
    const s = String(v);
    if (looksLikeEmail(s) && !/^\*{3,}/.test(s.trim())) hits.push({ path: p, kind: 'email' });
    else if (!ID_KEY_RE.test(key) && typeof v === 'string' && looksLikePhone(s)) hits.push({ path: p, kind: 'phone' });
  };
  walk(value, path, '');
  return hits;
}

/** Ném lỗi nếu có PII — dùng ở mọi điểm dữ liệu rời khỏi máy hoặc đi vào prompt Claude. */
export function assertNoPii(value: unknown, context = 'payload'): void {
  const hits = findPii(value);
  if (hits.length) {
    throw new Error(`${context}: phát hiện ${hits.length} giá trị nghi là dữ liệu cá nhân (${hits.slice(0, 3).map((h) => `${h.kind}@${h.path}`).join(', ')}). Đã chặn.`);
  }
}
