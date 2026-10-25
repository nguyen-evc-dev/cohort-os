/**
 * Báo cáo Project: ghép số Meta (meta_ads_daily + meta_actions_daily) với CRM (crm_submissions + crm_deals)
 * và đo theo CHUỖI MỤC TIÊU của Project (goal.ts), không theo Lead / ROAS mặc định.
 * Hàm thuần — Web, share snapshot và AI dùng chung một nguồn số.
 *
 * Quy tắc CRM (khớp view bot.v_project_master / bot._leads / bot._lead_outcomes):
 *   • Lead = 1 contact / project: lượt có tracking sớm nhất (tracked), không có thì lượt direct sớm nhất. Bỏ test/invalid.
 *   • Seat / Program = deal seat / program đã thắng của contact đó; bước "stages" đếm theo Deal Stage (bước sau gồm cả deal đi xa hơn).
 *   • Mọi kết quả CRM gắn vào ad_id của lead (first-touch).
 *   • Lead không có ad_id, hoặc ad_id không thuộc campaign của project → hàng "Unattributed".
 * Khoảng ngày: Meta lọc theo `date`, CRM lọc theo ngày đăng ký của lead (`converted_on`).
 */
import { defaultGoal, type GoalStep, type ProjectGoal } from './goal';
import { lightFromCpa, type RygColor } from './ryg';
import { round2, type Row } from './util';

export interface DateRange { from?: string | null; to?: string | null }

export interface MetaMetrics {
  spend: number; impressions: number; clicks: number; leads: number; purchases: number; lpv: number;
  video3s: number; thruplay: number; outbound: number;
  ctr: number | null; cpm: number | null; cpc: number | null; cpl: number | null; cpaMeta: number | null;
  /** lượt xem 3 giây / impression */
  hookRate: number | null;
  /** ThruPlay / lượt xem 3 giây */
  holdRate: number | null;
  /** landing page view / link click */
  lpvRate: number | null;
}
export interface CrmMetrics {
  leads: number; tracked: number; seats: number; programs: number;
  seatRevenue: number; programRevenue: number; revenue: number;
  cpaSeat: number | null; cashRoas: number | null;
}
export interface StepValue { count: number; cost: number | null; value: number }
export interface Metrics {
  meta: MetaMetrics; crm: CrmMetrics;
  /** (Meta − CRM) / CRM theo cặp so sánh của mục tiêu (mặc định Purchase Meta vs Seat CRM) */
  deltaPurchases: number | null;
  /** Kết quả theo từng bước của mục tiêu: key → số lượng, chi phí / bước, giá trị */
  steps: Record<string, StepValue>;
}

export type NodeLevel = 'campaign' | 'adset' | 'ad';
export interface ReportNode extends Metrics {
  id: string; level: NodeLevel; name: string; parentId: string | null;
  concept?: string; conceptKey?: string; format?: string; stage?: string; isSac?: boolean;
  status?: string; provisional?: boolean;
  children: ReportNode[];
}

export interface DayPoint {
  date: string; spend: number; impressions: number; clicks: number; lpv: number; video3s: number; thruplay: number;
  leadsMeta: number; purchasesMeta: number; crmLeads: number; seats: number; provisional: boolean;
  /** key bước → số lượng trong ngày (Meta theo ngày phát sinh, CRM theo ngày đăng ký của lead) */
  steps: Record<string, number>;
}
export interface PlacementRow { placement: string; leads: number; seats: number; programs: number; sharePct: number }
export interface ConceptRow extends Metrics {
  conceptKey: string; concept: string; format: string; stages: string[]; ads: string[];
  light: RygColor; conversions: number; cpaReal: number | null;
}
export interface StepSummary extends StepValue {
  key: string; label: string; source: 'meta' | 'crm';
  /** false khi là bước CRM mà Project chưa import HubSpot */
  available: boolean;
  /** % so với bước liền trước (chỉ khi cả hai bước có dữ liệu) */
  rateFromPrev: number | null;
  isPrimary: boolean; isFinal: boolean;
}

