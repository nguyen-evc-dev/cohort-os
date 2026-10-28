'use server';
import { revalidatePath } from 'next/cache';
import {
  addDays, adRowsToDaily, missingEntityRows, OPTIONAL_DAILY_COLS, parseMetaReport, syncWindow,
  type MetaReportResult,
} from '@cohort/core';
import { requireAdmin } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/data';
import { refreshBotSnapshots } from '@/lib/snapshots';

const UUID_RE = /^[0-9a-f-]{36}$/;
const ID_RE = /^\d{6,25}$/;
const CHUNK = 500;
const isMissingSchema = (m: string) => /does not exist|schema cache|Could not find the .* (column|table)/i.test(m);

export interface CampaignPreview { id: string; name: string; spend: number; adRows: number; owner: 'none' | 'this' | 'other'; ownerName: string | null }
export interface MetaPreview {
  ok: boolean; problems: string[]; warnings: string[];
  dateFrom: string | null; dateTo: string | null; days: number; adRows: number;
  totals: MetaReportResult['totals']; fileTotals: MetaReportResult['fileTotals'];
  customUsed: MetaReportResult['customUsed']; customUnknown: string[];
  campaigns: CampaignPreview[];
  overlap: { existingRows: number; newRows: number; existingSpend: number; uploadSpend: number };
  suggestedProjectId: string | null;
}
export type PreviewResult = { ok: true; preview: MetaPreview } | { ok: false; error: string };
export type ImportMetaResult =
  | { ok: true; slug: string; projectName: string; rows: number; actions: number; campaignsAdded: number; dateFrom: string; dateTo: string; warnings: string[] }
  | { ok: false; error: string };

/** Bảng thô từ trình duyệt: kiểm tra hình dạng và kích thước, không tin client. */
function cleanTable(raw: unknown): string[][] | string {
  if (!Array.isArray(raw) || raw.length < 2) return 'File trống hoặc không đọc được.';
  if (raw.length > 20_000) return 'File quá lớn (hơn 20.000 dòng). Xuất khoảng ngày ngắn hơn.';
  const out: string[][] = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length > 200) return 'File có cấu trúc bất thường.';
    out.push(r.map((c) => String(c ?? '').slice(0, 500)));
  }
  return out;
}

async function context(projectId: string | null, table: string[][]) {
  const { supabase } = await requireAdmin();
  const [catalog, latest, projects, owners] = await Promise.all([
    fetchAll((a, b) => supabase.from('meta_custom_conversions').select('id,name').order('id').range(a, b)).catch(() => []),
    supabase.from('meta_ads_daily').select('account_id').order('date', { ascending: false }).limit(1),
    supabase.from('projects').select('id,name,slug'),
    supabase.from('project_campaigns').select('campaign_id,project_id'),
  ]);
  const todayPt = addDays(syncWindow(new Date()).targetDate, 1);
  const report = parseMetaReport(table, { customConversions: catalog.map((c) => ({ id: String(c.id), name: String(c.name) })), todayPt });
  const names = new Map((projects.data ?? []).map((p) => [String(p.id), String(p.name)]));
  const owner = new Map((owners.data ?? []).map((o) => [String(o.campaign_id), String(o.project_id)]));
  void projectId;
  return { supabase, report, todayPt, accountId: (latest.data?.[0]?.account_id as string | undefined) ?? null, names, owner, projects: projects.data ?? [] };
}

/** Xem trước: đọc + kiểm tra file, đối chiếu với dữ liệu đang có. KHÔNG ghi gì. */
export async function previewMetaReport(rawTable: unknown, projectId: string | null): Promise<PreviewResult> {
  const table = cleanTable(rawTable);
  if (typeof table === 'string') return { ok: false, error: table };
  const { supabase, report, names, owner } = await context(projectId, table);

  let existingRows = 0, existingSpend = 0, uploadSpend = 0;
  if (report.ok && report.dateFrom && report.dateTo) {
    const have = await fetchAll((a, b) => supabase.from('meta_ads_daily').select('date,ad_id,spend').gte('date', report.dateFrom!).lte('date', report.dateTo!).order('date').order('ad_id').range(a, b));
    const idx = new Map(have.map((r) => [`${r.date}|${r.ad_id}`, Number(r.spend)]));
    for (const r of report.rows) {
      const prev = idx.get(`${r.date}|${r.ad_id}`);
      if (prev === undefined) continue;
      existingRows += 1; existingSpend += prev; uploadSpend += r.spend;
    }
  }
  const campaigns: CampaignPreview[] = report.campaigns.map((c) => {
    const o = owner.get(c.id);
    return { ...c, owner: !o ? 'none' : o === projectId ? 'this' : 'other', ownerName: o ? names.get(o) ?? null : null };
  });
  // Gợi ý Project: nơi đang chứa nhiều chi tiêu nhất của các campaign trong file
  const bySpend = new Map<string, number>();
  for (const c of report.campaigns) { const o = owner.get(c.id); if (o) bySpend.set(o, (bySpend.get(o) ?? 0) + c.spend); }
  const suggested = [...bySpend.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    ok: true,
    preview: {
      ok: report.ok, problems: report.problems, warnings: report.warnings, dateFrom: report.dateFrom, dateTo: report.dateTo, days: report.days,
      adRows: report.rows.length, totals: report.totals, fileTotals: report.fileTotals, customUsed: report.customUsed, customUnknown: report.customUnknown,
      campaigns, suggestedProjectId: suggested,
      overlap: { existingRows, newRows: report.rows.length - existingRows, existingSpend: Math.round(existingSpend * 100) / 100, uploadSpend: Math.round(uploadSpend * 100) / 100 },
    },
  };
}

