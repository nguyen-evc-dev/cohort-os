/** npm run sync:snapshots → tính lại bản chụp báo cáo cho Bé Sugar (dùng sau khi import HubSpot, để bot thấy số CRM mới). */
import { loadEnv } from '../env';
import { refreshSnapshots } from '../snapshots-job';
import { SupabaseStore, isMissingSchema } from '../store';

loadEnv();
try {
  const res = await refreshSnapshots(SupabaseStore.fromEnv(), new Date().toISOString());
  console.log(res.rows ? `Đã làm mới ${res.rows} bản chụp báo cáo (số Meta tới ${res.asOf}).` : 'Chưa có số Meta nên chưa có gì để chụp.');
} catch (e) {
  console.error(isMissingSchema(e) ? 'DB chưa có bảng bot_snapshots. Chạy: npx supabase db push --linked' : `LỖI: ${(e as Error).message}`);
  process.exit(1);
}
