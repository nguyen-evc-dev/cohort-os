/**
 * Làm mới bản chụp báo cáo cho Bé Sugar (bot_snapshots): tính bằng đúng code báo cáo của Web (core), chỉ lưu payload tổng hợp
 * đã quét PII. Chạy sau mỗi lần sync:push và bằng tay (`npm run sync:snapshots`, vd sau khi import HubSpot).
 */
import { buildBotSnapshots, type Row } from '@cohort/core';
import { isMissingSchema, type Store } from './store';

export async function refreshSnapshots(store: Store, nowIso: string): Promise<{ rows: number; asOf: string | null }> {
  const metaRows = await store.select('meta_ads_daily');
  const latest = metaRows.reduce((m, r) => (String(r.date) > m ? String(r.date) : m), '');
  if (!latest) return { rows: 0, asOf: null };
  const optional = async (table: string, opts?: Parameters<Store['select']>[1]): Promise<Row[]> => {
    try { return await store.select(table, opts); } catch (e) { if (isMissingSchema(e)) return []; throw e; }
  };
  const [projects, projectCampaigns, entities, actions, submissions, deals, signalRows, assets] = await Promise.all([
    store.select('projects'), store.select('project_campaigns'), store.select('meta_entities'),
    optional('meta_actions_daily'), store.select('crm_submissions'), store.select('crm_deals'),
    store.select('signals', { gte: ['as_of', latest] }), optional('creative_assets'),
  ]);
  const signalsAsOf = signalRows.reduce<string | null>((m, r) => (m === null || String(r.as_of) > m ? String(r.as_of) : m), null);
  const snapshots = buildBotSnapshots({
    projects, projectCampaigns, metaRows, entities: entities.map((e) => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v === null ? '' : v]))),
    actions, submissions, deals, signals: signalRows.filter((s) => String(s.as_of) === signalsAsOf), signalsAsOf, assets,
  });
  const rows = snapshots.map((s) => ({ slug: s.slug, range_key: s.range_key, project_id: s.project_id, as_of: s.as_of, built_at: nowIso, data_version: s.data_version, payload: s.payload }));
  await store.replaceSnapshots(rows);
  return { rows: rows.length, asOf: latest };
}
