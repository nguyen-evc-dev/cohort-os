/**
 * import:meta — nạp báo cáo Meta xuất tay (.xlsx / .csv từ Ads Manager) vào Supabase bằng service role trên máy Nguyên.
 * Cùng bộ đọc / kiểm tra với trang Upload của Web (core/parseMetaReport). Đường rẻ nhất cho việc nạp số hằng ngày:
 * không cần connector Meta, không tốn token. Chỉ đọc file, không chạm vào Meta.
 */
import {
  addDays, adRowsToDaily, customConversionAction, missingEntityRows, OPTIONAL_DAILY_COLS, parseMetaReport, syncWindow,
  type Row,
} from '@cohort/core';
import { loadConfig } from './pipeline';
import { recomputeSignals } from './signals-job';
import { refreshSnapshots } from './snapshots-job';
import { isMissingSchema, type Store } from './store';

export interface ReportImportOptions { now?: Date; accountId?: string; projectSlug?: string; fileName?: string; tz?: string }
export interface ReportImportResult {
  status: 'ok' | 'rejected' | 'error';
  problems: string[];
  warnings: string[];
  rows: number; actions: number; campaigns: number; assigned: number; entities: number; signals: number; snapshots: number;
  dateFrom: string | null; dateTo: string | null; spend: number;
  note?: string;
}

export async function importReportTable(store: Store, table: string[][], opts: ReportImportOptions = {}): Promise<ReportImportResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const tz = opts.tz ?? 'America/Los_Angeles';
  const ptToday = addDays(syncWindow(now, tz).targetDate, 1);
  const res: ReportImportResult = { status: 'ok', problems: [], warnings: [], rows: 0, actions: 0, campaigns: 0, assigned: 0, entities: 0, signals: 0, snapshots: 0, dateFrom: null, dateTo: null, spend: 0 };

  let catalog: Row[] = [];
  try { catalog = await store.select('meta_custom_conversions'); } catch (e) { if (!isMissingSchema(e)) throw e; }
  const report = parseMetaReport(table, { customConversions: catalog.map((c) => ({ id: String(c.id), name: String(c.name) })), todayPt: ptToday });
  Object.assign(res, { dateFrom: report.dateFrom, dateTo: report.dateTo, spend: report.totals.spend, campaigns: report.campaigns.length });
  res.warnings.push(...report.warnings);
  if (!report.ok) return { ...res, status: 'rejected', problems: report.problems };

  let runId: string | null = null;
  try {
    // Tài khoản quảng cáo: lấy từ cấu hình / số đã có, không đoán
    let accountId = opts.accountId || '';
    if (!accountId) {
      const known = (await store.select('meta_ads_daily', { gte: ['date', addDays(report.dateFrom!, -400)] })).find((r) => r.account_id);
      accountId = known ? String(known.account_id) : '';
    }
    if (!accountId) return { ...res, status: 'error', problems: ['Chưa biết ID tài khoản quảng cáo (đặt META_AD_ACCOUNT_ID trong .env.local).'] };

    let projectId: string | null = null;
    if (opts.projectSlug) {
      const p = (await store.select('projects')).find((x) => x.slug === opts.projectSlug);
      if (!p) return { ...res, status: 'error', problems: [`Không có Project "${opts.projectSlug}".`] };
      projectId = String(p.id);
    }

    try { runId = await store.startRun('meta_upload', report.dateTo!); }
    catch (e) { if (!/violates check constraint/i.test(String((e as Error).message))) throw e; res.warnings.push('DB chưa có migration meta_upload: không ghi nhận lần upload trong sync_runs. Chạy npx supabase db push --linked.'); }

    const daily = adRowsToDaily(report.rows as never[], accountId, nowIso, ptToday);
    let drop: string[] = [];
    for (let tier = 0; ; tier++) {
      try { await store.upsert('meta_ads_daily', drop.length ? daily.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k)))) : daily, 'date,ad_id'); break; }
      catch (e) {
        if (!isMissingSchema(e) || tier >= OPTIONAL_DAILY_COLS.length) throw e;
        drop = [...drop, ...OPTIONAL_DAILY_COLS[tier].cols];
        res.warnings.push(`DB chưa có migration ${OPTIONAL_DAILY_COLS[tier].migration}: bỏ qua ${OPTIONAL_DAILY_COLS[tier].cols.join(', ')}. Chạy npx supabase db push --linked.`);
      }
    }
    res.rows = daily.length;

    if (report.customUsed.length) {
      try {
        await store.replaceActionsScoped({
          campaignIds: report.campaigns.map((c) => c.id), actionTypes: report.customUsed.map((c) => customConversionAction(c.id)), from: report.dateFrom!, to: report.dateTo!,
        }, report.actions as unknown as Row[]);
        res.actions = report.actions.length;
      } catch (e) {
        if (!isMissingSchema(e)) throw e;
        res.warnings.push('DB chưa có bảng meta_actions_daily: bỏ qua số custom conversion. Chạy npx supabase db push --linked.');
      }
    }

    const existing = new Set((await store.select('meta_entities')).map((e) => `${e.level}||${e.id}`));
    const missing = missingEntityRows(report.rows, accountId, existing, nowIso);
    if (missing.length) await store.upsert('meta_entities', missing, 'level,id');
    res.entities = missing.length;

    if (projectId) {
      const owned = new Set((await store.select('project_campaigns')).map((c) => String(c.campaign_id)));
      const add = report.campaigns.filter((c) => !owned.has(c.id)).map((c) => ({ campaign_id: c.id, project_id: projectId, mapped_by: 'auto' }));
      if (add.length) await store.upsert('project_campaigns', add, 'campaign_id');
      res.assigned = add.length;
    }

    // Tín hiệu RYG + bản chụp cho Bé Sugar tính theo ngày có số mới nhất trong DB
    const all = await store.select('meta_ads_daily', { gte: ['date', addDays(report.dateTo!, -3)] });
    const latest = all.reduce((m, r) => (String(r.date) > m ? String(r.date) : m), report.dateTo!);
    res.signals = (await recomputeSignals(store, latest, await loadConfig(store), nowIso)).length;
    try { res.snapshots = (await refreshSnapshots(store, nowIso)).rows; }
    catch (e) { res.warnings.push(isMissingSchema(e) ? 'DB chưa có bảng bot_snapshots: Bé Sugar chưa đọc được báo cáo. Chạy npx supabase db push --linked.' : `Không làm mới được bản chụp cho Bé Sugar: ${String((e as Error).message).slice(0, 200)}`); }

    if (runId) {
      await store.finishRun(runId, {
        status: 'ok', rows: res.rows, date_from: report.dateFrom!, date_to: report.dateTo!,
        note: `Upload ${String(opts.fileName ?? 'file').replace(/[^\w .()+-]/g, '').slice(0, 80)}: ${res.rows} dòng, ${res.actions} chuyển đổi custom${res.warnings.length ? ` · ⚠ ${res.warnings.join(' | ')}` : ''}`.slice(0, 900),
      });
    }
    return res;
  } catch (e) {
    const note = String((e as Error).message || e).slice(0, 900);
    if (runId) await store.finishRun(runId, { status: 'error', note }).catch(() => {});
    return { ...res, status: 'error', problems: [note], note };
  }
}