export interface ProjectReport {
  range: { from: string | null; to: string | null };
  hasCrm: boolean;
  goal: ProjectGoal;
  /** true khi Project đã khai báo mục tiêu (không dùng mặc định) */
  goalConfigured: boolean;
  total: Metrics;
  steps: StepSummary[];
  /** Bước chính: số chuyển đổi + chi phí / chuyển đổi (CPA / CPL). */
  primary: { key: string; kind: 'meta' | 'crm'; label: string; value: number; cost: number | null; target: number | null; fallback: boolean };
  /** Bước cuối: giá trị thật */
  final: { key: string; label: string; count: number; cost: number | null; value: number; roas: number | null; available: boolean };
  truthGap: { metaLabel: string; crmLabel: string; metaPurchases: number; crmSeats: number; overreportPct: number | null } | null;
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
  /** meta_actions_daily: { date, ad_id, action_type, count } */
  actions?: Row[];
  /** Mục tiêu của Project; null / bỏ trống → mặc định */
  goal?: ProjectGoal | null;
  /** Stage gắn tay (ghi đè stage tự nhận từ tên): theo concept_key và theo ad_id. Ưu tiên: ad > concept > tự nhận. */
  stageOverrides?: { byConcept?: Record<string, string>; byAd?: Record<string, string> };
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const rnd = (v: number | null, d = 2): number | null => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);
const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

// ---------- Bộ cộng dồn ----------
interface RawMeta { spend: number; impressions: number; clicks: number; leads: number; purchases: number; lpv: number; video3s: number; thruplay: number; outbound: number; steps: Record<string, number> }
interface RawCrm { leads: number; tracked: number; seats: number; programs: number; seatRevenue: number; programRevenue: number; steps: Record<string, { count: number; value: number }> }
const emptyMeta = (): RawMeta => ({ spend: 0, impressions: 0, clicks: 0, leads: 0, purchases: 0, lpv: 0, video3s: 0, thruplay: 0, outbound: 0, steps: {} });
const emptyCrm = (): RawCrm => ({ leads: 0, tracked: 0, seats: 0, programs: 0, seatRevenue: 0, programRevenue: 0, steps: {} });
const NUM_META = ['spend', 'impressions', 'clicks', 'leads', 'purchases', 'lpv', 'video3s', 'thruplay', 'outbound'] as const;
const NUM_CRM = ['leads', 'tracked', 'seats', 'programs', 'seatRevenue', 'programRevenue'] as const;

function addMeta(a: RawMeta, b: RawMeta) {
  for (const k of NUM_META) a[k] += b[k];
  for (const [k, v] of Object.entries(b.steps)) a.steps[k] = (a.steps[k] || 0) + v;
}
function addCrm(a: RawCrm, b: RawCrm) {
  for (const k of NUM_CRM) a[k] += b[k];
  for (const [k, v] of Object.entries(b.steps)) {
    const cur = (a.steps[k] ||= { count: 0, value: 0 });
    cur.count += v.count; cur.value += v.value;
  }
}

