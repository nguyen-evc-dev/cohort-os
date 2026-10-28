/**
 * npm run import:meta -- <file.xlsx|csv> [--project <slug>]
 * Nạp báo cáo Meta xuất từ Ads Manager (breakdown theo Day, có Campaign ID / Ad set ID / Ad ID) vào Supabase.
 * Thoát mã 0 khi ok; 2 khi file bị từ chối (nói rõ cách sửa); 1 khi lỗi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readTable } from '@cohort/core';
import { loadEnv } from '../env';
import { importReportTable } from '../report-import';
import { SupabaseStore } from '../store';

loadEnv();
const args = process.argv.slice(2).filter((a) => a !== '--');
const pi = args.indexOf('--project');
const projectSlug = pi >= 0 ? args[pi + 1] : undefined;
const file = args.find((a, i) => !a.startsWith('--') && i !== pi + 1);
if (!file) { console.error('Cách dùng: npm run import:meta -- <file.xlsx|csv> [--project <slug>]'); process.exit(1); }
const full = path.resolve(process.env.INIT_CWD || process.cwd(), file);
if (!fs.existsSync(full)) { console.error(`Không thấy file ${full}`); process.exit(1); }

let table: string[][];
try { table = readTable(new Uint8Array(fs.readFileSync(full)), full); } catch (e) { console.error(`LỖI: ${(e as Error).message}`); process.exit(1); }

const res = await importReportTable(SupabaseStore.fromEnv(), table, { accountId: process.env.META_AD_ACCOUNT_ID, projectSlug, fileName: path.basename(full), tz: process.env.REPORT_TZ || 'America/Los_Angeles' });
console.log(`STATUS ${res.status.toUpperCase()} · ${res.dateFrom ?? '—'} → ${res.dateTo ?? '—'} · chi tiêu $${res.spend} · ${res.campaigns} campaign`);
if (res.status === 'ok') {
  console.log(`Đã ghi: ${res.rows} dòng ad×ngày · ${res.actions} chuyển đổi custom · ${res.entities} entity mới · ${res.assigned} campaign gán vào Project · ${res.signals} tín hiệu · ${res.snapshots} bản chụp cho Bé Sugar`);
  for (const w of res.warnings) console.log(`⚠ ${w}`);
} else {
  console.log(res.status === 'rejected' ? 'BỊ TỪ CHỐI, DB không đổi. Cách sửa:' : 'LỖI:');
  for (const p of res.problems) console.log(`  - ${p}`);
}
process.exit(res.status === 'ok' ? 0 : res.status === 'rejected' ? 2 : 1);
