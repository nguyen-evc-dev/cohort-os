/** Tính lại toàn bộ tín hiệu (đèn RYG) cho ngày as_of từ dữ liệu trong DB. */
import {
  addDays, buildCampaignContexts, computeSignals, hoursBetween, num, signalColor, type Config, type Row,
} from '@cohort/core';
import type { Store } from './store';

const nullsToEmpty = (r: Row): Row => {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) out[k] = v === null ? '' : v;
  return out;
};

/**
 * Seat CRM theo ad × ngày đăng ký. Lead = lượt có tracking sớm nhất của contact trong project
 * (cùng quy tắc với view crm_leads); seat = số deal seat đã thắng có contact đó.
 */
export function seatsByAdDate(submissions: Row[], deals: Row[]): Row[] {
  const won = new Map<string, number>();
  for (const d of deals) {
    if (d.deal_type !== 'seat' || !d.is_won) continue;
    for (const c of d.contact_ids || []) won.set(String(c), (won.get(String(c)) || 0) + 1);
  }
  const first = new Map<string, Row>();
  const sorted = submissions
    .filter((s) => s.contact_id && s.source_hint === 'tracked' && s.ad_id)
    .sort((a, b) => String(a.converted_on).localeCompare(String(b.converted_on)) || String(a.conversion_id).localeCompare(String(b.conversion_id)));
  for (const s of sorted) {
    const k = `${s.project_id}||${s.contact_id}`;
    if (!first.has(k)) first.set(k, s);
  }
  const out: Row[] = [];
  for (const s of first.values()) {
    const seats = won.get(String(s.contact_id)) || 0;
    if (seats) out.push({ ad_id: String(s.ad_id), date: String(s.converted_on), seats });
  }
  return out;
}

export async function recomputeSignals(store: Store, asOf: string, config: Config, nowIso: string): Promise<Row[]> {
  const metaRows = (await store.select('meta_ads_daily', { gte: ['date', addDays(asOf, -60)] }))
    .filter((r) => String(r.date) <= asOf);
  const entities = (await store.select('meta_entities')).map(nullsToEmpty);
  const projectByCampaign = new Map((await store.select('project_campaigns')).map((p) => [String(p.campaign_id), p.project_id]));
  const [subs, deals, imports] = await Promise.all([
    store.select('crm_submissions'), store.select('crm_deals'), store.select('crm_imports'),
  ]);
  const lastImport = imports.map((i) => String(i.imported_at)).sort().pop();
  const crmFresh = !!lastImport && hoursBetween(lastImport, nowIso) <= num(config.global.crm_stale_hours);

  const contexts = buildCampaignContexts({
    metaRows, entities, crmRows: seatsByAdDate(subs, deals), asOf, config, nowIso, crmFresh,
  });
  const rows = new Map<string, Row>();
  for (const ctx of contexts) {
    for (const s of computeSignals(ctx, config, nowIso)) {
      const key = `${s.level}||${s.entityId}||${s.type}`;
      if (rows.has(key)) continue;
      rows.set(key, {
        as_of: asOf,
        project_id: projectByCampaign.get(ctx.campaign.id) ?? null,
        level: s.level,
        entity_id: s.entityId,
        type: s.type,
        color: signalColor(s, config).color,
        action: s.action,
        numbers: { ...s.numbers, campaign_id: ctx.campaign.id, campaign_name: ctx.campaign.name, entity_name: s.entityName,
          concept: s.concept ?? null, format: s.format ?? null, stage: s.stage },
        compared_to: s.comparedTo,
      });
    }
  }
  const out = [...rows.values()];
  await store.replaceSignals(asOf, out);
  return out;
}
