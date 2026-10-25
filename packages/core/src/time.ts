/** Giờ sync và allowlist domain audit. */
import { addDays } from './util';

export interface SyncWindow {
  /** Ngày PT cần sync = ngày PT vừa kết thúc gần nhất. */
  targetDate: string;
  /** Giờ PT hiện tại, 'YYYY-MM-DD HH:mm'. */
  ptNow: string;
  minutesSincePtMidnight: number;
  /** Đã qua đủ `lagMinutes` sau nửa đêm PT → số của targetDate đã chốt. */
  ready: boolean;
}

/**
 * Cửa sổ sync. Lịch chạy 14:05 và 15:05 giờ VN; gate trả RUN khi `ready` và targetDate chưa sync.
 *   PDT: 14:05 VN = 00:05 PT → target = hôm qua PT, chạy. 15:05 → cùng target, đã sync → bỏ qua.
 *   PST: 14:05 VN = 23:05 PT hôm trước → target là ngày đã sync hôm qua → bỏ qua. 15:05 = 00:05 PT → chạy.
 */
export function syncWindow(now: Date | string, tz = 'America/Los_Angeles', lagMinutes = 5): SyncWindow {
  const d = typeof now === 'string' ? new Date(now) : now;
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d)) parts[p.type] = p.value;
  const ptDate = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return {
    targetDate: addDays(ptDate, -1),
    ptNow: `${ptDate} ${parts.hour}:${parts.minute}`,
    minutesSincePtMidnight: minutes,
    ready: minutes >= lagMinutes,
  };
}

export type GateDecision = { decision: 'RUN'; targetDate: string } | { decision: 'SKIP'; reason: 'day_not_closed' | 'already_synced'; targetDate: string };

export function syncGate(win: SyncWindow, lastSyncedDate: string | null | undefined): GateDecision {
  if (!win.ready) return { decision: 'SKIP', reason: 'day_not_closed', targetDate: win.targetDate };
  if (lastSyncedDate && lastSyncedDate >= win.targetDate) return { decision: 'SKIP', reason: 'already_synced', targetDate: win.targetDate };
  return { decision: 'RUN', targetDate: win.targetDate };
}

export const DEFAULT_AUDIT_DOMAINS = ['evancoaching.net', 'evancoaching.com'];

/** Chỉ cho phép http(s) tới domain trong allowlist (kể cả subdomain). */
export function isAuditableUrl(url: string, domains: string[] = DEFAULT_AUDIT_DOMAINS): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  return domains.some((d) => host === d.toLowerCase() || host.endsWith(`.${d.toLowerCase()}`));
}
