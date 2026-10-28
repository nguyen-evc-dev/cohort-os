/**
 * npm run sync:push -- <thư mục inbox>
 * Thoát mã 0 khi ok; 2 khi bị từ chối (số không khớp); 1 khi lỗi.
 */
import path from 'node:path';
import fs from 'node:fs';
import { syncWindow } from '@cohort/core';
import { INBOX_ROOT, loadEnv } from '../env';
import { readInbox } from '../inbox';
import { pushBatch } from '../pipeline';
import { SupabaseStore } from '../store';
import { cleanupInbox } from '../cleanup';

loadEnv();
const arg = process.argv.slice(2).find((a) => a !== '--');
if (!arg) { console.error('Cách dùng: npm run sync:push -- sync/inbox/<thư mục>'); process.exit(1); }
const dir = path.resolve(process.env.INIT_CWD || process.cwd(), arg);
if (!fs.existsSync(dir)) { console.error(`Không thấy thư mục ${dir}`); process.exit(1); }

const tz = process.env.REPORT_TZ || 'America/Los_Angeles';
const batch = readInbox(dir);
const res = await pushBatch(SupabaseStore.fromEnv(), batch, { accountId: process.env.META_AD_ACCOUNT_ID, tz });

console.log(`STATUS ${res.status.toUpperCase()} · ngày ${batch.meta.date_from} → ${res.targetDate} · run ${res.runId}`);
console.log(`Spend tài khoản theo ngày: ${Object.entries(res.spendByDate).map(([d, v]) => `${d} $${v}`).join(' · ')}`);
if (res.status === 'ok') {
  console.log(`Đã ghi: ${res.rows.ads_daily} dòng ad×ngày · ${res.rows.entities} entity · ${res.rows.creatives} creative · ${res.rows.budget_events} lần đổi budget · ${res.rows.signals} tín hiệu · ${res.rows.actions} dòng chuyển đổi · ${res.rows.custom_conversions} custom conversion · ${res.rows.snapshots} bản chụp cho Bé Sugar`);
  for (const w of res.warnings) console.log(`⚠ ${w}`);
  const removed = cleanupInbox(INBOX_ROOT, syncWindow(new Date(), tz).targetDate);
  if (removed.length) console.log(`Đã xóa inbox cũ: ${removed.join(', ')}`);
} else if (res.status === 'rejected') {
  console.log('BỊ TỪ CHỐI — DB không đổi. Lỗi:');
  for (const p of res.problems.slice(0, 20)) console.log(`  - ${JSON.stringify(p)}`);
} else {
  console.log(`LỖI: ${res.note}`);
}
process.exit(res.status === 'ok' ? 0 : res.status === 'rejected' ? 2 : 1);
