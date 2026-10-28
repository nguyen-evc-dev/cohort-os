/** npm run sync:signals → tính lại đèn RYG + bản chụp cho Bé Sugar theo số Meta mới nhất trong DB (dùng sau khi upload report trên Web). */
import { loadEnv } from '../env';
import { loadConfig } from '../pipeline';
import { recomputeSignals } from '../signals-job';
import { refreshSnapshots } from '../snapshots-job';
import { SupabaseStore } from '../store';

loadEnv();
const store = SupabaseStore.fromEnv();
const nowIso = new Date().toISOString();
const rows = await store.select('meta_ads_daily');
const latest = rows.reduce((m, r) => (String(r.date) > m ? String(r.date) : m), '');
if (!latest) { console.log('Chưa có số Meta nên chưa tính được gì.'); process.exit(0); }
const signals = await recomputeSignals(store, latest, await loadConfig(store), nowIso);
const snaps = await refreshSnapshots(store, nowIso);
console.log(`Đã tính ${signals.length} tín hiệu cho ngày ${latest} và làm mới ${snaps.rows} bản chụp cho Bé Sugar.`);