/** Ghi số từ file vào DB bằng phiên admin (RLS), gán campaign vào Project, làm mới bản chụp cho Bé Sugar. */
export async function importMetaReport(input: { project_id: string; table: unknown; assign: string[]; file_name: string }): Promise<ImportMetaResult> {
  if (!UUID_RE.test(String(input.project_id))) return { ok: false, error: 'Project không hợp lệ.' };
  const table = cleanTable(input.table);
  if (typeof table === 'string') return { ok: false, error: table };
  const { supabase, report, accountId, owner, projects } = await context(input.project_id, table);
  const project = projects.find((p) => p.id === input.project_id);
  if (!project) return { ok: false, error: 'Không tìm thấy Project.' };
  if (!report.ok) return { ok: false, error: `File chưa hợp lệ: ${report.problems[0]}` };
  if (!accountId) return { ok: false, error: 'Chưa có dữ liệu Meta nào trong DB để biết ID tài khoản quảng cáo. Chạy sync một lần trước.' };

  const nowIso = new Date().toISOString();
  const ptToday = addDays(syncWindow(new Date()).targetDate, 1);
  const daily = adRowsToDaily(report.rows as never[], accountId, nowIso, ptToday);
  const warnings: string[] = [];

  // 1) Số theo ngày × ad (ghi đè theo date, ad_id). DB thiếu cột của migration mới → bỏ dần các cột đó
  let drop: string[] = [];
  for (let tier = 0; ; tier++) {
    const rows = drop.length ? daily.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k)))) : daily;
    let failed: string | null = null;
    for (let i = 0; i < rows.length && !failed; i += CHUNK) {
      const { error } = await supabase.from('meta_ads_daily').upsert(rows.slice(i, i + CHUNK), { onConflict: 'date,ad_id' });
      if (error) failed = error.message;
    }
    if (!failed) break;
    if (!isMissingSchema(failed) || tier >= OPTIONAL_DAILY_COLS.length) return { ok: false, error: `Không ghi được số Meta (${failed}). Có thể đã ghi một phần, nhập lại cùng file là an toàn.` };
    drop = [...drop, ...OPTIONAL_DAILY_COLS[tier].cols];
    warnings.push(`DB chưa có migration ${OPTIONAL_DAILY_COLS[tier].migration}: bỏ qua ${OPTIONAL_DAILY_COLS[tier].cols.join(', ')}. Chạy npx supabase db push --linked.`);
  }

  // 2) Chuyển đổi custom: thay theo (campaign, khoảng ngày, loại) vì Meta điều chỉnh số theo thời gian
  if (report.customUsed.length) {
    const types = report.customUsed.map((c) => `offsite_conversion.custom.${c.id}`);
    const campIds = report.campaigns.map((c) => c.id);
    const del = await supabase.from('meta_actions_daily').delete().in('campaign_id', campIds).in('action_type', types).gte('date', report.dateFrom!).lte('date', report.dateTo!);
    if (del.error) {
      warnings.push(isMissingSchema(del.error.message) ? 'DB chưa có bảng meta_actions_daily: bỏ qua số custom conversion. Chạy npx supabase db push --linked.' : `Không cập nhật được chuyển đổi custom (${del.error.message}).`);
    } else {
      for (let i = 0; i < report.actions.length; i += CHUNK) {
        const { error } = await supabase.from('meta_actions_daily').insert(report.actions.slice(i, i + CHUNK));
        if (error) { warnings.push(`Không ghi được chuyển đổi custom (${error.message}).`); break; }
      }
    }
  }

  // 3) Entity còn thiếu (campaign / adset / ad mới): chỉ thêm, không sửa dòng sync đã có
  const have = await fetchAll((a, b) => supabase.from('meta_entities').select('level,id').order('level').order('id').range(a, b));
  const missing = missingEntityRows(report.rows, accountId, new Set(have.map((e) => `${e.level}||${e.id}`)), nowIso);
  for (let i = 0; i < missing.length; i += CHUNK) {
    const { error } = await supabase.from('meta_entities').insert(missing.slice(i, i + CHUNK));
    if (error) { warnings.push(`Không tạo được entity mới (${error.message}).`); break; }
  }

  // 4) Gán campaign vào Project (chỉ campaign trong file, chưa thuộc Project nào)
  const inFile = new Set(report.campaigns.map((c) => c.id));
  const toAssign = [...new Set(input.assign.filter((id) => ID_RE.test(id) && inFile.has(id) && !owner.has(id)))];
  if (toAssign.length) {
    const { error } = await supabase.from('project_campaigns').insert(toAssign.map((campaign_id) => ({ campaign_id, project_id: input.project_id, mapped_by: 'auto' })));
    if (error) return { ok: false, error: `Đã ghi số Meta nhưng không gán được campaign vào Project (${error.message}).` };
  }

  // 5) Ghi nhận lần upload + làm mới bản chụp cho Bé Sugar (đèn RYG cần chạy lại sync để tính)
  await supabase.from('sync_runs').insert({
    kind: 'meta_upload', target_date: report.dateTo, status: 'ok', rows: daily.length, date_from: report.dateFrom, date_to: report.dateTo, finished_at: nowIso,
    note: `Upload ${String(input.file_name).replace(/[^\w .()+-]/g, '').slice(0, 80)}: ${daily.length} dòng, ${report.actions.length} chuyển đổi custom → ${project.name}`.slice(0, 500),
  });
  await refreshBotSnapshots(supabase);
  revalidatePath('/', 'layout');
  return { ok: true, slug: String(project.slug), projectName: String(project.name), rows: daily.length, actions: report.actions.length, campaignsAdded: toAssign.length, dateFrom: report.dateFrom!, dateTo: report.dateTo!, warnings };
}
