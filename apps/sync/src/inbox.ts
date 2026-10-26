/**
 * Đọc thư mục inbox do agent Claude ghi (JSON thô, chép nguyên từ connector Meta) và chuẩn hóa
 * về dạng `packages/core` dùng. Agent chỉ CHÉP; mọi tính toán / kiểm tra nằm ở đây và ở pipeline.
 *
 * sync/inbox/<thư mục>/
 *   meta.json        { mode: "daily"|"backfill", account_id, date_from, date_to, run_started_at }
 *   ads.json         [ad × ngày]  (ads_get_ad_entities level=ad, time_increment=1)
 *   account.json     [ngày]       (level=ad_account, time_increment=1)
 *   campaigns.json   [campaign]   adsets.json [adset]   ads_status.json [ad, số 7 ngày]
 *   creatives.json   [{ ad_id, creative_id, title, body, link_url, call_to_action_type, thumbnail_url }]
 *   activity.json    [activity log, đã bỏ actor_*]
 *   customconversions.json [{ id, name, custom_event_type, is_archived, last_fired_time, default_conversion_value }]
 *
 * Chuyển đổi (custom conversion, pixel event, video_view) không có field đếm riêng trong connector: agent chép
 * `cost_per_action_type:<loại>` và script suy ra số lượng = spend / cost (làm tròn; lệch quá 2% thì bỏ).
 */
import fs from 'node:fs';
import path from 'node:path';
import { num, type Row } from '@cohort/core';

export const INBOX_FILES = ['meta.json', 'ads.json', 'account.json', 'campaigns.json', 'adsets.json',
  'ads_status.json', 'creatives.json', 'activity.json', 'customconversions.json'] as const;
const REQUIRED = ['meta.json', 'ads.json', 'account.json'];

export interface RunMeta { mode: 'daily' | 'backfill'; account_id: string; date_from: string; date_to: string; run_started_at?: string }
export interface Batch {
  dir: string;
  meta: RunMeta;
  adRows: Row[];        // dạng importAdRowToDaily
  checkRows: Row[];     // { date, account_spend }
  entities: Row[];      // dạng importEntitiesToRows
  creatives: Row[];     // dòng meta_creatives
  activity: Row[];      // { object_id, event_type, datetime_raw, old_value, new_value }
  targetingByAdset: Record<string, unknown>;
  /** { date, ad_id, campaign_id, action_type, count } suy ra từ cost_per_action_type */
  actionRows: Row[];
  /** Tổng chuyển đổi tài khoản theo ngày (để đối chiếu): date → action_type → count */
  checkActions: Record<string, Record<string, number>>;
  customConversions: Row[];
  problems: { file: string; reason: string; detail?: unknown }[];
}

const ID_RE = /^\d{6,25}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Loại hành động cần giữ: custom conversion, pixel event chuẩn, lead, video_view (lượt xem 3 giây). */
export const KEEP_ACTION = /^(offsite_conversion\.custom\.\d{6,25}|offsite_conversion\.fb_pixel_[a-z_]{2,40}|video_view|lead|onsite_conversion\.lead_grouped)$/;

/** Đọc chi phí theo loại hành động: khóa phẳng "cost_per_action_type:<loại>", object, hoặc mảng { action_type, value }. */
export function costPerActions(r: Row): Record<string, number> {
  const out: Record<string, number> = {};
  const put = (type: string, v: unknown) => { const x = money(v); if (KEEP_ACTION.test(type) && x > 0) out[type] = x; };
  for (const [k, v] of Object.entries(r)) if (k.startsWith('cost_per_action_type:')) put(k.slice('cost_per_action_type:'.length), v);
  const nested = r.cost_per_action_type;
  if (Array.isArray(nested)) for (const it of nested) put(String(it?.action_type ?? ''), it?.value);
  else if (nested && typeof nested === 'object') for (const [k, v] of Object.entries(nested)) put(k, v);
  return out;
}

/** Số lượng = spend / cost. Chỉ nhận khi kết quả gần số nguyên (lệch ≤ 2%) để không suy ra số sai từ dữ liệu chép lỗi. */
export function deriveCounts(spend: number, costs: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!(spend > 0)) return out;
  for (const [type, cost] of Object.entries(costs)) {
    const raw = spend / cost;
    const c = Math.round(raw);
    if (c >= 1 && Math.abs(raw - c) <= Math.max(0.05, c * 0.02)) out[type] = c;
  }
  return out;
}

