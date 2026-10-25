/**
 * Báo cáo Project: ghép số Meta (meta_ads_daily) với CRM (crm_submissions + crm_deals).
 * Hàm thuần — Web, share snapshot và AI dùng chung một nguồn số.
 *
 * Quy tắc (khớp view bot.v_project_master / bot._leads / bot._lead_outcomes):
 *   • Lead = 1 contact / project: lượt có tracking sớm nhất (tracked), không có thì lượt direct sớm nhất. Bỏ test/invalid.
 *   • Seat = deal seat đã thắng của contact đó; Program tương tự. Doanh thu cộng theo amount.
 *   • Cả lead lẫn seat/revenue đều gắn vào ad_id của lead (first-touch).
 *   • Lead không có ad_id, hoặc ad_id không thuộc campaign của project → hàng "Unattributed".
 * Khoảng ngày: Meta lọc theo `date`, CRM lọc theo ngày đăng ký của lead (`converted_on`).
 */
import { lightFromCpa, type RygColor } from './ryg';
import { round2, type Row } from './util';

export interface DateRange { from?: string | null; to?: string | null }

export interface MetaMetrics {
  spend: number; impressions: number; clicks: number; leads: number; purchases: number; lpv: number;
  ctr: number | null; cpm: number | null; cpl: number | null; cpaMeta: number | null;
}
export interface CrmMetrics {
  leads: number; tracked: number; seats: number; programs: number;
  seatRevenue: number; programRevenue: number; revenue: number;
  cpaSeat: number | null; cashRoas: number | null;
}
export interface Metrics { meta: MetaMetrics; crm: CrmMetrics; deltaPurchases: number | null }

export type NodeLevel = 'campaign' | 'adset' | 'ad';
export interface ReportNode extends Metrics {
  id: string; level: NodeLevel; name: string; parentId: string | null;
  concept?: string; conceptKey?: string; format?: string; stage?: string; isSac?: boolean;
  status?: string; provisional?: boolean;
  children: ReportNode[];
}

export interface DayPoint {
  date: string; spend: number; leadsMeta: number; purchasesMeta: number;
  crmLeads: number; seats: number; provisional: boolean;
}
export interface PlacementRow { placement: string; leads: number; seats: number; programs: number; sharePct: number }
export interface ConceptRow extends Metrics {
  conceptKey: string; concept: string; format: string; stages: string[]; ads: string[];
  light: RygColor; conversions: number; cpaReal: number | null;
}

export interface ProjectReport {
  range: { from: string | null; to: string | null };
  hasCrm: boolean;
  total: Metrics;
  /** Chuyển đổi dùng đo hiệu quả: seat (có CRM) hoặc kết quả Meta (lead + purchase). */
  primary: { kind: 'seat' | 'meta'; label: string; value: number; cost: number | null };
  truthGap: { metaPurchases: number; crmSeats: number; overreportPct: number | null } | null;
  funnel: { leads: number; seats: number; programs: number; leadToSeatPct: number | null; seatToProgramPct: number | null };
  tree: ReportNode[];
  unattributed: Metrics & { leadIds: number };
  daily: DayPoint[];
  placements: PlacementRow[];
  concepts: ConceptRow[];
  trackedPct: number | null;
  provisionalDates: string[];
}

export interface ReportInput {
  metaRows: Row[];
  /** null = mọi campaign (báo cáo toàn tài khoản) */
  campaignIds: string[] | null;
  range?: DateRange;
  entities?: Row[];
  submissions?: Row[];
  deals?: Row[];
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const rnd = (v: number | null, d = 2): number | null => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);
const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

function emptyMeta() { return { spend: 0, impressions: 0, clicks: 0, leads: 0, purchases: 0, lpv: 0 }; }
function emptyCrm() { return { leads: 0, tracked: 0, seats: 0, programs: 0, seatRevenue: 0, programRevenue: 0 }; }
type RawMeta = ReturnType<typeof emptyMeta>;
type RawCrm = ReturnType<typeof emptyCrm>;

