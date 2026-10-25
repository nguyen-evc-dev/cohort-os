/** npm run sync:verify → in tóm tắt dữ liệu Meta đã sync (chỉ đọc) để đối chiếu với Ads Manager. */
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from '../env';

loadEnv();
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

const runs = (await db.from('sync_runs').select('kind,target_date,status,rows,date_from,date_to,note,started_at,finished_at').order('started_at', { ascending: false }).limit(5)).data || [];
console.log('sync_runs gần nhất:'); for (const r of runs) console.log(' ', JSON.stringify(r));

const daily = (await db.from('meta_ads_daily').select('date,spend,ad_id,campaign_id,provisional').order('date')).data || [];
const byDate: Record<string, { spend: number; ads: number; prov: boolean }> = {};
for (const r of daily) { const d = (byDate[r.date] ||= { spend: 0, ads: 0, prov: false }); d.spend += Number(r.spend); d.ads += 1; d.prov ||= r.provisional; }
console.log('Spend theo ngày (tổng các ad):');
for (const [d, v] of Object.entries(byDate)) console.log(`  ${d}  $${v.spend.toFixed(2)}  ${v.ads} ad${v.prov ? '  (tạm tính)' : ''}`);

const count = async (t: string) => (await db.from(t).select('*', { count: 'exact', head: true })).count;
console.log('Số dòng:', JSON.stringify({ meta_entities: await count('meta_entities'), meta_creatives: await count('meta_creatives'), meta_budget_events: await count('meta_budget_events'), signals: await count('signals') }));

const sig = (await db.from('signals').select('as_of,level,type,color,action,numbers')).data || [];
console.log('Tín hiệu:'); for (const s of sig) console.log(`  ${s.color.padEnd(6)} ${s.type.padEnd(12)} ${s.level} ${s.numbers.entity_name} (${s.numbers.campaign_name})`);
const sac = (await db.from('meta_entities').select('name,is_sac').eq('level', 'campaign').eq('is_sac', true)).data || [];
console.log('Campaign SAC:', sac.map((c) => c.name).join(' | '));
