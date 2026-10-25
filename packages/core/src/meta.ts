/**
 * Chuẩn hóa dữ liệu Meta.
 * - Luồng chính (connector Claude): xem ingest.ts.
 * - Luồng dự phòng (Graph API, khi có System User token): normalizeInsightRow, buildEntityRows.
 */
import { parseAdName, resolveStage } from './parse';
import { num, toIsoUtc, type Row } from './util';

export interface MetaAction { action_type: string; value: string | number }

const ACTION_TYPES = {
  leads: ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'],
  purchases: ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'],
  landing_page_views: ['landing_page_view', 'omni_landing_page_view'],
  video_3s: ['video_view'],
};

// Tiền tệ Meta không nhân 100 khi trả budget (offset = 1).
const ZERO_DECIMAL_CURRENCIES = ['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND'];

/** Giá trị action đầu tiên khớp theo thứ tự ưu tiên. */
export function pickAction(actions: MetaAction[] | null | undefined, types: string[]): number {
  if (!actions || !actions.length) return 0;
  for (const t of types) {
    const hit = actions.find((a) => a.action_type === t);
    if (hit) return num(hit.value);
  }
  return 0;
}

/** 1 dòng insights Graph API → 1 dòng meta_ads_daily. */
export function normalizeInsightRow(raw: Row, nowIso: string, configStageByCampaign?: Record<string, string>): Row {
  const parsed = parseAdName(raw.ad_name);
  const stageCfg = configStageByCampaign ? configStageByCampaign[raw.campaign_id] : null;
  return {
    date: raw.date_start,
    account_id: String(raw.account_id || ''),
    campaign_id: String(raw.campaign_id),
    campaign_name: raw.campaign_name,
    objective: raw.objective || '',
    adset_id: String(raw.adset_id),
    adset_name: raw.adset_name,
    ad_id: String(raw.ad_id),
    ad_name: raw.ad_name,
    funnel_stage: resolveStage(raw.ad_name, raw.adset_name, raw.campaign_name, stageCfg) || '',
    creative_format: parsed.format || '',
    creative_concept: parsed.concept,
    spend: num(raw.spend),
    impressions: num(raw.impressions),
    reach: num(raw.reach),
    frequency: num(raw.frequency),
    link_clicks: num(raw.inline_link_clicks),
    link_ctr: num(raw.inline_link_click_ctr),
    cpm: num(raw.cpm),
    landing_page_views: pickAction(raw.actions, ACTION_TYPES.landing_page_views),
    leads_meta: pickAction(raw.actions, ACTION_TYPES.leads),
    purchases_meta: pickAction(raw.actions, ACTION_TYPES.purchases),
    video_3s: pickAction(raw.actions, ACTION_TYPES.video_3s),
    thruplay: pickAction(raw.video_thruplay_watched_actions, ['video_view']),
    updated_at: nowIso,
  };
}

export function currencyOffset(currency: string | null | undefined): number {
  return ZERO_DECIMAL_CURRENCIES.includes(String(currency || '').toUpperCase()) ? 1 : 100;
}

/**
 * Thời điểm đổi budget gần nhất.
 * - Ưu tiên giờ chính xác từ Activity Log nếu mới hơn mốc đã lưu.
 * - Snapshot thấy budget khác lần trước mà Activity Log không có → dùng thời điểm phát hiện (nowIso).
 * - Lần đầu thấy entity: chưa biết → '' (rules engine coi như đã ổn định).
 */
export function resolveBudgetChangedAt(prev: Row | undefined, curr: Row, nowIso: string, activityIso?: string | null): string {
  const prevChanged: string = (prev && prev.budget_changed_at) || '';
  let result = prevChanged;
  const activityIsNew = !!activityIso && activityIso > prevChanged;
  if (activityIsNew) result = activityIso as string;
  const differs = !!prev && (num(prev.daily_budget) !== num(curr.daily_budget)
    || num(prev.lifetime_budget) !== num(curr.lifetime_budget));
  if (differs && !activityIsNew) result = nowIso;
  return result;
}

export interface BuildEntityInput {
  accountId: string; nowIso: string; currency?: string;
  campaigns?: Row[]; adsets?: Row[]; ads?: Row[];
  freq7dByAd?: Record<string, Row>; prevByKey?: Record<string, Row>; activityByObject?: Record<string, string>;
}

/** Graph API: campaign/adset/ad + frequency 7 ngày + snapshot trước + activity log → dòng meta_entities. */
export function buildEntityRows(input: BuildEntityInput): Row[] {
  const offset = currencyOffset(input.currency);
  const prevByKey = input.prevByKey || {};
  const activity = input.activityByObject || {};
  const objectiveByCampaign: Record<string, string> = {};
  const rows: Row[] = [];

  const base = (level: string, e: Row) => {
    const prev = prevByKey[`${level}||${e.id}`];
    return {
      prev,
      row: {
        level, id: String(e.id), name: e.name, account_id: String(input.accountId),
        effective_status: e.effective_status || '',
        first_seen_at: prev && prev.first_seen_at ? prev.first_seen_at : input.nowIso,
        last_seen_at: input.nowIso,
      } as Row,
    };
  };
  const budgets = (e: Row) => ({
    daily_budget: e.daily_budget ? num(e.daily_budget) / offset : '',
    lifetime_budget: e.lifetime_budget ? num(e.lifetime_budget) / offset : '',
  });

  for (const c of input.campaigns || []) {
    objectiveByCampaign[c.id] = c.objective || '';
    const { prev, row } = base('campaign', c);
    Object.assign(row, { campaign_id: String(c.id), adset_id: '', objective: c.objective || '', learning_status: '' }, budgets(c));
    row.budget_changed_at = resolveBudgetChangedAt(prev, row, input.nowIso, activity[c.id]);
    rows.push(row);
  }
  for (const s of input.adsets || []) {
    const { prev, row } = base('adset', s);
    Object.assign(row, {
      campaign_id: String(s.campaign_id), adset_id: String(s.id), objective: objectiveByCampaign[s.campaign_id] || '',
      learning_status: (s.learning_stage_info && s.learning_stage_info.status) || '',
    }, budgets(s));
    row.budget_changed_at = resolveBudgetChangedAt(prev, row, input.nowIso, activity[s.id]);
    rows.push(row);
  }
  for (const a of input.ads || []) {
    const { row } = base('ad', a);
    const f = (input.freq7dByAd || {})[a.id] || {};
    Object.assign(row, {
      campaign_id: String(a.campaign_id), adset_id: String(a.adset_id), objective: objectiveByCampaign[a.campaign_id] || '',
      daily_budget: '', lifetime_budget: '', learning_status: '',
      reach_7d: f.reach === undefined ? '' : num(f.reach),
      impressions_7d: f.impressions === undefined ? '' : num(f.impressions),
      frequency_7d: f.frequency === undefined ? '' : num(f.frequency),
      budget_changed_at: '',
    });
    rows.push(row);
  }
  return rows;
}

/** Activity log Graph API → { objectId: ISO thời điểm đổi budget gần nhất }. */
export function latestBudgetActivity(activities: Row[] | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of activities || []) {
    if (!/budget/i.test(a.event_type || '')) continue;
    const iso = toIsoUtc(a.event_time);
    const id = String(a.object_id || '');
    if (id && iso && (!out[id] || iso > out[id])) out[id] = iso;
  }
  return out;
}
