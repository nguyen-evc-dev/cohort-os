/**
 * sync:push — inbox → kiểm tra → chuẩn hóa → upsert → tín hiệu → sync_runs.
 * Mọi kiểm tra chạy TRƯỚC khi ghi: dữ liệu bị từ chối thì DB không đổi (chỉ thêm 1 dòng sync_runs).
 */
import {
  addDays, dateRange, importAdRowToDaily, importEntitiesToRows, isSacCampaign, latestBudgetFromImport,
  mergeWithDefaultConfig, parseActivityDatetime, parseAdName, parseConfigRows, round2, syncWindow, validateImport,
  type Config, type Row,
} from '@cohort/core';
import type { Batch } from './inbox';
import { isMissingSchema, type Store } from './store';
import { recomputeSignals } from './signals-job';

export interface PushOptions { now?: Date; accountId?: string; tz?: string }
export interface PushResult {
  status: 'ok' | 'rejected' | 'error';
  runId: string;
  targetDate: string;
  problems: unknown[];
  rows: { ads_daily: number; entities: number; creatives: number; budget_events: number; signals: number; actions: number; custom_conversions: number };
  warnings: string[];
  spendByDate: Record<string, number>;
  note?: string;
}

const INT_COLS = ['impressions', 'reach', 'link_clicks', 'landing_page_views', 'leads_meta', 'purchases_meta', 'thruplay'];
/** Cột thêm theo từng migration — DB chưa có thì bỏ dần từ mới nhất (sync không chết vì quên db push). */
const OPTIONAL_COLS: { migration: string; cols: string[] }[] = [
  { migration: 'video_retention', cols: ['video_p25', 'video_p50', 'video_p75', 'video_p100'] },
  { migration: 'conversion_goals', cols: ['video_3s', 'outbound_clicks'] },
];
const blankToNull = (v: unknown) => (v === '' || v === undefined ? null : v);

/** Các kiểm tra chặn ghi. Trả danh sách lỗi (rỗng = hợp lệ). */
export function checkBatch(batch: Batch, config: Config, accountId?: string): unknown[] {
  const problems: unknown[] = [...batch.problems];
  const { meta } = batch;
  if (accountId && meta.account_id && meta.account_id !== accountId) {
    problems.push({ reason: 'wrong_account', expected: accountId, got: meta.account_id });
  }
  if (!batch.adRows.length) problems.push({ reason: 'no_ad_rows' });
  const seen = new Set<string>();
  for (const r of batch.adRows) {
    const k = `${r.date}||${r.ad_id}`;
    if (seen.has(k)) problems.push({ reason: 'duplicate_ad_row', date: r.date, ad_id: r.ad_id });
    seen.add(k);
    if (meta.date_from && (r.date < meta.date_from || r.date > meta.date_to)) {
      problems.push({ reason: 'date_out_of_range', date: r.date, ad_id: r.ad_id });
    }
  }
  if (meta.date_from && meta.date_to && meta.date_from <= meta.date_to) {
    const have = new Set(batch.checkRows.map((c) => c.date));
    for (const d of dateRange(meta.date_from, meta.date_to)) {
      if (!have.has(d)) problems.push({ reason: 'missing_account_total', date: d });
    }
  }
  const v = validateImport(batch.adRows, batch.checkRows, Number(config.global.import_spend_tolerance));
  problems.push(...v.problems);
  return problems;
}

export function toDailyRows(batch: Batch, accountId: string, nowIso: string, ptToday: string): Row[] {
  return batch.adRows.map((r) => {
    const d = importAdRowToDaily(r, accountId, nowIso);
    d.video_3s = Math.round(Number(r.video_3s) || 0);
    d.outbound_clicks = Math.round(Number(r.outbound_clicks) || 0);
    for (const c of OPTIONAL_COLS[0].cols) d[c] = Math.round(Number(r[c]) || 0);
    for (const c of INT_COLS) d[c] = Math.round(Number(d[c]) || 0);
    const parsed = parseAdName(r.ad_name);
    return {
      ...d,
      funnel_stage: d.funnel_stage || null,
      creative_format: d.creative_format || null,
      concept_key: parsed.conceptKey,
      provisional: d.date >= ptToday,
    };
  });
}

