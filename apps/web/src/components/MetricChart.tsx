'use client';
import { useEffect, useMemo, useState } from 'react';
import type { DayPoint } from '@cohort/core';
import { DASH, fmtDay, fmtInt, fmtMoney } from '@/lib/format';

export const MAX_SERIES = 6;
type Kind = 'money' | 'count' | 'pct';
type ChartType = 'bar' | 'line';
interface MetricDef { id: string; label: string; kind: Kind; get: (d: DayPoint) => number | null }
interface Pick { id: string; type: ChartType }
export interface ChartStep { key: string; label: string; source: 'meta' | 'crm'; available: boolean }

const div = (a: number, b: number) => (b > 0 ? a / b : null);
const BAR = ['#7c8cff', '#5f6ee0', '#aab3ff'];
const LINE = ['#d0fe16', '#f5b83d', '#fafafa', '#4fd1ff', '#ff7ad9', '#ff4d4d'];

/** Danh mục chỉ số theo ngày: chỉ số Meta chung + số lượng và chi phí của từng bước mục tiêu. */
export function metricCatalog(steps: ChartStep[], relative: boolean): MetricDef[] {
  const base: MetricDef[] = [
    { id: 'spend', label: relative ? 'Spend (chỉ số)' : 'Spend', kind: relative ? 'count' : 'money', get: (d) => d.spend },
    { id: 'impressions', label: 'Impressions', kind: 'count', get: (d) => d.impressions },
    { id: 'clicks', label: 'Link click', kind: 'count', get: (d) => d.clicks },
    { id: 'ctr', label: 'CTR link', kind: 'pct', get: (d) => div(d.clicks, d.impressions) },
    { id: 'lpv', label: 'Landing page view', kind: 'count', get: (d) => d.lpv },
    { id: 'lpvRate', label: 'Tỉ lệ vào trang (LPV/click)', kind: 'pct', get: (d) => div(d.lpv, d.clicks) },
    { id: 'hookRate', label: 'Hook rate (3s / impr)', kind: 'pct', get: (d) => div(d.video3s, d.impressions) },
    { id: 'holdRate', label: 'Hold rate (ThruPlay / 3s)', kind: 'pct', get: (d) => div(d.thruplay, d.video3s) },
    { id: 'p50Rate', label: 'Xem 50% video (/ 3s)', kind: 'pct', get: (d) => div(d.videoP50 ?? 0, d.video3s) },
  ];
  if (!relative) {
    base.push({ id: 'cpm', label: 'CPM', kind: 'money', get: (d) => (d.impressions ? (d.spend / d.impressions) * 1000 : null) });
    base.push({ id: 'cpc', label: 'CPC', kind: 'money', get: (d) => div(d.spend, d.clicks) });
  }
  for (const s of steps.filter((x) => x.available)) {
    base.push({ id: `step:${s.key}`, label: s.label, kind: 'count', get: (d) => d.steps?.[s.key] ?? 0 });
    if (!relative) base.push({ id: `cost:${s.key}`, label: `Chi phí / ${s.label}`, kind: 'money', get: (d) => div(d.spend, d.steps?.[s.key] ?? 0) });
  }
  return base;
}

const fmt = (k: Kind, v: number | null) => (v === null ? DASH : k === 'money' ? fmtMoney(v) : k === 'pct' ? `${(v * 100).toFixed(1)}%` : fmtInt(v));

