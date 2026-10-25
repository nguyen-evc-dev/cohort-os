/** Đèn đỏ-vàng-xanh-xám từ tín hiệu (PRD mục D). Màu do code quyết định; skill ryg-decision chỉ diễn giải. */
import type { Config } from './config';
import type { Signal } from './signals';

export type RygColor = 'red' | 'yellow' | 'green' | 'grey';
export interface RygLight { color: RygColor; action: string; reason: Signal | null }

const ORDER: Record<RygColor, number> = { red: 0, yellow: 1, green: 2, grey: 3 };

/** Mỏi nặng khi frequency và CPA 7 ngày đều vượt ngưỡng đỏ. */
function isHeavyFatigue(s: Signal, config: Config): boolean {
  const g = config.global;
  const f = Number(s.numbers.frequency_7d);
  const cpa = Number(s.numbers.cpa_7d);
  const base = Number(s.numbers.baseline);
  return f > Number(g.fatigue_red_frequency) && !!base && cpa >= Number(g.fatigue_red_cpa_multiple) * base;
}

export function signalColor(s: Signal, config: Config): RygLight {
  switch (s.type) {
    case 'burn': return { color: 'red', action: 'pause_ad', reason: s };
    case 'fatigue': return isHeavyFatigue(s, config)
      ? { color: 'red', action: 'replace_creative', reason: s }
      : { color: 'yellow', action: 'replace_creative', reason: s };
    case 'scale': return { color: 'green', action: 'increase_budget', reason: s };
    case 'insufficient': return { color: 'grey', action: 'wait_for_data', reason: s };
    default: return { color: 'yellow', action: s.action, reason: s }; // learning, budget_wait, overreport
  }
}

/** Đèn của campaign: đỏ nếu có tín hiệu đỏ; xanh khi có scale; chỉ thiếu dữ liệu → xám; còn lại vàng. */
export function campaignLight(signals: Signal[], config: Config): RygLight {
  if (!signals.length) return { color: 'yellow', action: 'watch', reason: null };
  const lights = signals.map((s) => signalColor(s, config));
  const red = lights.find((l) => l.color === 'red');
  if (red) return red;
  const green = lights.find((l) => l.color === 'green');
  if (green) return green;
  const yellow = lights.find((l) => l.color === 'yellow');
  if (yellow) return yellow;
  return lights[0];
}

/** Đèn của 1 ad: theo tín hiệu cấp ad; ad tốt nhất của tín hiệu scale → xanh; không có tín hiệu → null. */
export function adLight(adId: string, signals: Signal[], config: Config): RygLight | null {
  const own = signals.filter((s) => s.level === 'ad' && s.entityId === adId).map((s) => signalColor(s, config));
  if (own.length) return own.sort((a, b) => ORDER[a.color] - ORDER[b.color])[0];
  const scale = signals.find((s) => s.type === 'scale' && s.numbers.best_ad && s.numbers.best_ad.ad_id === adId);
  return scale ? { color: 'green', action: 'increase_budget', reason: scale } : null;
}

/**
 * Đèn nhanh theo CPA tổng (Creative Vault / báo cáo master), mốc = CPA trung bình của Project.
 * Xanh: ≥ 2 chuyển đổi và CPA ≤ 80% mốc · Đỏ: 0 chuyển đổi mà spend ≥ 2× mốc · Xám: 0 chuyển đổi, spend < mốc.
 */
export function lightFromCpa(spend: number, conversions: number, baseline: number | null, minConv = 2): RygColor {
  if (!baseline) return 'grey';
  if (conversions >= minConv && spend / conversions <= 0.8 * baseline) return 'green';
  if (conversions === 0 && spend >= 2 * baseline) return 'red';
  if (conversions === 0 && spend < baseline) return 'grey';
  return 'yellow';
}
