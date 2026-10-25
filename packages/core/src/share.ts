/**
 * Share link = SNAPSHOT đóng băng của báo cáo (không phải dữ liệu sống).
 * - Chỉ chứa số tổng hợp theo campaign / adset / ad / concept; KHÔNG có contact_id, deal_id, email.
 * - Tùy chọn "ẩn số tiền": mọi số tiền bị bỏ khỏi snapshot (không chỉ ẩn ở giao diện), chỉ còn tỉ lệ, số đếm và đèn.
 */
import { assertNoPii } from './mask';
import type { ConceptRow, DayPoint, Metrics, ProjectReport, ReportNode } from './report';

export interface ShareSnapshot {
  v: 1;
  title: string;
  projectName: string;
  generatedAt: string;
  src: 'meta' | 'crm' | 'both';
  hideMoney: boolean;
  report: ProjectReport;
  /** conceptKey → Drive fileId (ảnh phục vụ qua /api/thumb, chỉ file đã gắn trong creative_assets) */
  thumbs: Record<string, string>;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** Bỏ mọi số tiền khỏi 1 khối Metrics. Giữ số đếm, CTR, ROAS (tỉ lệ) và Δ%. */
function stripMoney(m: Metrics): void {
  const meta = m.meta as unknown as Record<string, number | null>;
  for (const k of ['spend', 'cpm', 'cpl', 'cpaMeta']) meta[k] = null;
  const crm = m.crm as unknown as Record<string, number | null>;
  for (const k of ['seatRevenue', 'programRevenue', 'revenue', 'cpaSeat']) crm[k] = null;
  for (const s of Object.values(m.steps ?? {})) { (s as { cost: number | null }).cost = null; (s as unknown as { value: number | null }).value = null; }
}

/** Spend theo ngày → chỉ số tương đối (ngày cao nhất = 100) để biểu đồ vẫn có hình dạng mà không lộ số tiền. */
function indexDaily(daily: DayPoint[]): DayPoint[] {
  const max = Math.max(...daily.map((d) => d.spend), 0);
  return daily.map((d) => ({ ...d, spend: max > 0 ? Math.round((d.spend / max) * 100) : 0 }));
}

export function hideMoneyInReport(report: ProjectReport): ProjectReport {
  const r = clone(report);
  stripMoney(r.total);
  stripMoney(r.unattributed);
  const walk = (nodes: ReportNode[]) => nodes.forEach((n) => { stripMoney(n); walk(n.children); });
  walk(r.tree);
  r.concepts.forEach((c: ConceptRow) => { stripMoney(c); c.cpaReal = null; });
  r.primary = { ...r.primary, cost: null, target: null };
  r.final = { ...r.final, cost: null, value: null as unknown as number };
  r.steps = r.steps.map((s) => ({ ...s, cost: null, value: null as unknown as number }));
  r.goal = { ...r.goal, target_cost: null, steps: r.goal.steps.map((s) => ({ ...s, value: null })) };
  r.daily = indexDaily(r.daily);
  return r;
}

export function buildShareSnapshot(input: {
  title: string; projectName: string; report: ProjectReport; src: 'meta' | 'crm' | 'both';
  hideMoney: boolean; thumbs?: Record<string, string>; now?: Date;
}): ShareSnapshot {
  const snap: ShareSnapshot = {
    v: 1, title: input.title.slice(0, 200), projectName: input.projectName.slice(0, 120),
    generatedAt: (input.now ?? new Date()).toISOString(), src: input.src, hideMoney: input.hideMoney,
    report: input.hideMoney ? hideMoneyInReport(input.report) : clone(input.report), thumbs: input.thumbs ?? {},
  };
  assertNoPii(snap, 'Snapshot share link');
  return snap;
}

export const SHARE_TTL_HOURS = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 } as const;
export type ShareTtl = keyof typeof SHARE_TTL_HOURS;