function finishMeta(m: RawMeta): MetaMetrics {
  return {
    spend: round2(m.spend) as number, impressions: m.impressions, clicks: m.clicks, leads: m.leads, purchases: m.purchases, lpv: m.lpv,
    video3s: m.video3s, thruplay: m.thruplay, outbound: m.outbound,
    ctr: rnd(div(m.clicks, m.impressions), 4), cpm: rnd(m.impressions ? (m.spend / m.impressions) * 1000 : null), cpc: rnd(div(m.spend, m.clicks)),
    cpl: rnd(div(m.spend, m.leads)), cpaMeta: rnd(div(m.spend, m.purchases)),
    hookRate: rnd(div(m.video3s, m.impressions), 4), holdRate: rnd(div(m.thruplay, m.video3s), 4), lpvRate: rnd(div(m.lpv, m.clicks), 4),
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

// ---------- Đếm theo bước ----------
function metaStepCount(step: GoalStep, r: Row, actionsIdx: Map<string, number>): number {
  const a = step.action_type || '';
  if (a.startsWith('col.')) return n(r[a.slice(4)]);
  return actionsIdx.get(`${r.date}|${r.ad_id}|${a}`) || 0;
}

/** Số deal của 1 lead cho từng bước CRM. Bước "stages" cộng dồn: deal ở stage của bước sau cũng tính cho bước trước. */
function crmStepsForLead(dealsOfLead: Row[], crmSteps: GoalStep[]): Record<string, { count: number; value: number }> {
  const out: Record<string, { count: number; value: number }> = {};
  const stageSteps = crmSteps.filter((s) => s.crm === 'stages');
  const stageIndex = (stage: string) => {
    const st = stage.trim().toLowerCase();
    let idx = -1;
    stageSteps.forEach((s, i) => { if ((s.stages || []).some((x) => x.toLowerCase() === st)) idx = Math.max(idx, i); });
    return idx;
  };
  for (const s of crmSteps) {
    let count = 0, amount = 0;
    if (s.crm === 'registrations') count = 1;
    else if (s.crm === 'seats' || s.crm === 'programs') {
      const type = s.crm === 'seats' ? 'seat' : 'program';
      for (const d of dealsOfLead) if (d.deal_type === type && d.is_won) { count += 1; amount += n(d.amount); }
    } else if (s.crm === 'stages') {
      const my = stageSteps.indexOf(s);
      for (const d of dealsOfLead) {
        if (d.deal_type === 'test') continue;
        if (stageIndex(String(d.deal_stage || '')) >= my) { count += 1; amount += n(d.amount); }
      }
    }
    if (count) out[s.key] = { count, value: s.value !== null && s.value !== undefined ? count * s.value : amount };
  }
  return out;
}

function finish(m: RawMeta, c: RawCrm, goal: ProjectGoal): Metrics {
  const meta = finishMeta(m);
  const crm = finishCrm(c, m.spend);
  const steps: Record<string, StepValue> = {};
  for (const s of goal.steps) {
    const count = s.source === 'meta' ? (m.steps[s.key] || 0) : (c.steps[s.key]?.count || 0);
    const value = s.source === 'meta' ? count * (s.value ?? 0) : (c.steps[s.key]?.value || 0);
    steps[s.key] = { count, cost: rnd(div(m.spend, count)), value: round2(value) as number };
  }
  let deltaPurchases: number | null = null;
  if (goal.compare) {
    const mc = steps[goal.compare.meta]?.count ?? 0;
    const cc = steps[goal.compare.crm]?.count ?? 0;
    deltaPurchases = cc > 0 ? rnd((mc - cc) / cc, 3) : null;
  }
  return { meta, crm, deltaPurchases, steps };
}

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

interface LeadOutcome { lead: Row; seats: number; seatRevenue: number; programs: number; programRevenue: number; deals: Row[] }

/** Mỗi lead + kết quả mua (khớp bot._lead_outcomes: deal nhiều contact tính cho từng contact). */
export function leadOutcomes(leads: Row[], deals: Row[]): LeadOutcome[] {
  const byContact = new Map<string, Row[]>();
  for (const d of deals || []) for (const c of d.contact_ids || []) {
    const k = String(c);
    (byContact.get(k) || byContact.set(k, []).get(k)!).push(d);
  }
  return leads.map((lead) => {
    const mine = byContact.get(String(lead.contact_id)) || [];
    const o: LeadOutcome = { lead, seats: 0, seatRevenue: 0, programs: 0, programRevenue: 0, deals: mine };
    for (const d of mine) {
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
const emptyDay = (date: string): DayPoint => ({ date, spend: 0, impressions: 0, clicks: 0, lpv: 0, video3s: 0, thruplay: 0, leadsMeta: 0, purchasesMeta: 0, crmLeads: 0, seats: 0, provisional: false, steps: {} });

export function buildProjectReport(input: ReportInput): ProjectReport {
  const range = input.range || {};
  const goalConfigured = !!input.goal;
  const goal: ProjectGoal = input.goal ?? defaultGoal();
  const metaSteps = goal.steps.filter((s) => s.source === 'meta');
  const crmSteps = goal.steps.filter((s) => s.source === 'crm');
  const campaignSet = input.campaignIds ? new Set(input.campaignIds.map(String)) : null;
  const metaRows = (input.metaRows || []).filter((r) => (!campaignSet || campaignSet.has(String(r.campaign_id))) && inRange(r.date, range));
  const entitiesById = new Map<string, Row>();
  for (const e of input.entities || []) entitiesById.set(`${e.level}||${e.id}`, e);
  const actionsIdx = new Map<string, number>();
  for (const a of input.actions || []) {
    const k = `${a.date}|${a.ad_id}|${a.action_type}`;
    actionsIdx.set(k, (actionsIdx.get(k) || 0) + n(a.count));
  }

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
    const row: RawMeta = {
      spend: n(r.spend), impressions: n(r.impressions), clicks: n(r.link_clicks), leads: n(r.leads_meta), purchases: n(r.purchases_meta),
      lpv: n(r.landing_page_views), video3s: n(r.video_3s), thruplay: n(r.thruplay), outbound: n(r.outbound_clicks), steps: {},
    };
    for (const s of metaSteps) { const c = metaStepCount(s, r, actionsIdx); if (c) row.steps[s.key] = c; }
    addMeta(a.meta, row);
    addMeta(total, row);
    adsets.set(String(r.adset_id), { id: String(r.adset_id), name: r.adset_name || adsets.get(String(r.adset_id))?.name || '', campaignId: String(r.campaign_id) });
    campaigns.set(String(r.campaign_id), { id: String(r.campaign_id), name: r.campaign_name || '' });
    const d = daily.get(r.date) || emptyDay(r.date);
    d.spend += row.spend; d.impressions += row.impressions; d.clicks += row.clicks; d.lpv += row.lpv; d.video3s += row.video3s; d.thruplay += row.thruplay;
    d.leadsMeta += row.leads; d.purchasesMeta += row.purchases;
    for (const [k, v] of Object.entries(row.steps)) d.steps[k] = (d.steps[k] || 0) + v;
    if (r.provisional) { d.provisional = true; provisional.add(String(r.date)); }
    daily.set(r.date, d);
  }
  const ov = input.stageOverrides || {};
  for (const a of ads.values()) {
    a.status = String(entitiesById.get(`ad||${a.id}`)?.effective_status || '');
    a.stage = ov.byAd?.[a.id] || ov.byConcept?.[a.conceptKey] || a.stage;
  }

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
      seatRevenue: o.seatRevenue, programRevenue: o.programRevenue, steps: crmStepsForLead(o.deals, crmSteps) };
    addCrm(crmTotal, c);
    const ad = o.lead.ad_id ? ads.get(String(o.lead.ad_id)) : undefined;
    if (ad) addCrm(ad.crm, c); else { addCrm(unattrRaw, c); unattributedLeads += 1; }
    const pl = String(o.lead.placement || '(không rõ)');
    const p = placements.get(pl) || { leads: 0, seats: 0, programs: 0 };
    p.leads += 1; p.seats += o.seats; p.programs += o.programs;
    placements.set(pl, p);
    const day = daily.get(String(o.lead.converted_on)) || emptyDay(String(o.lead.converted_on));
    day.crmLeads += 1; day.seats += o.seats;
    for (const [k, v] of Object.entries(c.steps)) day.steps[k] = (day.steps[k] || 0) + v.count;
    daily.set(day.date, day);
  }

  // ---- Cây Campaign → Adset → Ad ----
  type Acc = ReportNode & { _m: RawMeta; _c: RawCrm };
  const blank = finish(emptyMeta(), emptyCrm(), goal);
  const mkNode = (id: string, level: NodeLevel, name: string, parentId: string | null): Acc => ({
    id, level, name, parentId, children: [], _m: emptyMeta(), _c: emptyCrm(), ...blank,
  });
  const campNodes = new Map<string, Acc>();
  const adsetNodes = new Map<string, Acc>();
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
    adsetNodes.get(a.adsetId)?.children.push(node);
  }
  for (const s of adsetNodes.values()) {
    for (const ch of s.children as Acc[]) { addMeta(s._m, ch._m); addCrm(s._c, ch._c); }
    campNodes.get(s.parentId!)?.children.push(s);
  }
  for (const c of campNodes.values()) for (const ch of c.children as Acc[]) { addMeta(c._m, ch._m); addCrm(c._c, ch._c); }
  const seal = (node: Acc): ReportNode => {
    Object.assign(node, finish(node._m, node._c, goal));
    node.children = (node.children as Acc[]).map(seal).sort((x, y) => y.meta.spend - x.meta.spend);
    delete (node as Partial<Acc>)._m; delete (node as Partial<Acc>)._c;
    return node;
  };
  const tree = [...campNodes.values()].map(seal).sort((x, y) => y.meta.spend - x.meta.spend);

  // ---- Tổng + các bước ----
  const totalMetrics = finish(total, crmTotal, goal);
  const stepAvailable = (s: GoalStep) => s.source === 'meta' || hasCrm;
  const steps: StepSummary[] = goal.steps.map((s, i) => {
    const v = totalMetrics.steps[s.key];
    const prev = i > 0 ? goal.steps[i - 1] : null;
    const prevV = prev ? totalMetrics.steps[prev.key] : null;
    const rate = prev && stepAvailable(prev) && stepAvailable(s) && prevV && prevV.count > 0 ? rnd((v.count / prevV.count) * 100, 1) : null;
    return { ...v, key: s.key, label: s.label, source: s.source, available: stepAvailable(s), rateFromPrev: rate, isPrimary: s.key === goal.primary, isFinal: s.key === goal.final };
  });
  // Bước chính là CRM mà chưa có CRM → tạm dùng bước Meta cuối cùng (ghi rõ fallback)
  let pStep = goal.steps.find((s) => s.key === goal.primary)!;
  let fallback = false;
  if (!stepAvailable(pStep)) {
    const alt = [...metaSteps].pop();
    if (alt) { pStep = alt; fallback = true; }
  }
  const pv = totalMetrics.steps[pStep.key];
  const primary: ProjectReport['primary'] = { key: pStep.key, kind: pStep.source, label: pStep.label, value: pv.count, cost: pv.cost, target: goal.target_cost, fallback };
  const fStep = goal.steps.find((s) => s.key === goal.final)!;
  const fv = totalMetrics.steps[fStep.key];
  const final: ProjectReport['final'] = { key: fStep.key, label: fStep.label, count: fv.count, cost: fv.cost, value: fv.value,
    roas: fv.value > 0 ? rnd(div(fv.value, total.spend)) : null, available: stepAvailable(fStep) };

  // ---- Concept (Creative Vault): đo theo bước chính ----
  const baseline = goal.target_cost ?? primary.cost;
  const byConcept = new Map<string, { m: RawMeta; c: RawCrm; ads: string[]; concept: string; format: string; stages: Set<string> }>();
  for (const a of ads.values()) {
    const key = a.conceptKey || 'unparsed';
    const g = byConcept.get(key) || { m: emptyMeta(), c: emptyCrm(), ads: [], concept: a.concept || 'UNPARSED', format: a.format, stages: new Set<string>() };
    addMeta(g.m, a.meta); addCrm(g.c, a.crm);
    g.ads.push(a.id);
    if (a.stage) g.stages.add(a.stage);
    byConcept.set(key, g);
  }
  const concepts: ConceptRow[] = [...byConcept.entries()].map(([conceptKey, g]) => {
    const mtr = finish(g.m, g.c, goal);
    const conversions = mtr.steps[primary.key]?.count ?? 0;
    return {
      ...mtr, conceptKey, concept: g.concept, format: g.format, stages: [...g.stages].sort(), ads: g.ads, conversions,
      cpaReal: rnd(div(g.m.spend, conversions)), light: lightFromCpa(g.m.spend, conversions, baseline),
    };
  });
  const rank: Record<RygColor, number> = { green: 0, yellow: 1, grey: 2, red: 3 };
  concepts.sort((a, b) => rank[a.light] - rank[b.light] || (a.cpaReal ?? Infinity) - (b.cpaReal ?? Infinity) || b.meta.spend - a.meta.spend);

  const unattributedMetrics = finish(emptyMeta(), unattrRaw, goal);
  if (!hasCrm) { // chưa có CRM → "không có dữ liệu", không phải 0
    const clear = (m: Metrics) => {
      m.crm.cashRoas = null; m.crm.cpaSeat = null;
      for (const s of crmSteps) if (m.steps[s.key]) m.steps[s.key].cost = null;
    };
    const walk = (nodes: ReportNode[]) => nodes.forEach((x) => { clear(x); walk(x.children); });
    clear(totalMetrics); clear(unattributedMetrics); walk(tree); concepts.forEach(clear);
  }

  const placementRows: PlacementRow[] = [...placements.entries()]
    .map(([placement, p]) => ({ placement, ...p, sharePct: rnd(div(p.leads * 100, crmTotal.leads), 1) ?? 0 }))
    .sort((a, b) => b.leads - a.leads);

  let truthGap: ProjectReport['truthGap'] = null;
  if (hasCrm && goal.compare) {
    const m = goal.steps.find((s) => s.key === goal.compare!.meta)!;
    const c = goal.steps.find((s) => s.key === goal.compare!.crm)!;
    const mc = totalMetrics.steps[m.key].count;
    const cc = totalMetrics.steps[c.key].count;
    truthGap = { metaLabel: m.label, crmLabel: c.label, metaPurchases: mc, crmSeats: cc, overreportPct: rnd(div((mc - cc) * 100, cc), 1) };
  }

  return {
    range: { from: range.from ?? null, to: range.to ?? null },
    hasCrm, goal, goalConfigured, total: totalMetrics, steps, primary, final, truthGap,
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
