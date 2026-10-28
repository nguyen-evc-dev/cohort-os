/**
 * Nhận định AI: payload tổng hợp (không PII) + kiểm tra "mọi con số trong câu trả lời đều có trong payload".
 * Code tính số; Claude chỉ diễn giải. Hàm thuần, dùng chung cho Web (T2.8) và Bé Sugar (T4.4).
 */
import { assertNoPii } from './mask';
import type { ProjectReport } from './report';
import { SKILLS } from './skills.generated';
import { defaultConfig } from './config';

export const INSIGHT_MODEL = 'claude-sonnet-5-5';

export interface InsightSignalInput {
  type: string; color: string; level: string; entity_id: string; action: string; compared_to?: string | null;
  numbers: Record<string, unknown>;
}
export interface InsightPayload {
  project: string;
  range: { from: string | null; to: string | null };
  mode: 'meta' | 'crm';
  signals_as_of: string | null;
  goal: Record<string, unknown>;
  steps: Record<string, unknown>[];
  primary: Record<string, unknown>;
  final: Record<string, unknown>;
  total: Record<string, unknown>;
  truth_gap: Record<string, unknown> | null;
  funnel: Record<string, unknown> | null;
  tracked_pct: number | null;
  concepts: Record<string, unknown>[];
  campaigns: Record<string, unknown>[];
  signals: Record<string, unknown>[];
  daily: Record<string, unknown>[];
  thresholds: Record<string, number | string>;
}

const nn = <T,>(v: T | null | undefined): T | null => (v === undefined ? null : v);

export function buildInsightPayload(input: {
  projectName: string; report: ProjectReport; signals?: InsightSignalInput[]; signalsAsOf?: string | null;
}): InsightPayload {
  const r = input.report;
  const crm = r.hasCrm;
  const g = defaultConfig().global;
  const stepsOf = (m: { steps: ProjectReport['total']['steps'] }) => Object.fromEntries(r.steps.filter((s) => s.available).map((s) => [s.key, { count: m.steps[s.key]?.count ?? 0, cost: m.steps[s.key]?.cost ?? null }]));
  const metaOf = (m: { meta: ProjectReport['total']['meta'] }) => ({
    spend: m.meta.spend, impressions: m.meta.impressions, clicks: m.meta.clicks, ctr: m.meta.ctr, cpm: m.meta.cpm, cpc: m.meta.cpc,
    hook_rate: m.meta.hookRate, hold_rate: m.meta.holdRate, lpv_rate: m.meta.lpvRate,
    leads_meta: m.meta.leads, purchases_meta: m.meta.purchases, cpl_meta: nn(m.meta.cpl), cpa_meta: nn(m.meta.cpaMeta), landing_page_views: m.meta.lpv,
  });
  const crmOf = (m: ProjectReport['total']) => (crm ? {
    crm_leads: m.crm.leads, seats: m.crm.seats, programs: m.crm.programs, revenue: m.crm.revenue, cpa_seat: nn(m.crm.cpaSeat), cash_roas: nn(m.crm.cashRoas),
  } : {});
  return {
    project: input.projectName,
    range: r.range,
    mode: crm ? 'crm' : 'meta',
    signals_as_of: input.signalsAsOf ?? null,
    goal: { focus: r.goal.focus || null, configured: r.goalConfigured, primary: r.goal.primary, final: r.goal.final, compare: r.goal.compare, target_cost: r.goal.target_cost },
    steps: r.steps.map((s) => ({ key: s.key, label: s.label, source: s.source, available: s.available, count: s.count, cost: s.cost, value: s.value, rate_from_prev: s.rateFromPrev })),
    primary: { label: r.primary.label, count: r.primary.value, cost: r.primary.cost, target: r.primary.target, fallback_meta: r.primary.fallback },
    final: { label: r.final.label, available: r.final.available, count: r.final.count, cost: r.final.cost, value: r.final.value, roas: r.final.roas },
    total: { ...metaOf(r.total), ...crmOf(r.total), results_for_cost: r.primary.value, cost_per_result: nn(r.primary.cost) },
    truth_gap: r.truthGap ? { meta_purchases: r.truthGap.metaPurchases, crm_seats: r.truthGap.crmSeats, overreport_pct: nn(r.truthGap.overreportPct) } : null,
    funnel: crm ? { leads: r.funnel.leads, seats: r.funnel.seats, programs: r.funnel.programs, lead_to_seat_pct: nn(r.funnel.leadToSeatPct), seat_to_program_pct: nn(r.funnel.seatToProgramPct) } : null,
    tracked_pct: nn(r.trackedPct),
    concepts: r.concepts.slice(0, 10).map((c) => ({
      concept: c.concept, format: c.format, stages: c.stages, light: c.light, ads: c.ads.length, ...metaOf(c), steps: stepsOf(c), primary_count: c.conversions, primary_cost: nn(c.cpaReal),
      ...(crm ? { crm_leads: c.crm.leads, seats: c.crm.seats, cpa_seat: nn(c.crm.cpaSeat) } : { cost_per_result: nn(c.cpaReal), results: c.conversions }),
    })),
    campaigns: r.tree.slice(0, 8).map((c) => ({
      campaign_id: c.id, campaign: c.name, sac: !!c.isSac, ...metaOf(c), steps: stepsOf(c), ...(crm ? { crm_leads: c.crm.leads, seats: c.crm.seats, cpa_seat: nn(c.crm.cpaSeat), cash_roas: nn(c.crm.cashRoas) } : {}),
    })),
    signals: (input.signals ?? []).slice(0, 12).map((s) => {
      const n = s.numbers || {};
      return {
        color: s.color, type: s.type, level: s.level, name: n.entity_name ?? s.entity_id, campaign: n.campaign_name ?? null, action: s.action,
        compared_to: s.compared_to ?? null, spend: nn(n.spend as number | undefined), baseline: nn(n.baseline as number | undefined),
        frequency_7d: nn(n.frequency_7d as number | undefined), ctr_drop: nn(n.ctr_drop as number | undefined), below_baseline: nn(n.below_baseline as number | undefined),
      };
    }),
    daily: r.daily.slice(-14).map((d) => ({ date: d.date, spend: d.spend, leads_meta: d.leadsMeta, purchases_meta: d.purchasesMeta, ...(crm ? { crm_leads: d.crmLeads, seats: d.seats } : {}), provisional: d.provisional })),
    thresholds: {
      learning_hold_hours: g.learning_hold_hours as number, budget_wait_hours: g.scale_min_hours_since_budget as number,
      scale_step_pct: Number(g.scale_step) * 100, fatigue_frequency: g.fatigue_frequency as number, burn_cpl_multiple: g.burn_cpl_multiple as number,
    },
  };
}

