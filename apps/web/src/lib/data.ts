import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildProjectReport, type ProjectReport, type Row } from '@cohort/core';
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

const META_COLS = 'date,ad_id,campaign_id,campaign_name,adset_id,adset_name,ad_name,creative_concept,concept_key,creative_format,funnel_stage,spend,impressions,link_clicks,leads_meta,purchases_meta,landing_page_views,provisional';

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
  return fetchAll((a, b) => {
    let q = db.from('meta_ads_daily').select(META_COLS);
    if (f.from) q = q.gte('date', f.from);
    if (f.to) q = q.lte('date', f.to);
    return q.order('date').order('ad_id').range(a, b);
  });
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
}

export function resolveProject(ws: Workspace, slug: string): ProjectView | null {
  if (slug === ALL_SLUG) return { slug, name: 'Toàn tài khoản', id: null, startDate: null, endDate: null, campaignIds: null };
  const p = ws.projects.find((x) => x.slug === slug);
  if (!p) return null;
  return {
    slug: p.slug, name: p.name, id: p.id, startDate: p.start_date, endDate: p.end_date,
    campaignIds: ws.projectCampaigns.filter((c) => c.project_id === p.id).map((c) => String(c.campaign_id)),
  };
}

export interface LoadedReport { project: ProjectView; report: ProjectReport; entities: Row[]; signals: Row[]; signalsAsOf: string | null }

export async function loadReport(db: SupabaseClient, ws: Workspace, slug: string, f: Filters): Promise<LoadedReport | null> {
  const project = resolveProject(ws, slug);
  if (!project) return null;
  const [metaRows, entities, crm, sig, assets] = await Promise.all([
    loadMeta(db, f), loadEntities(db),
    project.id ? loadCrm(db, project.id) : Promise.resolve({ submissions: [] as Row[], deals: [] as Row[] }),
    loadSignals(db), loadAssets(db),
  ]);
  const report = buildProjectReport({
    metaRows, campaignIds: project.campaignIds, range: { from: f.from, to: f.to }, entities, ...crm, stageOverrides: stageOverridesFrom(assets.rows),
  });
  const camps = project.campaignIds ? new Set(project.campaignIds) : null;
  const signals = sig.rows.filter((s) => !camps || camps.has(String(s.numbers?.campaign_id ?? (s.level === 'campaign' ? s.entity_id : ''))));
  return { project, report, entities, signals, signalsAsOf: sig.asOf };
}
