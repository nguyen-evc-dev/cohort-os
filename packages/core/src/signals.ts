/**
 * Rules engine tín hiệu — hàm thuần, không gọi API.
 * Code quyết định tín hiệu + con số; Claude chỉ viết lại thành lời.
 *
 * Cửa sổ thời gian (asOf = "hôm qua" theo giờ PT):
 *   window   = [asOf-(w-1) .. asOf]                 w = eval_window_days (3)
 *   last7    = [asOf-6 .. asOf],  prev7 = [asOf-13 .. asOf-7]
 *   baseline = baseline_days ngày NGAY TRƯỚC window (không lẫn số đang đánh giá)
 *
 * Đơn vị chuyển đổi:
 *   - Campaign OUTCOME_SALES + CRM còn mới + có mốc CPA seat → đo theo SEAT (CRM).
 *   - Còn lại → đo theo LEAD (Meta báo).
 */
import { configValue, type Config } from './config';
import { addDays, dateRange, hoursBetween, median, num, pct, round2, type Row } from './util';

export type SignalType = 'burn' | 'fatigue' | 'learning' | 'budget_wait' | 'scale' | 'overreport' | 'insufficient';
export const SIGNAL_PRIORITY: Record<SignalType, number> = {
  burn: 1, fatigue: 2, learning: 3, budget_wait: 3, scale: 4, overreport: 5, insufficient: 6,
};

export interface Baseline { value: number | null; source: 'target' | 'campaign' | 'account' | 'none' }
type Conv = 'leads' | 'seats';
interface Day { spend: number; leads: number; purchases: number; seats: number; clicks: number; impressions: number }

export interface AdContext {
  ad_id: string; ad_name: string; concept: string; format: string; stage: string; status: string;
  spendWin: number; convWin: number; spend7: number; conv7: number;
  ctr7: number | null; ctrPrev7: number | null; frequency7d: number | null;
}
export interface CampaignContext {
  campaign: { id: string; name: string; objective: string; status: string; learning: boolean; budgetChangedAt: string; isCbo: boolean };
  conv: Conv;
  baseline: Baseline; baselineLead: Baseline; baselineSeat: Baseline;
  winDates: string[];
  winDaily: (Day & { date: string })[];
  win: Day; last7: Day;
  ads: AdContext[];
  crmFresh: boolean;
}
export interface Signal {
  type: SignalType; priority: number; level: 'ad' | 'campaign';
  entityId: string; entityName: string; concept?: string; format?: string; stage: string | null;
  action: string; numbers: Record<string, any>; comparedTo: Baseline['source'];
}

const emptyDay = (): Day => ({ spend: 0, leads: 0, purchases: 0, seats: 0, clicks: 0, impressions: 0 });

function sumDays(dailyByDate: Record<string, Day>, dates: string[]): Day {
  const t = emptyDay();
  for (const d of dates) {
    const x = dailyByDate[d];
    if (!x) continue;
    (Object.keys(t) as (keyof Day)[]).forEach((k) => { t[k] += x[k] || 0; });
  }
  return t;
}

/** CRM theo ad × ngày (cộng dồn các cohort). */
function indexCrm(crmRows: Row[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of crmRows || []) {
    if (!r.ad_id) continue;
    const k = `${r.ad_id}||${r.date}`;
    out[k] = (out[k] || 0) + num(r.seats);
  }
  return out;
}

/** Mốc chuẩn chi phí / chuyển đổi: target → trung vị campaign → trung vị tài khoản cùng objective. */
export function computeBaselineMetric(
  dailyByDate: Record<string, Day>, accountDailyByDate: Record<string, Day> | undefined, convField: Conv,
  campaignDates: string[], accountDates: string[], minConv: number, target?: unknown,
): Baseline {
  if (target && num(target) > 0) return { value: num(target), source: 'target' };
  const pick = (byDate: Record<string, Day>, dates: string[]) => {
    let total = 0;
    const cpas: number[] = [];
    for (const d of dates) {
      const x = byDate[d];
      if (!x || !x[convField]) continue;
      total += x[convField];
      cpas.push(x.spend / x[convField]);
    }
    return total >= minConv ? median(cpas) : null;
  };
  let v = pick(dailyByDate, campaignDates);
  if (v !== null) return { value: round2(v), source: 'campaign' };
  v = pick(accountDailyByDate || {}, accountDates);
  if (v !== null) return { value: round2(v), source: 'account' };
  return { value: null, source: 'none' };
}