// ---------- Kiểm tra số "có căn cứ" ----------
const NUM_RE = /\$?-?\d[\d,]*(?:\.\d+)?%?/g;
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\b/g;

function norm(n: number): string { return String(Math.round(n * 1e6) / 1e6); }

/** Mọi số xuất hiện trong payload (kể cả chữ số nằm trong chuỗi như tên campaign / ngày). */
function payloadNumbers(payload: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) { out.add(norm(v)); out.add(norm(Math.abs(v))); }
    else if (typeof v === 'string') { for (const m of v.match(NUM_RE) ?? []) { const x = Number(m.replace(/[$,%]/g, '').replace(/,/g, '')); if (Number.isFinite(x)) out.add(norm(x)); } }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(payload);
  return out;
}

/**
 * Trả về các số trong `text` KHÔNG có trong payload. Bỏ qua: ngày (24/10, 2026-10-24), số thứ tự nhỏ (1–5)
 * không kèm $ hoặc %, và "gạch đầu dòng đánh số" như `1)`.
 */
export function findUngroundedNumbers(text: string, payload: unknown): string[] {
  const known = payloadNumbers(payload);
  const stripped = text.replace(DATE_RE, ' ').replace(/(^|\s)\d\)/g, ' ');
  const bad: string[] = [];
  for (const m of stripped.match(NUM_RE) ?? []) {
    const raw = m.replace(/[$%]/g, '').replace(/,/g, '');
    const x = Number(raw);
    if (!Number.isFinite(x)) continue;
    const marked = /[$%]/.test(m);
    if (!marked && Number.isInteger(x) && x >= 0 && x <= 5) continue;
    if (!known.has(norm(x)) && !known.has(norm(Math.abs(x)))) bad.push(m);
  }
  return [...new Set(bad)];
}

export function insightSystemPrompt(): string {
  return `${SKILLS['ads-deep-analysis'] ?? ''}\n\n${SKILLS['meta-ads-playbook'] ?? ''}\n\n## Dữ liệu\nTin nhắn người dùng là một khối JSON tổng hợp. Chỉ phân tích dữ liệu trong khối đó.`;
}

export function insightUserMessage(payload: InsightPayload, question?: string): string {
  assertNoPii(payload, 'Payload gửi Claude');
  return `${question ? `Câu hỏi của anh: ${question.slice(0, 300)}\n\n` : ''}Dữ liệu (JSON):\n${JSON.stringify(payload)}`;
}