export function toEntityRows(batch: Batch, accountId: string, prev: Row[], tz: string, nowIso: string): Row[] {
  const prevByKey: Record<string, Row> = {};
  for (const p of prev) prevByKey[`${p.level}||${p.id}`] = p;
  const activityByObject = latestBudgetFromImport(batch.activity, tz);
  return importEntitiesToRows(batch.entities, accountId, prevByKey, activityByObject, nowIso).map((e) => ({
    level: e.level, id: e.id, name: e.name, account_id: accountId,
    campaign_id: blankToNull(e.campaign_id), adset_id: e.adset_id || '',
    objective: e.objective, effective_status: e.effective_status,
    is_sac: e.level === 'campaign' ? isSacCampaign(e.name) : false,
    daily_budget: blankToNull(e.daily_budget), lifetime_budget: blankToNull(e.lifetime_budget),
    learning_status: e.learning_status || null,
    reach_7d: blankToNull(e.reach_7d) === null ? null : Math.round(Number(e.reach_7d)),
    impressions_7d: blankToNull(e.impressions_7d) === null ? null : Math.round(Number(e.impressions_7d)),
    frequency_7d: blankToNull(e.frequency_7d),
    budget_changed_at: blankToNull(e.budget_changed_at), last_sig_edit_at: blankToNull(e.last_sig_edit_at),
    first_seen_at: e.first_seen_at, last_seen_at: e.last_seen_at,
    ...(e.level === 'adset' && batch.targetingByAdset[e.id] ? { targeting_summary: batch.targetingByAdset[e.id] } : {}),
  }));
}

export function toBudgetEvents(batch: Batch, tz: string): Row[] {
  const out = new Map<string, Row>();
  for (const a of batch.activity) {
    const event_time = parseActivityDatetime(a.datetime_raw, tz);
    if (!event_time) continue;
    const row = { object_id: a.object_id, event_time, event_type: a.event_type, old_value: a.old_value, new_value: a.new_value };
    out.set(`${row.object_id}||${row.event_time}||${row.event_type}`, row);
  }
  return [...out.values()];
}

/** Cảnh báo (không chặn): tổng chuyển đổi theo ad lệch tổng tài khoản > max(1, 5%). */
export function checkActionTotals(batch: Batch): string[] {
  const out: string[] = [];
  const sum: Record<string, Record<string, number>> = {};
  for (const a of batch.actionRows) { const d = (sum[a.date] ||= {}); d[a.action_type] = (d[a.action_type] || 0) + Number(a.count); }
  for (const [date, acc] of Object.entries(batch.checkActions)) {
    for (const [type, total] of Object.entries(acc)) {
      if (type === 'video_view') continue;
      const got = sum[date]?.[type] || 0;
      if (Math.abs(got - total) > Math.max(1, total * 0.05)) out.push(`${date} ${type}: ads ${got} vs tài khoản ${total}`);
    }
  }
  return out.slice(0, 10);
}

export async function loadConfig(store: Store): Promise<Config> {
  const rows = await store.select('app_config');
  return mergeWithDefaultConfig(parseConfigRows(rows as any));
}

