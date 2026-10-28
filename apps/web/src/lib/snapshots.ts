import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildBotSnapshots, goalActionTypes, readGoal } from '@cohort/core';
import { loadActions, loadAssets, loadCrm, loadEntities, loadMeta, loadSignals } from './data';

/**
 * Làm mới bản chụp báo cáo cho Bé Sugar (bot_snapshots) bằng phiên admin. Gọi sau khi import HubSpot để bot thấy số CRM mới ngay,
 * không đợi lần sync hằng ngày. Chỉ ghi payload tổng hợp đã quét PII. Trả false nếu thất bại (không làm hỏng việc import).
 */
export async function refreshBotSnapshots(db: SupabaseClient): Promise<boolean> {
  try {
    const none = { from: null, to: null };
    const [projects, projectCampaigns, metaRows] = await Promise.all([
      db.from('projects').select('id,slug,name,status,goal'), db.from('project_campaigns').select('project_id,campaign_id'), loadMeta(db, none),
    ]);
    if (projects.error || projectCampaigns.error || !metaRows.length) return false;
    const actionTypes = goalActionTypes((projects.data ?? []).map((p) => readGoal(p.goal)));
    const [entities, crm, sig, assets, actions] = await Promise.all([
      loadEntities(db), loadCrm(db), loadSignals(db), loadAssets(db), loadActions(db, none, actionTypes),
    ]);
    const snaps = buildBotSnapshots({
      projects: projects.data ?? [], projectCampaigns: projectCampaigns.data ?? [], metaRows, entities, actions, ...crm,
      signals: sig.rows, signalsAsOf: sig.asOf, assets: assets.rows,
    });
    if (!snaps.length) return false;
    const builtAt = new Date().toISOString();
    const { error } = await db.from('bot_snapshots').upsert(
      snaps.map((s) => ({ slug: s.slug, range_key: s.range_key, project_id: s.project_id, as_of: s.as_of, built_at: builtAt, data_version: s.data_version, payload: s.payload })),
      { onConflict: 'slug,range_key' },
    );
    return !error;
  } catch (e) {
    console.error('refreshBotSnapshots:', (e as Error).message);
    return false;
  }
}