function finishMeta(m: RawMeta): MetaMetrics {
  return {
    spend: round2(m.spend) as number, impressions: m.impressions, clicks: m.clicks, leads: m.leads, purchases: m.purchases, lpv: m.lpv,
    ctr: rnd(div(m.clicks, m.impressions), 4), cpm: rnd(m.impressions ? (m.spend / m.impressions) * 1000 : null),
    cpl: rnd(div(m.spend, m.leads)), cpaMeta: rnd(div(m.spend, m.purchases)),
  };
}
function finishCrm(c: RawCrm, spend: number): CrmMetrics {
  const revenue = c.seatRevenue + c.programRevenue;
  return {
    leads: c.leads, tracked: c.tracked, seats: c.seats, programs: c.programs,
    seatRevenue: round2(c.seatRevenue) as number, programRevenue: round2(c.programRevenue) as number, revenue: round2(revenue) as number,
    cpaSeat: rnd(div(spend, c.seats)), cashRoas: rnd(div(revenue, spend)),
  };
}
function finish(m: RawMeta, c: RawCrm): Metrics {
  const meta = finishMeta(m);
  const crm = finishCrm(c, m.spend);
  return { meta, crm, deltaPurchases: c.seats || m.purchases ? rnd(c.seats > 0 ? (m.purchases - c.seats) / c.seats : null, 3) : null };
}
function addMeta(a: RawMeta, r: Row) {
  a.spend += n(r.spend); a.impressions += n(r.impressions); a.clicks += n(r.link_clicks);
  a.leads += n(r.leads_meta); a.purchases += n(r.purchases_meta); a.lpv += n(r.landing_page_views);
}
function addCrm(a: RawCrm, b: RawCrm) { for (const k of Object.keys(a) as (keyof RawCrm)[]) a[k] += b[k]; }