/** {"value":"19.36","unit":"USD"} | "19.36" | 19.36 | null → số. */
export function money(v: unknown): number {
  if (v && typeof v === 'object' && 'value' in (v as Row)) return num((v as Row).value);
  return num(v);
}
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function readJson(dir: string, file: string, problems: Batch['problems']): any {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) {
    if (REQUIRED.includes(file)) problems.push({ file, reason: 'missing_file' });
    return file === 'meta.json' ? null : [];
  }
  try {
    const raw = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
    const data = JSON.parse(raw);
    // Agent có thể lưu nguyên kết quả tool: { ad_entities: "[...]" } hoặc { ad_entities: [...] }
    if (file !== 'meta.json' && !Array.isArray(data)) {
      for (const k of ['ad_entities', 'ad_creatives', 'result', 'data', 'rows']) {
        const inner = data?.[k];
        if (Array.isArray(inner)) return inner;
        if (typeof inner === 'string') return JSON.parse(inner);
      }
      problems.push({ file, reason: 'not_an_array' });
      return [];
    }
    return data;
  } catch (e) {
    problems.push({ file, reason: 'invalid_json', detail: (e as Error).message.slice(0, 200) });
    return file === 'meta.json' ? null : [];
  }
}

/** Activity log: extra_data là chuỗi JSON; budget Meta tính theo cent. */
function activityValues(extra: unknown): { old_value: number | null; new_value: number | null } {
  let x: any = extra;
  if (typeof extra === 'string') { try { x = JSON.parse(extra); } catch { x = null; } }
  // { old_value: { type: "payment_amount", old_value: 2000 }, new_value: { new_value: 2400 } } hoặc số trơn
  const cents = (o: any, k: string) => {
    const n = o && typeof o === 'object' ? o[k] : o;
    return n === undefined || n === null || n === '' || !Number.isFinite(Number(n)) ? null : Number(n) / 100;
  };
  return { old_value: cents(x?.old_value, 'old_value'), new_value: cents(x?.new_value, 'new_value') };
}

