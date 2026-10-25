/**
 * npm run sync:gate → in đúng 1 dòng:
 *   RUN <ngày PT cần sync>
 *   SKIP day_not_closed|already_synced <ngày>
 *   ERROR <lý do>   (thoát mã 1; agent phải dừng, không gọi Meta)
 */
import { syncGate, syncWindow } from '@cohort/core';
import { loadEnv } from '../env';
import { SupabaseStore } from '../store';

loadEnv();
try {
  const tz = process.env.REPORT_TZ || 'America/Los_Angeles';
  const win = syncWindow(new Date(), tz, Number(process.env.SYNC_LAG_MINUTES || 5));
  const last = await SupabaseStore.fromEnv().lastMetaSyncedDate();
  const g = syncGate(win, last);
  console.log(g.decision === 'RUN' ? `RUN ${g.targetDate}` : `SKIP ${g.reason} ${g.targetDate}`);
  console.error(`(giờ PT: ${win.ptNow} · lần sync thành công gần nhất: ${last ?? 'chưa có'})`);
} catch (e) {
  console.log(`ERROR ${(e as Error).message}`);
  process.exit(1);
}