export interface BuildContextsInput {
  metaRows: Row[]; entities: Row[]; crmRows?: Row[]; asOf: string; config: Config; nowIso: string; crmFresh: boolean;
}

/** Dựng ngữ cảnh cho từng campaign có spend trong 7 ngày gần nhất. */
export function buildCampaignContexts(p: BuildContextsInput): CampaignContext[] {
  const g = p.config.global;
  const w = Number(g.eval_window_days);
  const winDates = dateRange(addDays(p.asOf, -(w - 1)), p.asOf);
  const last7 = dateRange(addDays(p.asOf, -6), p.asOf);
  const prev7 = dateRange(addDays(p.asOf, -13), addDays(p.asOf, -7));
  const baseTo = addDays(winDates[0], -1);
  const campaignBaseDates = dateRange(addDays(baseTo, -(Number(g.baseline_days) - 1)), baseTo);
  const accountBaseDates = dateRange(addDays(baseTo, -(Number(g.account_baseline_days) - 1)), baseTo);

  const crmSeats = indexCrm(p.crmRows);
  const ent: Record<string, Record<string, Row>> = { campaign: {}, adset: {}, ad: {} };
  for (const e of p.entities || []) if (ent[e.level]) ent[e.level][e.id] = e;

  interface AdAcc { ad_id: string; daily: Record<string, Day>; latestDate: string; ad_name?: string; adset_id?: string; concept?: string; format?: string; stage?: string }
  interface CampAcc { id: string; name: string; objective: string; daily: Record<string, Day>; ads: Record<string, AdAcc> }
  const byCampaign: Record<string, CampAcc> = {};
  const accountByObjective: Record<string, Record<string, Day>> = {};

  for (const r of p.metaRows || []) {
    const seats = crmSeats[`${r.ad_id}||${r.date}`] || 0;
    const c = (byCampaign[r.campaign_id] ||= { id: r.campaign_id, name: r.campaign_name, objective: r.objective, daily: {}, ads: {} });
    const addTo = (target: Record<string, Day>) => {
      const d = (target[r.date] ||= emptyDay());
      d.spend += num(r.spend); d.leads += num(r.leads_meta); d.purchases += num(r.purchases_meta);
      d.seats += seats; d.clicks += num(r.link_clicks); d.impressions += num(r.impressions);
    };
    addTo(c.daily);
    const a = (c.ads[r.ad_id] ||= { ad_id: r.ad_id, daily: {}, latestDate: '' });
    if (r.date >= a.latestDate) {
      // Ad có thể được đổi tên giữa chừng → luôn lấy tên/concept/stage của ngày mới nhất.
      Object.assign(a, { latestDate: r.date, ad_name: r.ad_name, adset_id: r.adset_id,
        concept: r.creative_concept, format: r.creative_format, stage: r.funnel_stage });
    }
    addTo(a.daily);
    addTo((accountByObjective[r.objective] ||= {}));
  }

  const contexts: CampaignContext[] = [];
  for (const cid of Object.keys(byCampaign)) {
    const c = byCampaign[cid];
    if (sumDays(c.daily, last7).spend <= 0) continue;

    const ce = ent.campaign[cid] || {};
    const activeAdsets = Object.values(ent.adset)
      .filter((s) => String(s.campaign_id) === String(cid) && s.effective_status === 'ACTIVE');
    const isCbo = num(ce.daily_budget) > 0 || num(ce.lifetime_budget) > 0;
    // Mốc "vừa thay đổi" = muộn nhất giữa lần đổi budget và lần thay đổi lớn (Meta last_sig_edit).
    const lastChange = (e: Row): string => {
      const a = e.budget_changed_at || '';
      const b = e.last_sig_edit_at || '';
      return a > b ? a : b;
    };
    const budgetChangedAt = isCbo ? lastChange(ce)
      : activeAdsets.reduce((m, s) => { const t = lastChange(s); return t > m ? t : m; }, '');
    // LEARNING chỉ chặn khi thay đổi lớn còn mới; budget nhỏ có thể "learning" mãi.
    const holdHours = Number(g.learning_hold_hours);
    const learning = activeAdsets.some((s) =>
      s.learning_status === 'LEARNING' && !!s.last_sig_edit_at && hoursBetween(s.last_sig_edit_at, p.nowIso) < holdHours);

    const objective = c.objective || ce.objective || '';
    const baselineLead = computeBaselineMetric(c.daily, accountByObjective[objective], 'leads',
      campaignBaseDates, accountBaseDates, Number(g.baseline_min_leads), configValue(p.config, 'target_cpl', cid));
    const baselineSeat = computeBaselineMetric(c.daily, accountByObjective[objective], 'seats',
      campaignBaseDates, accountBaseDates, Number(g.baseline_min_seats), configValue(p.config, 'target_cpa_seat', cid));

    const useSeat = objective === 'OUTCOME_SALES' && p.crmFresh && baselineSeat.value !== null;
    const conv: Conv = useSeat ? 'seats' : 'leads';

    const ads: AdContext[] = Object.keys(c.ads).map((aid) => {
      const a = c.ads[aid];
      const ae = ent.ad[aid] || {};
      const win = sumDays(a.daily, winDates);
      const l7 = sumDays(a.daily, last7);
      const p7 = sumDays(a.daily, prev7);
      return {
        ad_id: aid, ad_name: a.ad_name || '', concept: a.concept || '', format: a.format || '', stage: a.stage || '',
        status: ae.effective_status || '',
        spendWin: win.spend, convWin: win[conv], spend7: l7.spend, conv7: l7[conv],
        ctr7: l7.impressions ? l7.clicks / l7.impressions : null,
        ctrPrev7: p7.impressions ? p7.clicks / p7.impressions : null,
        frequency7d: ae.frequency_7d === '' || ae.frequency_7d === undefined ? null : num(ae.frequency_7d),
      };
    });

    contexts.push({
      campaign: { id: cid, name: c.name || ce.name, objective, status: ce.effective_status || '', learning, budgetChangedAt, isCbo },
      conv,
      baseline: useSeat ? baselineSeat : baselineLead,
      baselineLead, baselineSeat,
      winDates,
      winDaily: winDates.map((d) => ({ date: d, ...(c.daily[d] || emptyDay()) })),
      win: sumDays(c.daily, winDates),
      last7: sumDays(c.daily, last7),
      ads,
      crmFresh: !!p.crmFresh,
    });
  }
  return contexts;
}