export function readInbox(dir: string): Batch {
  const problems: Batch['problems'] = [];
  const meta = readJson(dir, 'meta.json', problems) as RunMeta | null;
  const ads = readJson(dir, 'ads.json', problems) as Row[];
  const account = readJson(dir, 'account.json', problems) as Row[];
  const campaigns = readJson(dir, 'campaigns.json', problems) as Row[];
  const adsets = readJson(dir, 'adsets.json', problems) as Row[];
  const adsStatus = readJson(dir, 'ads_status.json', problems) as Row[];
  const creatives = readJson(dir, 'creatives.json', problems) as Row[];
  const activity = readJson(dir, 'activity.json', problems) as Row[];
  const customs = readJson(dir, 'customconversions.json', problems) as Row[];

  const m: RunMeta = {
    mode: meta?.mode === 'backfill' ? 'backfill' : 'daily',
    account_id: str(meta?.account_id),
    date_from: str(meta?.date_from),
    date_to: str(meta?.date_to),
    run_started_at: meta?.run_started_at,
  };
  if (!meta) problems.push({ file: 'meta.json', reason: 'missing_meta' });
  else if (!ID_RE.test(m.account_id) || !DATE_RE.test(m.date_from) || !DATE_RE.test(m.date_to) || m.date_from > m.date_to) {
    problems.push({ file: 'meta.json', reason: 'invalid_meta', detail: m });
  }

  // Dòng ad: bỏ dòng không có id (connector trả dòng rỗng cho ngày spend = 0)
  const adRows: Row[] = [];
  const actionRows: Row[] = [];
  for (const r of ads) {
    if (!r || !r.id) continue;
    const date = str(r.date_start);
    if (!ID_RE.test(str(r.id)) || !ID_RE.test(str(r.campaign_id)) || !ID_RE.test(str(r.adset_id)) || !DATE_RE.test(date)) {
      problems.push({ file: 'ads.json', reason: 'invalid_row', detail: { id: r.id, date } });
      continue;
    }
    adRows.push({
      date, ad_id: str(r.id), ad_name: str(r.name), campaign_id: str(r.campaign_id), campaign_name: str(r.campaign_name),
      adset_id: str(r.adset_id), adset_name: str(r.adset_name), objective: str(r.objective),
      spend: money(r.amount_spent), impressions: num(r.impressions), reach: num(r.reach), frequency: num(r.frequency),
      link_clicks: num(r.link_click), link_ctr: num(r.website_ctr), cpm: money(r.cpm), leads: num(r.lead),
      purchases: num(r.omni_purchase), landing_page_views: num(r.landing_page_view), thruplay: num(r.video_thruplay_watched_actions),
      outbound_clicks: num(r.outbound_clicks), video_3s: 0,
    });
    const counts = deriveCounts(money(r.amount_spent), costPerActions(r));
    adRows[adRows.length - 1].video_3s = counts.video_view || 0;
    for (const [action_type, count] of Object.entries(counts)) {
      if (action_type !== 'video_view') actionRows.push({ date, ad_id: str(r.id), campaign_id: str(r.campaign_id), action_type, count });
    }
  }

  const checkRows = account
    .filter((r) => r && DATE_RE.test(str(r.date_start)))
    .map((r) => ({ date: str(r.date_start), account_spend: money(r.amount_spent) }));
  const checkActions: Record<string, Record<string, number>> = {};
  for (const r of account) if (r && DATE_RE.test(str(r.date_start))) checkActions[str(r.date_start)] = deriveCounts(money(r.amount_spent), costPerActions(r));

  const customConversions: Row[] = [];
  for (const c of customs) {
    if (!c || !ID_RE.test(str(c.id)) || !str(c.name)) continue;
    const fired = str(c.last_fired_time);
    customConversions.push({ id: str(c.id), name: str(c.name).slice(0, 200), event_type: str(c.custom_event_type).slice(0, 40) || null,
      is_archived: c.is_archived === true || c.is_archived === 'true', last_fired_at: fired && !Number.isNaN(Date.parse(fired)) ? new Date(fired).toISOString() : null,
      default_value: c.default_conversion_value === undefined || c.default_conversion_value === null ? null : num(c.default_conversion_value) });
  }

  const targetingByAdset: Record<string, unknown> = {};
  const entities: Row[] = [];
  for (const c of campaigns) {
    if (!c || !ID_RE.test(str(c.id))) continue;
    entities.push({ level: 'campaign', id: str(c.id), name: str(c.name), objective: str(c.objective),
      effective_status: str(c.effective_status), daily_budget: money(c.daily_budget), lifetime_budget: money(c.lifetime_budget) });
  }
  for (const s of adsets) {
    if (!s || !ID_RE.test(str(s.id))) continue;
    const ls = s.learning_stage_info || {};
    entities.push({ level: 'adset', id: str(s.id), name: str(s.name), campaign_id: str(s.campaign_id),
      effective_status: str(s.effective_status), daily_budget: money(s.daily_budget), lifetime_budget: money(s.lifetime_budget),
      learning_status: str(ls.status || s.learning_status), last_sig_edit_ts: num(ls.last_sig_edit_ts || s.last_sig_edit_ts) || '' });
    if (s.targeting_summary && typeof s.targeting_summary === 'object') targetingByAdset[str(s.id)] = s.targeting_summary;
  }
  for (const a of adsStatus) {
    if (!a || !ID_RE.test(str(a.id))) continue;
    entities.push({ level: 'ad', id: str(a.id), name: str(a.name), campaign_id: str(a.campaign_id), adset_id: str(a.adset_id),
      effective_status: str(a.effective_status),
      frequency_7d: a.frequency === undefined || a.frequency === null ? '' : num(a.frequency),
      reach_7d: a.reach === undefined || a.reach === null ? '' : num(a.reach),
      impressions_7d: a.impressions === undefined || a.impressions === null ? '' : num(a.impressions) });
  }

  const creativeRows: Row[] = [];
  for (const c of creatives) {
    const adId = str(c?.ad_id);
    if (!ID_RE.test(adId)) continue;
    const cut = (v: unknown, n: number) => (v === null || v === undefined || v === '' ? null : String(v).slice(0, n));
    creativeRows.push({
      ad_id: adId, creative_id: ID_RE.test(str(c.creative_id ?? c.id)) ? str(c.creative_id ?? c.id) : null,
      title: cut(c.title, 1000), body: cut(c.body, 5000), link_url: cut(c.link_url, 2000),
      cta: cut(c.call_to_action_type ?? c.cta, 60), thumbnail_url_meta: cut(c.thumbnail_url, 2000),
    });
  }

  // Activity: chỉ giữ sự kiện budget; KHÔNG giữ actor_name / actor_id dù agent có lỡ chép
  const activityRows: Row[] = [];
  for (const a of activity) {
    if (!a || !/budget/i.test(str(a.event_type)) || !ID_RE.test(str(a.object_id))) continue;
    activityRows.push({ object_id: str(a.object_id), event_type: str(a.event_type).slice(0, 80),
      datetime_raw: str(a.datetime ?? a.datetime_raw), ...activityValues(a.extra_data) });
  }

  return { dir, meta: m, adRows, checkRows, entities, creatives: creativeRows, activity: activityRows, targetingByAdset, actionRows, checkActions, customConversions, problems };
}