/** Biểu đồ theo ngày với chỉ số tùy chọn (tối đa 6), mỗi chỉ số chọn cột hoặc đường; lưu lựa chọn trên trình duyệt này. */
export function MetricChart({ daily, steps, primaryKey, storageKey, relative = false }: {
  daily: DayPoint[]; steps: ChartStep[]; primaryKey: string; storageKey: string; relative?: boolean;
}) {
  const catalog = useMemo(() => metricCatalog(steps, relative), [steps, relative]);
  const byId = useMemo(() => new Map(catalog.map((m) => [m.id, m])), [catalog]);
  const defaults: Pick[] = useMemo(() => {
    const cost = byId.has(`cost:${primaryKey}`) ? `cost:${primaryKey}` : byId.has(`step:${primaryKey}`) ? `step:${primaryKey}` : 'ctr';
    return [{ id: 'spend', type: 'bar' }, { id: cost, type: 'line' }];
  }, [byId, primaryKey]);
  const [picks, setPicks] = useState<Pick[]>(defaults);
  const [adding, setAdding] = useState('');

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`chart:${storageKey}`) || 'null') as Pick[] | null;
      if (Array.isArray(saved)) { const ok = saved.filter((p) => byId.has(p.id)).slice(0, MAX_SERIES); if (ok.length) setPicks(ok); }
    } catch { /* trình duyệt chặn lưu trữ → dùng mặc định */ }
  }, [storageKey, byId]);
  const save = (next: Pick[]) => { setPicks(next); try { localStorage.setItem(`chart:${storageKey}`, JSON.stringify(next)); } catch { /* bỏ qua */ } };

  const days = daily.filter((d) => d.spend > 0 || Object.values(d.steps ?? {}).some((v) => v > 0));
  const series = picks.map((p, i) => ({ ...p, def: byId.get(p.id)! })).filter((s) => s.def);
  const bars = series.filter((s) => s.type === 'bar');
  const lines = series.filter((s) => s.type === 'line');
  const color = (s: (typeof series)[number]) => (s.type === 'bar' ? BAR[bars.indexOf(s) % BAR.length] : LINE[lines.indexOf(s) % LINE.length]);

  const W = 760, H = 260, L = 52, R = 52, T = 14, B = 28;
  const bw = days.length ? (W - L - R) / days.length : 1;
  const x = (i: number) => L + i * bw + bw / 2;
  const maxOf = (s: (typeof series)[number]) => Math.max(...days.map((d) => s.def.get(d) ?? 0), 0) || 1;
  const y = (v: number, max: number) => T + (H - T - B) * (1 - v / max);
  const step = Math.max(1, Math.ceil(days.length / 10));
  const leftAxis = bars[0] ?? lines[0];
  const rightAxis = lines.find((l) => l !== leftAxis) ?? null;

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        {series.map((s) => (
          <span key={s.id} className="chip" style={{ borderColor: color(s), color: 'var(--text)', gap: 6 }}>
            <i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: s.type === 'bar' ? 2 : 999, background: color(s) }} />
            {s.def.label}
            <button type="button" title="Đổi dạng cột / đường" aria-label={`Đổi dạng của ${s.def.label}`}
              onClick={() => save(picks.map((p) => (p.id === s.id ? { ...p, type: p.type === 'bar' ? 'line' : 'bar' } : p)))}
              style={{ margin: 0, width: 'auto', padding: '0 6px', background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border-strong)', fontSize: 11 }}>
              {s.type === 'bar' ? '▮ cột' : '⟋ đường'}
            </button>
            {series.length > 1 && <button type="button" aria-label={`Bỏ ${s.def.label}`} onClick={() => save(picks.filter((p) => p.id !== s.id))}
              style={{ margin: 0, width: 'auto', padding: '0 4px', background: 'transparent', color: 'var(--muted)', border: 0, fontSize: 13 }}>×</button>}
          </span>
        ))}
        {picks.length < MAX_SERIES && (
          <select aria-label="Thêm chỉ số vào biểu đồ" value={adding} style={{ width: 'auto', padding: '3px 8px', fontSize: 12.5 }}
            onChange={(e) => { const id = e.target.value; if (id) save([...picks, { id, type: byId.get(id)?.kind === 'count' && !bars.length ? 'bar' : 'line' }]); setAdding(''); }}>
            <option value="">+ Thêm chỉ số ({picks.length}/{MAX_SERIES})</option>
            {catalog.filter((m) => !picks.some((p) => p.id === m.id)).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        )}
        <button type="button" className="ghost" onClick={() => save(defaults)} style={{ margin: 0, width: 'auto', padding: '3px 10px', fontSize: 12 }}>Mặc định</button>
      </div>

      {days.length === 0 ? <div className="empty">Chưa có dữ liệu theo ngày.</div> : (
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Biểu đồ theo ngày: ${series.map((s) => s.def.label).join(', ')}`}>
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={T + (H - T - B) * (1 - t)} y2={T + (H - T - B) * (1 - t)} stroke="#ffffff14" />
              {leftAxis && <text x={L - 6} y={T + (H - T - B) * (1 - t) + 4} textAnchor="end" fill={color(leftAxis)}>{fmt(leftAxis.def.kind, maxOf(leftAxis) * t)}</text>}
              {rightAxis && <text x={W - R + 6} y={T + (H - T - B) * (1 - t) + 4} fill={color(rightAxis)}>{fmt(rightAxis.def.kind, maxOf(rightAxis) * t)}</text>}
            </g>
          ))}
          <defs><pattern id="mc-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="#7c8cff66" /></pattern></defs>
          {days.map((d, i) => {
            const gw = (bw * 0.7) / Math.max(1, bars.length);
            return (
              <g key={d.date}>
                {bars.map((s, j) => {
                  const v = s.def.get(d) ?? 0; const max = maxOf(s);
                  return <rect key={s.id} x={x(i) - bw * 0.35 + j * gw} y={y(v, max)} width={Math.max(1, gw - 2)} height={Math.max(0, H - B - y(v, max))} rx={2}
                    fill={d.provisional && s.id === 'spend' ? 'url(#mc-hatch)' : `${color(s)}66`} stroke={color(s)} strokeWidth={d.provisional ? 1 : 0} />;
                })}
                {i % step === 0 && <text x={x(i)} y={H - 8} textAnchor="middle">{fmtDay(d.date)}</text>}
                <rect x={x(i) - bw / 2} y={T} width={bw} height={H - T - B} fill="transparent">
                  <title>{[`${d.date}${d.provisional ? ' (tạm tính)' : ''}`, ...series.map((s) => `${s.def.label}: ${fmt(s.def.kind, s.def.get(d))}`)].join('\n')}</title>
                </rect>
              </g>
            );
          })}
          {lines.map((s) => {
            const max = maxOf(s);
            let path = ''; let pen = false;
            days.forEach((d, i) => { const v = s.def.get(d); if (v === null) { pen = false; return; } path += `${pen ? 'L' : 'M'}${x(i)},${y(v, max)} `; pen = true; });
            return (
              <g key={s.id} pointerEvents="none">
                <path d={path} fill="none" stroke={color(s)} strokeWidth={2.5} strokeLinejoin="round" />
                {days.map((d, i) => { const v = s.def.get(d); return v === null ? null : <circle key={i} cx={x(i)} cy={y(v, max)} r={3.5} fill={color(s)} stroke="#0a0a0a" strokeWidth={1.5} />; })}
              </g>
            );
          })}
        </svg>
      )}
      <p className="note" style={{ margin: '6px 0 0', fontSize: 12 }}>Mỗi chỉ số có thang riêng; trục trái theo chỉ số đầu tiên, trục phải theo đường thứ hai. Rê chuột lên một ngày để xem đủ số.{days.some((d) => d.provisional) && ' ▨ = ngày tạm tính.'}</p>
    </div>
  );
}
