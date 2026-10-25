/** Cấu hình mặc định (ngưỡng tín hiệu, giờ, xưng hô). Giá trị trong DB/Settings ghi đè mặc định. */

export type ConfigValue = string | number;
export interface Config {
  global: Record<string, ConfigValue>;
  scopes: Record<string, Record<string, ConfigValue>>;
}
export interface ConfigRow { key: string; scope?: string; value: unknown; note?: string }

export const DEFAULT_CONFIG: [string, string, ConfigValue, string][] = [
  ['REPORT_TZ', 'global', 'America/Los_Angeles', 'Múi giờ tài khoản quảng cáo — mọi "ngày" tính theo múi này'],
  ['sync_lag_minutes', 'global', 5, 'Sync chạy N phút sau khi ngày PT kết thúc'],

  ['priority_objectives', 'global', 'OUTCOME_LEADS,OUTCOME_SALES', 'Objective được ưu tiên trong báo cáo'],
  ['max_campaigns_per_report', 'global', 8, ''],
  ['max_signals_per_campaign', 'global', 3, ''],

  ['baseline_days', 'global', 14, 'Số ngày tính mốc chuẩn của campaign (trước cửa sổ đánh giá)'],
  ['account_baseline_days', 'global', 30, 'Số ngày tính mốc chuẩn toàn tài khoản (fallback)'],
  ['baseline_min_leads', 'global', 10, 'Tối thiểu số lead để mốc chuẩn có ý nghĩa'],
  ['baseline_min_seats', 'global', 5, 'Tối thiểu số seat để mốc CPA seat có ý nghĩa'],
  ['eval_window_days', 'global', 3, 'Cửa sổ đánh giá đốt tiền / scale'],

  ['burn_cpl_multiple', 'global', 2, 'Đốt tiền: spend cửa sổ ≥ N × CPL chuẩn mà 0 lead'],
  ['burn_cpa_seat_multiple', 'global', 3, 'Đốt tiền: spend cửa sổ ≥ N × CPA seat chuẩn mà 0 seat'],
  ['fatigue_frequency', 'global', 3.0, 'Mỏi: frequency 7 ngày vượt ngưỡng'],
  ['fatigue_ctr_drop', 'global', 0.25, 'Mỏi: CTR giảm ≥ X so với 7 ngày trước'],
  ['fatigue_cpl_rise', 'global', 0.30, 'Mỏi: CPL 7 ngày cao hơn chuẩn ≥ X'],
  ['fatigue_red_frequency', 'global', 3.5, 'Mỏi nặng (đèn đỏ): frequency vượt ngưỡng'],
  ['fatigue_red_cpa_multiple', 'global', 1.5, 'Mỏi nặng (đèn đỏ): CPA 7 ngày ≥ N × chuẩn'],
  ['scale_cpl_ratio', 'global', 0.8, 'Scale: CPL mỗi ngày ≤ X × chuẩn'],
  ['scale_min_hours_since_budget', 'global', 48, 'Scale: tối thiểu số giờ kể từ lần đổi budget / thay đổi lớn'],
  ['learning_hold_hours', 'global', 72, 'Adset LEARNING chỉ "chưa chạm" trong N giờ sau thay đổi lớn'],
  ['scale_step', 'global', 0.2, 'Mức tăng budget đề xuất (20%)'],
  ['overreport_ratio', 'global', 0.2, 'Meta over-report: purchases Meta > seat CRM × (1+X)'],
  ['import_spend_tolerance', 'global', 0.01, 'Dữ liệu agent ghi: tổng spend theo ngày lệch quá X → từ chối'],

  ['crm_stale_hours', 'global', 24, 'CRM cũ hơn N giờ → cảnh báo'],
  ['meta_stale_hours', 'global', 26, 'Meta sync cũ hơn N giờ → cảnh báo'],

  ['seat_keyword', 'global', 'Webinar', 'Deal Name chứa từ khóa này → deal seat'],
  ['seat_min_amount', 'global', 5, 'Amount < giá trị này → deal test'],
  ['seat_max_amount', 'global', 20, 'Amount trong [seat_min, seat_max] → deal seat'],
  ['program_min_amount', 'global', 100, 'Amount ≥ giá trị này → deal program'],
  ['program_won_stage', 'global', 'Purchased', 'Stage tính là đã mua với deal program'],
  ['seat_lost_stage', 'global', 'Lost', 'Stage loại deal seat'],
  ['attribution_model', 'global', 'first_touch', 'first_touch | last_touch'],

  ['audit_domains', 'global', 'evancoaching.net,evancoaching.com', 'Domain landing page được phép audit'],
  ['bot_self', 'global', 'em', 'Bé Sugar tự xưng'],
  ['bot_user', 'global', 'anh', 'Bé Sugar gọi người đọc'],
];

/** Đổi danh sách dòng config thành { global, scopes }. Ô trống bị bỏ qua. */
export function parseConfigRows(rows: ConfigRow[]): Config {
  const out: Config = { global: {}, scopes: {} };
  for (const r of rows || []) {
    const key = String(r.key || '').trim();
    if (!key) continue;
    const scope = String(r.scope || 'global').trim() || 'global';
    const value = coerceConfigValue(r.value);
    if (value === '') continue;
    if (scope === 'global') out.global[key] = value;
    else (out.scopes[scope] ||= {})[key] = value;
  }
  return out;
}

/** Ghép config đọc được với mặc định (giá trị đọc được thắng). */
export function mergeWithDefaultConfig(parsed: Config): Config {
  const defaults = parseConfigRows(DEFAULT_CONFIG.map(([key, scope, value]) => ({ key, scope, value })));
  return { global: { ...defaults.global, ...parsed.global }, scopes: parsed.scopes };
}

export function defaultConfig(): Config {
  return mergeWithDefaultConfig({ global: {}, scopes: {} });
}

/** Giá trị config cho 1 scope (vd campaign ID / project), rơi về global. */
export function configValue(config: Config, key: string, scope?: string): ConfigValue | undefined {
  if (scope && config.scopes[scope] && config.scopes[scope][key] !== undefined) return config.scopes[scope][key];
  return config.global[key];
}

function coerceConfigValue(v: unknown): ConfigValue | '' {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (s === '') return '';
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}
