/**
 * Bản chụp báo cáo cho Bé Sugar (bot_snapshots). Bot không đọc được lead/deal, nên số liệu theo mục tiêu Project
 * (custom conversion, bước CRM, Truth Gap…) được TÍNH SẴN ở phía có quyền (sync trên máy Nguyên / web admin)
 * bằng đúng code của báo cáo Web, rồi chỉ lưu payload tổng hợp đã quét PII. Hàm thuần, không gọi mạng.
 */
import { assertNoPii } from './mask';
import { buildInsightPayload, type InsightPayload, type InsightSignalInput } from './insight';
import { buildProjectReport, defaultRange } from './report';
import { readGoal, goalActionTypes } from './goal';
import type { Row } from './util';

export const SNAPSHOT_RANGES = [
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: 'all', days: null as number | null },
] as const;
export type SnapshotRangeKey = (typeof SNAPSHOT_RANGES)[number]['key'];
export const ALL_SLUG = 'all';
const MAX_PAYLOAD_BYTES = 60_000;

export interface SnapshotRow {
  slug: string;
  range_key: SnapshotRangeKey;
  project_id: string | null;
  as_of: string;
  data_version: string;
  payload: InsightPayload;
}

export interface SnapshotInput {
  projects: Row[];
  projectCampaigns: Row[];
  metaRows: Row[];
  entities: Row[];
  /** meta_actions_daily */
  actions: Row[];
  submissions: Row[];
  deals: Row[];
  /** tín hiệu của ngày mới nhất */
  signals: Row[];
  signalsAsOf: string | null;
  /** creative_assets (cột stage gắn tay) */
  assets?: Row[];
}

/** Băm chuỗi 53-bit (cyrb53) → hex. Không phụ thuộc Node nên chạy được cả trong Apps Script. */
export function hashString(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

function stageOverrides(assets: Row[]) {
  const byConcept: Record<string, string> = {}; const byAd: Record<string, string> = {};
  for (const a of assets) {
    if (!a.stage) continue;
    if (a.scope === 'concept' && a.concept_key) byConcept[a.concept_key] = a.stage;
    if (a.scope === 'ad' && a.ad_id) byAd[String(a.ad_id)] = a.stage;
  }
  return { byConcept, byAd };
}

/** Mỗi Project (kể cả "all" = toàn tài khoản) × mỗi khoảng ngày → 1 payload. Ném lỗi nếu payload nghi chứa PII. */
export function buildBotSnapshots(input: SnapshotInput): SnapshotRow[] {
  const latest = input.metaRows.reduce<string>((m, r) => (String(r.date) > m ? String(r.date) : m), '');
  if (!latest) return [];
  const overrides = stageOverrides(input.assets ?? []);
  const scopes: { slug: string; name: string; id: string | null; campaignIds: string[] | null; goal: ReturnType<typeof readGoal> }[] = [
    ...input.projects.filter((p) => p.status !== 'archived').map((p) => ({
      slug: String(p.slug), name: String(p.name), id: String(p.id),
      campaignIds: input.projectCampaigns.filter((c) => c.project_id === p.id).map((c) => String(c.campaign_id)),
      goal: readGoal(p.goal),
    })),
    { slug: ALL_SLUG, name: 'Toàn tài khoản', id: null, campaignIds: null, goal: null },
  ];
  const actionTypes = new Set(goalActionTypes(scopes.map((s) => s.goal)));
  const actions = input.actions.filter((a) => actionTypes.has(String(a.action_type)));
  const out: SnapshotRow[] = [];
  for (const sc of scopes) {
    const campSet = sc.campaignIds ? new Set(sc.campaignIds) : null;
    const signals: InsightSignalInput[] = input.signals
      .filter((s) => !campSet || campSet.has(String(s.numbers?.campaign_id ?? (s.level === 'campaign' ? s.entity_id : ''))))
      .map((s) => ({ type: s.type, color: s.color, level: s.level, entity_id: s.entity_id, action: s.action, compared_to: s.compared_to, numbers: s.numbers ?? {} }));
    for (const r of SNAPSHOT_RANGES) {
      const range = r.days ? defaultRange(latest, r.days) : null;
      const report = buildProjectReport({
        metaRows: input.metaRows, campaignIds: sc.campaignIds, range: { from: range?.from ?? null, to: range?.to ?? null },
        entities: input.entities, actions, goal: sc.goal, stageOverrides: overrides,
        // CRM chỉ của Project này (deal ghép qua contact_id nên không lọc theo project)
        submissions: sc.id ? input.submissions.filter((s) => s.project_id === sc.id) : [],
        deals: sc.id ? input.deals : [],
      });
      const payload = buildInsightPayload({ projectName: sc.name, report, signals, signalsAsOf: input.signalsAsOf });
      assertNoPii(payload, `Snapshot ${sc.slug}/${r.key}`);
      const json = JSON.stringify(payload);
      if (json.length > MAX_PAYLOAD_BYTES) throw new Error(`Snapshot ${sc.slug}/${r.key} quá lớn (${json.length} byte)`);
      out.push({ slug: sc.slug, range_key: r.key, project_id: sc.id, as_of: latest, data_version: hashString(json), payload });
    }
  }
  return out;
}
