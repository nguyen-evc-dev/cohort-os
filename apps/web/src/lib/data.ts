import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildProjectReport, readGoal, type ProjectGoal, type ProjectReport, type Row } from '@cohort/core';
import type { Filters } from './filters';

const PAGE = 1000;

/** Đọc hết mọi trang (Supabase giới hạn 1000 dòng/lần). `build` phải có ORDER ổn định. */
export async function fetchAll(build: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

const META_COLS = 'date,ad_id,campaign_id,campaign_name,adset_id,adset_name,ad_name,creative_concept,concept_key,creative_format,funnel_stage,spend,impressions,link_clicks,leads_meta,purchases_meta,landing_page_views,thruplay,provisional';
/** Cột thêm theo migration (mới nhất trước). DB chưa có cột → thử bộ cột cũ hơn. */
const META_COLS_TIERS = [
  `${META_COLS},video_3s,outbound_clicks,video_p25,video_p50,video_p75,video_p100`, // video_retention
  `${META_COLS},video_3s,outbound_clicks`, // conversion_goals
  META_COLS,
];

export interface Workspace {
  projects: Row[];
  projectCampaigns: Row[];
  campaigns: Row[];       // meta_entities level=campaign
  latestDate: string | null;
  syncRuns: Row[];
  imports: Row[];
}

export async function loadWorkspace(db: SupabaseClient): Promise<Workspace> {
  const [projects, projectCampaigns, campaigns, latest, syncRuns, imports] = await Promise.all([
    fetchAll((a, b) => db.from('projects').select('*').order('created_at').range(a, b)),
    fetchAll((a, b) => db.from('project_campaigns').select('*').order('campaign_id').range(a, b)),
    fetchAll((a, b) => db.from('meta_entities').select('id,name,objective,effective_status,is_sac,daily_budget,lifetime_budget,last_seen_at').eq('level', 'campaign').order('id').range(a, b)),
    db.from('meta_ads_daily').select('date').order('date', { ascending: false }).limit(1),
    db.from('sync_runs').select('*').order('started_at', { ascending: false }).limit(30),
    db.from('crm_imports').select('*').order('imported_at', { ascending: false }).limit(10),
  ]);
  return {
    projects, projectCampaigns, campaigns,
    latestDate: (latest.data?.[0]?.date as string | undefined) ?? null,
    syncRuns: syncRuns.data || [], imports: imports.data || [],
  };
}

export async function loadMeta(db: SupabaseClient, f: Pick<Filters, 'from' | 'to'>): Promise<Row[]> {
  const run = (cols: string) => fetchAll((a, b) => {
    let q = db.from('meta_ads_daily').select(cols);
    if (f.from) q = q.gte('date', f.from);
    if (f.to) q = q.lte('date', f.to);
    return q.order('date').order('ad_id').range(a, b);
  });
  for (const cols of META_COLS_TIERS.slice(0, -1)) { try { return await run(cols); } catch { /* thử bộ cột cũ hơn */ } }
  return run(META_COLS);
}

/** Chuyển đổi theo ad × ngày × loại (custom conversion…). Chưa có bảng (chưa đẩy migration) → rỗng. */
export async function loadActions(db: SupabaseClient, f: Pick<Filters, 'from' | 'to'>, actionTypes: string[]): Promise<Row[]> {
  const types = actionTypes.filter((t) => !t.startsWith('col.'));
  if (!types.length) return [];
  try {
    return await fetchAll((a, b) => {
      let q = db.from('meta_actions_daily').select('date,ad_id,campaign_id,action_type,count').in('action_type', types);
      if (f.from) q = q.gte('date', f.from);
      if (f.to) q = q.lte('date', f.to);
      return q.order('date').order('ad_id').order('action_type').range(a, b);
    });
  } catch { return []; }
}

/** Danh mục custom conversion (để chọn khi khai báo mục tiêu). Chưa có bảng → rỗng. */
export async function loadCustomConversions(db: SupabaseClient): Promise<Row[]> {
  try { return await fetchAll((a, b) => db.from('meta_custom_conversions').select('*').order('is_archived').order('last_fired_at', { ascending: false, nullsFirst: false }).range(a, b)); }
  catch { return []; }
}

export async function loadEntities(db: SupabaseClient): Promise<Row[]> {
  return fetchAll((a, b) => db.from('meta_entities').select('level,id,name,campaign_id,adset_id,effective_status,is_sac,daily_budget,frequency_7d,learning_status').order('level').order('id').range(a, b));
}

export async function loadCrm(db: SupabaseClient, projectId?: string): Promise<{ submissions: Row[]; deals: Row[] }> {
  const subs = fetchAll((a, b) => {
    let q = db.from('crm_submissions').select('conversion_id,project_id,contact_id,converted_on,ad_id,adset_id,campaign_id,placement,source_hint');
    if (projectId) q = q.eq('project_id', projectId);
    return q.order('conversion_id').range(a, b);
  });
  const deals = fetchAll((a, b) => {
    // Deal KHÔNG lọc theo project: được ghép với lead qua contact_id (1 contact có thể có lead ở nhiều project)
    return db.from('crm_deals').select('deal_id,project_id,contact_ids,deal_type,deal_stage,is_won,amount').order('deal_id').range(a, b);
  });
  const [submissions, d] = await Promise.all([subs, deals]);
  return { submissions, deals: d };
}

export async function loadSignals(db: SupabaseClient): Promise<{ asOf: string | null; rows: Row[] }> {
  const { data } = await db.from('signals').select('as_of').order('as_of', { ascending: false }).limit(1);
  const asOf = (data?.[0]?.as_of as string | undefined) ?? null;
  if (!asOf) return { asOf: null, rows: [] };
  const rows = await fetchAll((a, b) => db.from('signals').select('*').eq('as_of', asOf).order('entity_id').order('type').range(a, b));
  return { asOf, rows };
}

/**
 * creative_assets (kèm cột stage). Nếu migration creative_stage chưa được đẩy lên DB thì cột stage chưa có:
 * đọc lại không có stage để trang vẫn chạy (stage thủ công sẽ chưa có tác dụng).
 */
export async function loadAssets(db: SupabaseClient): Promise<{ rows: Row[]; stageReady: boolean }> {
  const sel = (cols: string) => fetchAll((a, b) => db.from('creative_assets').select(cols).order('id').range(a, b));
  try { return { rows: await sel('id,scope,concept_key,ad_id,drive_file_id,post_url,stage'), stageReady: true }; }
  catch { return { rows: await sel('id,scope,concept_key,ad_id,drive_file_id,post_url'), stageReady: false }; }
}

export function stageOverridesFrom(assets: Row[]): { byConcept: Record<string, string>; byAd: Record<string, string> } {
  const byConcept: Record<string, string> = {}; const byAd: Record<string, string> = {};
  for (const a of assets) {
    if (!a.stage) continue;
    if (a.scope === 'concept' && a.concept_key) byConcept[a.concept_key] = a.stage;
    if (a.scope === 'ad' && a.ad_id) byAd[String(a.ad_id)] = a.stage;
  }
  return { byConcept, byAd };
}

/** Project "all" = toàn tài khoản (mọi campaign, chưa cần gán). */
export const ALL_SLUG = 'all';

export interface ProjectView {
  slug: string; name: string; id: string | null; startDate: string | null; endDate: string | null;
  campaignIds: string[] | null;
  /** Mục tiêu đã khai báo (null = chưa khai báo, dùng mặc định) */
  goal: ProjectGoal | null;
}

export function resolveProject(ws: Workspace, slug: string): ProjectView | null {
  if (slug === ALL_SLUG) return { slug, name: 'Toàn tài khoản', id: null, startDate: null, endDate: null, campaignIds: null, goal: null };
  const p = ws.projects.find((x) => x.slug === slug);
  if (!p) return null;
  return {
    slug: p.slug, name: p.name, id: p.id, startDate: p.start_date, endDate: p.end_date,
    campaignIds: ws.projectCampaigns.filter((c) => c.project_id === p.id).map((c) => String(c.campaign_id)),
    goal: readGoal(p.goal),
  };
}

export interface LoadedReport { project: ProjectView; report: ProjectReport; entities: Row[]; signals: Row[]; signalsAsOf: string | null }

export async function loadReport(db: SupabaseClient, ws: Workspace, slug: string, f: Filters): Promise<LoadedReport | null> {
  const project = resolveProject(ws, slug);
  if (!project) return null;
  const actionTypes = (project.goal?.steps ?? []).filter((s) => s.source === 'meta' && s.action_type).map((s) => s.action_type!);
  const [metaRows, entities, crm, sig, assets, actions] = await Promise.all([
    loadMeta(db, f), loadEntities(db),
    project.id ? loadCrm(db, project.id) : Promise.resolve({ submissions: [] as Row[], deals: [] as Row[] }),
    loadSignals(db), loadAssets(db), loadActions(db, f, actionTypes),
  ]);
  const report = buildProjectReport({
    metaRows, campaignIds: project.campaignIds, range: { from: f.from, to: f.to }, entities, ...crm, actions, goal: project.goal, stageOverrides: stageOverridesFrom(assets.rows),
  });
  const camps = project.campaignIds ? new Set(project.campaignIds) : null;
  const signals = sig.rows.filter((s) => !camps || camps.has(String(s.numbers?.campaign_id ?? (s.level === 'campaign' ? s.entity_id : ''))));
  return { project, report, entities, signals, signalsAsOf: sig.asOf };
}