/** Chưa có trạng thái (entity chưa refresh) thì coi như đang chạy. */
const isRunning = (ad: AdContext) => !ad.status || ad.status === 'ACTIVE';

export function computeSignals(ctx: CampaignContext, config: Config, nowIso: string): Signal[] {
  const g = config.global;
  const base = ctx.baseline.value;
  const comparedTo = ctx.baseline.source;
  const isSeat = ctx.conv === 'seats';
  const signals: Signal[] = [];
  const c = ctx.campaign;
  const hoursSince = c.budgetChangedAt ? round2(hoursBetween(c.budgetChangedAt, nowIso)) : null;
  const flagged = new Set<string>();

  const adSignal = (type: SignalType, ad: AdContext, action: string, numbers: Record<string, any>): Signal => ({
    type, priority: SIGNAL_PRIORITY[type], level: 'ad', entityId: ad.ad_id, entityName: ad.ad_name,
    concept: ad.concept, format: ad.format, stage: ad.stage || null, action, numbers, comparedTo,
  });
  const campaignSignal = (type: SignalType, action: string, numbers: Record<string, any>): Signal => ({
    type, priority: SIGNAL_PRIORITY[type], level: 'campaign', entityId: c.id, entityName: c.name, stage: null,
    action, numbers, comparedTo,
  });

  // 🛑 Đốt tiền — theo từng ad
  if (base) {
    const mult = Number(isSeat ? g.burn_cpa_seat_multiple : g.burn_cpl_multiple);
    ctx.ads
      .filter((a) => isRunning(a) && a.spendWin >= mult * base && a.convWin === 0)
      .sort((x, y) => y.spendWin - x.spendWin)
      .forEach((a) => {
        flagged.add(a.ad_id);
        signals.push(adSignal('burn', a, 'pause_ad', {
          spend: round2(a.spendWin), conversions: 0, conv_type: ctx.conv, baseline: base, days: ctx.winDates.length,
        }));
      });
  }

  // ⚠️ Creative mỏi — theo từng ad
  for (const a of ctx.ads) {
    if (flagged.has(a.ad_id) || !isRunning(a) || a.frequency7d === null) continue;
    if (a.frequency7d <= Number(g.fatigue_frequency)) continue;
    const ctrDrop = a.ctrPrev7 && a.ctr7 !== null ? (a.ctrPrev7 - a.ctr7) / a.ctrPrev7 : null;
    const cpa7 = a.conv7 ? a.spend7 / a.conv7 : null;
    const ctrBad = ctrDrop !== null && ctrDrop >= Number(g.fatigue_ctr_drop);
    const cpaBad = !!base && cpa7 !== null && cpa7 >= base * (1 + Number(g.fatigue_cpl_rise));
    if (!ctrBad && !cpaBad) continue;
    signals.push(adSignal('fatigue', a, 'replace_creative', {
      frequency_7d: round2(a.frequency7d), ctr_7d: pct(a.ctr7), ctr_prev_7d: pct(a.ctrPrev7), ctr_drop: pct(ctrDrop),
      cpa_7d: cpa7 === null ? null : round2(cpa7), conv_type: ctx.conv, baseline: base,
    }));
  }

  // ⏳ Learning / vừa đổi budget — campaign
  if (c.learning) signals.push(campaignSignal('learning', 'hold', {}));
  const minHours = Number(g.scale_min_hours_since_budget);
  const budgetSettled = hoursSince === null || hoursSince >= minHours;
  if (!budgetSettled) signals.push(campaignSignal('budget_wait', 'wait', { hours_since_budget_change: hoursSince, hours_required: minHours }));

  // 🔥 Scale — campaign, mọi ngày trong cửa sổ đều tốt
  if (base && !c.learning && budgetSettled) {
    const ratio = Number(g.scale_cpl_ratio);
    const allGood = ctx.winDaily.every((d) => d.spend > 0 && d[ctx.conv] > 0 && d.spend / d[ctx.conv] <= ratio * base);
    if (allGood) {
      const best = ctx.ads.filter((a) => a.convWin > 0).sort((x, y) => x.spendWin / x.convWin - y.spendWin / y.convWin)[0];
      const cpaWin = ctx.win.spend / ctx.win[ctx.conv];
      signals.push(campaignSignal('scale', 'increase_budget', {
        cpa_window: round2(cpaWin), baseline: base, conv_type: ctx.conv, below_baseline: pct(1 - cpaWin / base),
        days: ctx.winDates.length, scale_step: Number(g.scale_step), hours_since_budget_change: hoursSince,
        best_ad: best ? { ad_id: best.ad_id, ad_name: best.ad_name, concept: best.concept, format: best.format,
          stage: best.stage, cpa: round2(best.spendWin / best.convWin) } : null,
      }));
    }
  }

  // 📉 Meta over-report — campaign (chỉ khi CRM còn mới)
  if (ctx.crmFresh && ctx.last7.purchases > 0 && ctx.last7.purchases > ctx.last7.seats * (1 + Number(g.overreport_ratio))) {
    signals.push(campaignSignal('overreport', 'trust_crm', { purchases_meta_7d: ctx.last7.purchases, seats_crm_7d: ctx.last7.seats }));
  }

  // ❓ Thiếu dữ liệu
  if (!base) signals.push(campaignSignal('insufficient', 'wait_for_data', { reason: 'no_baseline' }));
  else if (!signals.length && ctx.win.spend < base) {
    signals.push(campaignSignal('insufficient', 'wait_for_data', { reason: 'low_spend', spend: round2(ctx.win.spend), baseline: base }));
  }

  return signals
    .sort((a, b) => a.priority - b.priority || num(b.numbers.spend) - num(a.numbers.spend))
    .slice(0, Number(g.max_signals_per_campaign));
}
