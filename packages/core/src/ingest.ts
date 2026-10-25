/**
 * Nạp dữ liệu Meta do agent Claude chép từ connector (chỉ đọc).
 * Agent chỉ CHÉP số; kiểm tra + chuẩn hóa nằm ở đây:
 *   - validateImport: tổng spend các ad theo ngày phải khớp số tổng tài khoản (±1%, tối thiểu $0.05)
 *   - importAdRowToDaily / importEntitiesToRows: chuẩn hóa về meta_ads_daily / meta_entities
 */
import { parseAdName, resolveStage } from './parse';
import { resolveBudgetChangedAt } from './meta';
import { num, type Row } from './util';

/** 1 dòng ad (agent ghi) → 1 dòng meta_ads_daily. */
export function importAdRowToDaily(r: Row, accountId: string, nowIso: string, configStageByCampaign?: Record<string, string>): Row {
  const parsed = parseAdName(r.ad_name);
  const stageCfg = configStageByCampaign ? configStageByCampaign[r.campaign_id] : null;
  return {
    date: String(r.date),
    account_id: String(accountId || ''),
    campaign_id: String(r.campaign_id),
    campaign_name: r.campaign_name,
    objective: r.objective || '',
    adset_id: String(r.adset_id),
    adset_name: r.adset_name,
    ad_id: String(r.ad_id),
    ad_name: r.ad_name,
    funnel_stage: resolveStage(r.ad_name, r.adset_name, r.campaign_name, stageCfg) || '',
    creative_format: parsed.format || '',
    creative_concept: parsed.concept,
    spend: num(r.spend),
    impressions: num(r.impressions),
    reach: num(r.reach),
    frequency: num(r.frequency),
    link_clicks: num(r.link_clicks),
    link_ctr: num(r.link_ctr),
    cpm: num(r.cpm),
    landing_page_views: num(r.landing_page_views),
    leads_meta: num(r.leads),
    purchases_meta: num(r.purchases),
    video_3s: 0,
    thruplay: num(r.thruplay),
    updated_at: nowIso,
  };
}

export interface ImportProblem { date: string; reason?: string; ads_spend?: number; account_spend?: number; diff_ratio?: number | null }

/** Đối chiếu tổng spend theo ngày giữa dòng ad và số tổng tài khoản. */
export function validateImport(adRows: Row[], checkRows: Row[], tolerance: number): { ok: boolean; problems: ImportProblem[] } {
  const byDate: Record<string, number> = {};
  for (const r of adRows) {
    if (!r.ad_id) continue;
    byDate[r.date] = (byDate[r.date] || 0) + num(r.spend);
  }
  const problems: ImportProblem[] = [];
  if (!checkRows.length) problems.push({ date: '*', reason: 'missing_account_totals' });
  for (const c of checkRows) {
    const acc = num(c.account_spend);
    const ads = Math.round((byDate[c.date] || 0) * 100) / 100;
    const diff = Math.abs(ads - acc);
    // Sai số làm tròn của Meta: cho phép tối thiểu $0.05 dù tỉ lệ nhỏ.
    if (diff > Math.max(0.05, acc * tolerance)) {
      problems.push({ date: c.date, ads_spend: ads, account_spend: acc, diff_ratio: acc ? Math.round((diff / acc) * 1000) / 1000 : null });
    }
  }
  for (const d of Object.keys(byDate)) {
    if (!checkRows.some((c) => String(c.date) === d)) problems.push({ date: d, reason: 'no_account_total_for_date' });
  }
  return { ok: problems.length === 0, problems };
}

/** Offset (ms) của múi giờ tz tại thời điểm utcMs: local = utc + offset. */
export function tzOffsetMs(utcMs: number, tz: string): number {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return local - utcMs;
}

/** "10/20/2026 at 8:50 AM" (giờ tài khoản quảng cáo) → ISO UTC; tự xử lý PDT/PST. */
export function parseActivityDatetime(raw: string | null | undefined, tz: string): string {
  const m = String(raw || '').replace(/ | /g, ' ')
    .match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return '';
  const h = (Number(m[4]) % 12) + (m[6].toUpperCase() === 'PM' ? 12 : 0);
  const asUtc = Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5]));
  return new Date(asUtc - tzOffsetMs(asUtc, tz)).toISOString();
}

/** Activity log (connector) → { objectId: ISO lần đổi budget mới nhất }. */
export function latestBudgetFromImport(activityRows: Row[] | null | undefined, tz: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of activityRows || []) {
    if (!/budget/i.test(a.event_type || '')) continue;
    const iso = parseActivityDatetime(a.datetime_raw, tz);
    const id = String(a.object_id || '');
    if (id && iso && (!out[id] || iso > out[id])) out[id] = iso;
  }
  return out;
}

/** Entity agent ghi (budget đã là đơn vị tiền chính từ connector) → dòng meta_entities. */
export function importEntitiesToRows(
  entities: Row[], accountId: string, prevByKey: Record<string, Row> = {},
  activityByObject: Record<string, string> = {}, nowIso: string = new Date().toISOString(),
): Row[] {
  const opt = (v: unknown) => (v === '' || v === undefined || v === null ? '' : num(v));
  return entities.map((e) => {
    const prev = prevByKey[`${e.level}||${e.id}`];
    const isBudgetLevel = e.level === 'campaign' || e.level === 'adset';
    const row: Row = {
      level: e.level, id: String(e.id), name: e.name, account_id: String(accountId || ''),
      campaign_id: String(e.level === 'campaign' ? e.id : e.campaign_id || ''),
      adset_id: String(e.level === 'adset' ? e.id : e.adset_id || ''),
      objective: e.objective || '',
      effective_status: e.effective_status || '',
      daily_budget: isBudgetLevel && num(e.daily_budget) > 0 ? num(e.daily_budget) : '',
      lifetime_budget: isBudgetLevel && num(e.lifetime_budget) > 0 ? num(e.lifetime_budget) : '',
      learning_status: e.learning_status || '',
      reach_7d: opt(e.reach_7d),
      impressions_7d: opt(e.impressions_7d),
      frequency_7d: opt(e.frequency_7d),
      last_sig_edit_at: num(e.last_sig_edit_ts) > 0 ? new Date(num(e.last_sig_edit_ts) * 1000).toISOString() : '',
      first_seen_at: prev && prev.first_seen_at ? prev.first_seen_at : nowIso,
      last_seen_at: nowIso,
    };
    row.budget_changed_at = isBudgetLevel ? resolveBudgetChangedAt(prev, row, nowIso, activityByObject[e.id]) : '';
    return row;
  });
}
