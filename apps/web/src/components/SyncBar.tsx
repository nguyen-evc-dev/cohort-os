import { defaultConfig } from '@cohort/core';
import type { Row } from '@cohort/core';
import { fmtAgo, fmtDay } from '@/lib/format';

export interface SyncState { tone: 'ok' | 'warn' | 'bad' | 'neutral'; meta: string; crm: string; headline?: string }

/** Trạng thái đồng bộ (Design Proposal 3): xám = bình thường · amber = cũ · đỏ = lỗi. Hàm thuần để test. */
export function syncState(syncRuns: Row[], imports: Row[], nowMs = Date.now()): SyncState {
  const cfg = defaultConfig().global;
  const metaRuns = syncRuns.filter((r) => r.kind === 'meta' || r.kind === 'meta_backfill');
  const lastOk = metaRuns.find((r) => r.status === 'ok');
  const lastAny = metaRuns[0];
  const lastImport = imports[0];
  const crm = lastImport ? `HubSpot: import ${fmtAgo(lastImport.imported_at, nowMs)}` : 'HubSpot: chưa import';

  if (!lastOk) {
    return { tone: lastAny && lastAny.status !== 'running' ? 'bad' : 'warn', meta: 'Meta: chưa có lần sync thành công', crm };
  }
  const ageH = (nowMs - new Date(lastOk.finished_at || lastOk.started_at).getTime()) / 3_600_000;
  const meta = `Meta ✓ ${fmtDay(lastOk.target_date)} · ${fmtAgo(lastOk.finished_at, nowMs)}`;
  if (lastAny && lastAny.id !== lastOk.id && (lastAny.status === 'rejected' || lastAny.status === 'error')
    && new Date(lastAny.started_at) > new Date(lastOk.started_at)) {
    return { tone: 'bad', meta, crm, headline: `Sync Meta ${fmtDay(lastAny.target_date)} ${lastAny.status === 'rejected' ? 'bị từ chối (số lệch)' : 'lỗi'}` };
  }
  if (ageH > Number(cfg.meta_stale_hours)) return { tone: 'warn', meta, crm, headline: `Số Meta đã cũ (${Math.round(ageH)} giờ)` };
  return { tone: 'ok', meta, crm };
}

export function SyncBar({ syncRuns, imports }: { syncRuns: Row[]; imports: Row[] }) {
  const s = syncState(syncRuns, imports);
  return (
    <div className={`syncbar ${s.tone === 'neutral' ? '' : s.tone}`} role="status">
      <span className="dot" />
      {s.headline && <b>{s.headline}</b>}
      <span>{s.meta}</span>
      <span className="hide-sm">· {s.crm}</span>
    </div>
  );
}