export async function pushBatch(store: Store, batch: Batch, opts: PushOptions = {}): Promise<PushResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const tz = opts.tz ?? 'America/Los_Angeles';
  const targetDate = batch.meta.date_to || 'unknown';
  const accountId = opts.accountId || batch.meta.account_id;
  const ptToday = addDays(syncWindow(now, tz).targetDate, 1);
  const spendByDate: Record<string, number> = {};
  for (const c of batch.checkRows) spendByDate[c.date] = round2(c.account_spend) as number;
  const rows = { ads_daily: 0, entities: 0, creatives: 0, budget_events: 0, signals: 0, actions: 0, custom_conversions: 0 };
  const warnings: string[] = [];

  const runId = await store.startRun(batch.meta.mode === 'backfill' ? 'meta_backfill' : 'meta', targetDate);
  try {
    const config = await loadConfig(store);
    const problems = checkBatch(batch, config, opts.accountId);
    if (problems.length) {
      await store.finishRun(runId, { status: 'rejected', rows: 0, problems: problems.slice(0, 50),
        date_from: batch.meta.date_from || undefined, date_to: batch.meta.date_to || undefined });
      return { status: 'rejected', runId, targetDate, problems, rows, spendByDate, warnings };
    }

    const daily = toDailyRows(batch, accountId, nowIso, ptToday);
    const ids = [...new Set(batch.entities.map((e) => String(e.id)))];
    const prev = ids.length ? await store.select('meta_entities', { in: ['id', ids] }) : [];
    const entities = toEntityRows(batch, accountId, prev, tz, nowIso);
    const creatives = batch.creatives.map((c) => ({ ...c, fetched_at: nowIso }));
    const events = toBudgetEvents(batch, tz);

    let missingGoals = false;
    for (let i = 0, drop: string[] = []; ; i++) {
      try { await store.upsert('meta_ads_daily', drop.length ? daily.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k)))) : daily, 'date,ad_id'); break; }
      catch (e) {
        if (!isMissingSchema(e) || i >= OPTIONAL_COLS.length) throw e;
        // DB chưa có cột của migration mới → bỏ các cột đó, ghi phần còn lại
        const m = OPTIONAL_COLS[i];
        drop = [...drop, ...m.cols];
        if (m.migration === 'conversion_goals') missingGoals = true;
        warnings.push(`DB chưa có migration ${m.migration}: bỏ qua ${m.cols.join(', ')}${m.migration === 'conversion_goals' ? ', chuyển đổi custom' : ''}. Chạy npx supabase db push --linked`);
      }
    }
    if (!missingGoals) {
      try {
        await store.replaceActions(batch.meta.date_from, batch.meta.date_to, batch.actionRows);
        rows.actions = batch.actionRows.length;
        if (batch.customConversions.length) { await store.upsert('meta_custom_conversions', batch.customConversions.map((c) => ({ ...c, seen_at: nowIso })), 'id'); rows.custom_conversions = batch.customConversions.length; }
      } catch (e) {
        if (!isMissingSchema(e)) throw e;
        warnings.push('DB chưa có bảng meta_actions_daily: chạy npx supabase db push --linked');
      }
    }
    warnings.push(...checkActionTotals(batch));
    if (entities.length) await store.upsert('meta_entities', entities, 'level,id');
    if (creatives.length) await store.upsert('meta_creatives', creatives, 'ad_id');
    if (events.length) await store.upsert('meta_budget_events', events, 'object_id,event_time,event_type');
    Object.assign(rows, { ads_daily: daily.length, entities: entities.length, creatives: creatives.length, budget_events: events.length });

    // Backfill từng khúc: chỉ tính tín hiệu cho ngày cuối của khúc
    const signals = await recomputeSignals(store, targetDate, config, nowIso);
    rows.signals = signals.length;

    await store.finishRun(runId, { status: 'ok', rows: daily.length, date_from: batch.meta.date_from, date_to: batch.meta.date_to,
      note: `entities=${entities.length} creatives=${creatives.length} budget_events=${events.length} actions=${rows.actions} signals=${signals.length}${warnings.length ? ` · ⚠ ${warnings.join(' | ')}` : ''}`.slice(0, 1000) });
    return { status: 'ok', runId, targetDate, problems: [], rows, spendByDate, warnings };
  } catch (e) {
    const note = String((e as Error).message || e).slice(0, 900);
    await store.finishRun(runId, { status: 'error', note }).catch(() => {});
    return { status: 'error', runId, targetDate, problems: [], rows, spendByDate, warnings, note };
  }
}
