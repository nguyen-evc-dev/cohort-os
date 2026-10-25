/** npm run sync:weekly → tổng spend theo tuần (thứ Hai → Chủ nhật, giờ PT) từ meta_ads_daily, để đối chiếu Ads Manager. Chỉ đọc. */
import { createClient } from '@supabase/supabase-js';
import { addDays } from '@cohort/core';
import { loadEnv } from '../env';

loadEnv();
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const rows: { date: string; spend: number }[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('meta_ads_daily').select('date,spend').order('date').order('ad_id').range(from, from + 999);
  if (error) throw new Error(error.message);
  rows.push(...(data || []).map((r) => ({ date: r.date as string, spend: Number(r.spend) })));
  if (!data || data.length < 1000) break;
}
const monday = (d: string) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return addDays(d, -((w + 6) % 7)); };
const weeks = new Map<string, { spend: number; days: Set<string> }>();
for (const r of rows) {
  const k = monday(r.date);
  const w = weeks.get(k) || { spend: 0, days: new Set<string>() };
  w.spend += r.spend; w.days.add(r.date); weeks.set(k, w);
}
let total = 0;
console.log('Tuần (Thứ Hai → Chủ nhật, giờ PT) · Spend · Số ngày có dữ liệu');
for (const [k, w] of [...weeks].sort()) {
  total += w.spend;
  const days = [...w.days].sort();
  console.log(`${k} → ${addDays(k, 6)}  $${w.spend.toFixed(2).padStart(9)}  ${days.length}/7 ngày (${days[0]} … ${days[days.length - 1]})`);
}
console.log(`Tổng ${rows.length} dòng: $${total.toFixed(2)}`);