/** Lead first-touch theo contact (khớp bot._leads). */
export function pickLeads(submissions: Row[]): Row[] {
  const rows = (submissions || [])
    .filter((s) => s.contact_id && (s.source_hint === 'tracked' || s.source_hint === 'direct'))
    .sort((a, b) =>
      Number(b.source_hint === 'tracked') - Number(a.source_hint === 'tracked')
      || String(a.converted_on || '').localeCompare(String(b.converted_on || ''))
      || String(a.conversion_id).localeCompare(String(b.conversion_id)));
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const s of rows) {
    const k = `${s.project_id ?? ''}||${s.contact_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

interface LeadOutcome { lead: Row; seats: number; seatRevenue: number; programs: number; programRevenue: number }

/** Mỗi lead + kết quả mua (khớp bot._lead_outcomes: deal nhiều contact tính cho từng contact). */
export function leadOutcomes(leads: Row[], deals: Row[]): LeadOutcome[] {
  const byContact = new Map<string, Row[]>();
  for (const d of deals || []) for (const c of d.contact_ids || []) {
    const k = String(c);
    (byContact.get(k) || byContact.set(k, []).get(k)!).push(d);
  }
  return leads.map((lead) => {
    const o: LeadOutcome = { lead, seats: 0, seatRevenue: 0, programs: 0, programRevenue: 0 };
    for (const d of byContact.get(String(lead.contact_id)) || []) {
      if (!d.is_won) continue;
      if (d.deal_type === 'seat') { o.seats += 1; o.seatRevenue += n(d.amount); }
      else if (d.deal_type === 'program') { o.programs += 1; o.programRevenue += n(d.amount); }
    }
    return o;
  });
}

function inRange(date: string | null | undefined, r: DateRange): boolean {
  if (!date) return !r.from && !r.to;
  if (r.from && date < r.from) return false;
  if (r.to && date > r.to) return false;
  return true;
}

interface AdAcc {
  id: string; name: string; adsetId: string; campaignId: string; concept: string; conceptKey: string; format: string; stage: string; status: string;
  meta: RawMeta; crm: RawCrm; latest: string;
}

export function buildProjectReport(input: ReportInput): ProjectReport {
  const range = input.range || {};
  const campaignSet = input.campaignIds ? new Set(input.campaignIds.map(String)) : null;
  const metaRows = (input.metaRows || []).filter((r) => (!campaignSet || campaignSet.has(String(r.campaign_id))) && inRange(r.date, range));
  const entitiesById = new Map<string, Row>();
  for (const e of input.entities || []) entitiesById.set(`${e.level}||${e.id}`, e);

  const ads = new Map<string, AdAcc>();
  const adsets = new Map<string, { id: string; name: string; campaignId: string }>();
  const campaigns = new Map<string, { id: string; name: string }>();
  const total = emptyMeta();
  const daily = new Map<string, DayPoint>();
  const provisional = new Set<string>();

  for (const r of metaRows) {
    const adId = String(r.ad_id);
    let a = ads.get(adId);
    if (!a) {
      a = { id: adId, name: '', adsetId: '', campaignId: '', concept: '', conceptKey: '', format: '', stage: '', status: '', meta: emptyMeta(), crm: emptyCrm(), latest: '' };
      ads.set(adId, a);
    }
    if (String(r.date) >= a.latest) { // tên / concept / stage lấy theo ngày mới nhất
      Object.assign(a, { latest: String(r.date), name: r.ad_name || '', adsetId: String(r.adset_id), campaignId: String(r.campaign_id),
        concept: r.creative_concept || '', conceptKey: r.concept_key || '', format: r.creative_format || '', stage: r.funnel_stage || '' });
    }
    addMeta(a.meta, r);
    addMeta(total, r);
    adsets.set(String(r.adset_id), { id: String(r.adset_id), name: r.adset_name || adsets.get(String(r.adset_id))?.name || '', campaignId: String(r.campaign_id) });
    campaigns.set(String(r.campaign_id), { id: String(r.campaign_id), name: r.campaign_name || '' });
    const d = daily.get(r.date) || { date: r.date, spend: 0, leadsMeta: 0, purchasesMeta: 0, crmLeads: 0, seats: 0, provisional: false };
    d.spend += n(r.spend); d.leadsMeta += n(r.leads_meta); d.purchasesMeta += n(r.purchases_meta);
    if (r.provisional) { d.provisional = true; provisional.add(String(r.date)); }
    daily.set(r.date, d);
  }
  for (const a of ads.values()) a.status = String(entitiesById.get(`ad||${a.id}`)?.effective_status || '');

  // ---- CRM ----
  const hasCrm = (input.submissions || []).length > 0;
  const leads = pickLeads(input.submissions || []).filter((l) => inRange(l.converted_on, range));
  const outcomes = leadOutcomes(leads, input.deals || []);
  const unattrRaw = emptyCrm();
  const crmTotal = emptyCrm();
  const placements = new Map<string, { leads: number; seats: number; programs: number }>();
  let unattributedLeads = 0;
  for (const o of outcomes) {
    const c: RawCrm = { leads: 1, tracked: o.lead.source_hint === 'tracked' ? 1 : 0, seats: o.seats, programs: o.programs,
      seatRevenue: o.seatRevenue, programRevenue: o.programRevenue };
    addCrm(crmTotal, c);
    const ad = o.lead.ad_id ? ads.get(String(o.lead.ad_id)) : undefined;
    if (ad) addCrm(ad.crm, c); else { addCrm(unattrRaw, c); unattributedLeads += 1; }
    const pl = String(o.lead.placement || '(không rõ)');
    const p = placements.get(pl) || { leads: 0, seats: 0, programs: 0 };
    p.leads += 1; p.seats += o.seats; p.programs += o.programs;
    placements.set(pl, p);
    const day = daily.get(String(o.lead.converted_on)) || { date: String(o.lead.converted_on), spend: 0, leadsMeta: 0, purchasesMeta: 0, crmLeads: 0, seats: 0, provisional: false };
    day.crmLeads += 1; day.seats += o.seats;
    daily.set(day.date, day);
  }

  // ---- Cây Campaign → Adset → Ad ----
  const mkNode = (id: string, level: NodeLevel, name: string, parentId: string | null): ReportNode & { _m: RawMeta; _c: RawCrm } => ({
    id, level, name, parentId, children: [], _m: emptyMeta(), _c: emptyCrm(),
    meta: finishMeta(emptyMeta()), crm: finishCrm(emptyCrm(), 0), deltaPurchases: null,
  });
  const campNodes = new Map<string, ReturnType<typeof mkNode>>();
  const adsetNodes = new Map<string, ReturnType<typeof mkNode>>();
  for (const c of campaigns.values()) {
    const node = mkNode(c.id, 'campaign', c.name, null);
    node.isSac = !!entitiesById.get(`campaign||${c.id}`)?.is_sac;
    node.status = String(entitiesById.get(`campaign||${c.id}`)?.effective_status || '');
    campNodes.set(c.id, node);
  }
  for (const s of adsets.values()) {
    const node = mkNode(s.id, 'adset', s.name, s.campaignId);
    node.status = String(entitiesById.get(`adset||${s.id}`)?.effective_status || '');
    adsetNodes.set(s.id, node);
  }
  for (const a of ads.values()) {
    const node = mkNode(a.id, 'ad', a.name, a.adsetId);
    Object.assign(node, { concept: a.concept, conceptKey: a.conceptKey, format: a.format, stage: a.stage, status: a.status });
    node._m = a.meta; node._c = a.crm;
    const parent = adsetNodes.get(a.adsetId);
    if (parent) parent.children.push(node);
  }
  for (const s of adsetNodes.values()) {
    for (const ch of s.children as (typeof s)[]) { for (const k of Object.keys(s._m) as (keyof RawMeta)[]) s._m[k] += ch._m[k]; addCrm(s._c, ch._c); }
    const parent = campNodes.get(s.parentId!);
    if (parent) parent.children.push(s);
  }
  for (const c of campNodes.values()) {
    for (const ch of c.children as (typeof c)[]) { for (const k of Object.keys(c._m) as (keyof RawMeta)[]) c._m[k] += ch._m[k]; addCrm(c._c, ch._c); }
  }
  const seal = (node: ReturnType<typeof mkNode>): ReportNode => {
    Object.assign(node, finish(node._m, node._c));
    node.children = (node.children as (typeof node)[]).map(seal).sort((x, y) => y.meta.spend - x.meta.spend);
    delete (node as any)._m; delete (node as any)._c;
    return node;
  };
  const tree = [...campNodes.values()].map(seal).sort((x, y) => y.meta.spend - x.meta.spend);

  // ---- Tổng ----
  const totalMetrics = finish(total, crmTotal);
  const metaResults = total.leads + total.purchases;
  const primary: ProjectReport['primary'] = hasCrm
    ? { kind: 'seat', label: 'Seat (CRM)', value: crmTotal.seats, cost: rnd(div(total.spend, crmTotal.seats)) }
    : { kind: 'meta', label: 'Kết quả Meta (lead + purchase)', value: metaResults, cost: rnd(div(total.spend, metaResults)) };

  // ---- Concept (Creative Vault) ----
  const baseline = primary.cost;
  const byConcept = new Map<string, { m: RawMeta; c: RawCrm; ads: string[]; concept: string; format: string; stages: Set<string> }>();
  for (const a of ads.values()) {
    const key = a.conceptKey || 'unparsed';
    const g = byConcept.get(key) || { m: emptyMeta(), c: emptyCrm(), ads: [], concept: a.concept || 'UNPARSED', format: a.format, stages: new Set<string>() };
    for (const k of Object.keys(g.m) as (keyof RawMeta)[]) g.m[k] += a.meta[k];
    addCrm(g.c, a.crm);
    g.ads.push(a.id);
    if (a.stage) g.stages.add(a.stage);
    byConcept.set(key, g);
  }
  const concepts: ConceptRow[] = [...byConcept.entries()].map(([conceptKey, g]) => {
    const conversions = hasCrm ? g.c.seats : g.m.leads + g.m.purchases;
    return {
      ...finish(g.m, g.c), conceptKey, concept: g.concept, format: g.format, stages: [...g.stages].sort(), ads: g.ads, conversions,
      cpaReal: rnd(div(g.m.spend, conversions)),
      light: lightFromCpa(g.m.spend, conversions, baseline),
    };
  });
  const rank: Record<RygColor, number> = { green: 0, yellow: 1, grey: 2, red: 3 };
  concepts.sort((a, b) => rank[a.light] - rank[b.light] || (a.cpaReal ?? Infinity) - (b.cpaReal ?? Infinity) || b.meta.spend - a.meta.spend);

  const unattributedMetrics = finish(emptyMeta(), unattrRaw);
  if (!hasCrm) { // chưa có CRM → "không có dữ liệu", không phải 0
    const clear = (m: Metrics) => { m.crm.cashRoas = null; m.crm.cpaSeat = null; };
    const walk = (nodes: ReportNode[]) => nodes.forEach((x) => { clear(x); walk(x.children); });
    clear(totalMetrics); clear(unattributedMetrics); walk(tree); concepts.forEach(clear);
  }

  const placementRows: PlacementRow[] = [...placements.entries()]
    .map(([placement, p]) => ({ placement, ...p, sharePct: rnd(div(p.leads * 100, crmTotal.leads), 1) ?? 0 }))
    .sort((a, b) => b.leads - a.leads);

  return {
    range: { from: range.from ?? null, to: range.to ?? null },
    hasCrm, total: totalMetrics, primary,
    truthGap: hasCrm ? { metaPurchases: total.purchases, crmSeats: crmTotal.seats, overreportPct: rnd(div((total.purchases - crmTotal.seats) * 100, crmTotal.seats), 1) } : null,
    funnel: {
      leads: crmTotal.leads, seats: crmTotal.seats, programs: crmTotal.programs,
      leadToSeatPct: rnd(div(crmTotal.seats * 100, crmTotal.leads), 1), seatToProgramPct: rnd(div(crmTotal.programs * 100, crmTotal.seats), 1),
    },
    tree,
    unattributed: { ...unattributedMetrics, leadIds: unattributedLeads },
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, spend: round2(d.spend) as number })),
    placements: placementRows,
    concepts,
    trackedPct: rnd(div(crmTotal.tracked * 100, crmTotal.leads), 1),
    provisionalDates: [...provisional].sort(),
  };
}

/** Khoảng ngày mặc định: `days` ngày kết thúc ở ngày có dữ liệu mới nhất. */
export function defaultRange(latestDate: string | null | undefined, days = 7): { from: string; to: string } | null {
  if (!latestDate) return null;
  const d = new Date(`${latestDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return { from: d.toISOString().slice(0, 10), to: latestDate };
}
