import type { ReactNode } from 'react';
import type { DayPoint, ProjectReport } from '@cohort/core';
import { DASH, fmtDay, fmtInt, fmtMoney, fmtPct } from '@/lib/format';

export type Tone = 'crm' | 'meta' | 'warn' | 'burn' | '';

export function Light({ c, label }: { c: 'red' | 'yellow' | 'green' | 'grey'; label?: string }) {
  const names = { red: 'Đỏ', yellow: 'Vàng', green: 'Xanh', grey: 'Chưa đủ dữ liệu' };
  return <span className={`light ${c}`} role="img" aria-label={label ?? names[c]} title={label ?? names[c]} />;
}

export function Chip({ tone = '', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`chip ${tone}`} title={title}>{children}</span>;
}

export function Tile({ label, value, tone = '', hint, box }: { label: string; value: ReactNode; tone?: Tone; hint?: ReactNode; box?: 'crm' | 'meta' }) {
  const na = value === DASH;
  return (
    <div className={`tile ${box ?? ''}`}>
      <div className="lbl" style={{ marginBottom: 2 }}>{label}</div>
      <div className={`v ${na ? 'na' : tone}`}>{value}</div>
      {hint && <div className="h">{hint}</div>}
    </div>
  );
}

export function PageHead({ title, meta, right }: { title: string; meta?: ReactNode; right?: ReactNode }) {
  return (
    <div className="pagehead">
      <h1>{title}</h1>
      {meta && <span className="meta">{meta}</span>}
      <span style={{ flex: 1 }} />
      {right}
    </div>
  );
}

export function Banner({ tone = '', children }: { tone?: 'warn' | 'meta' | ''; children: ReactNode }) {
  return <div className={`banner ${tone}`} role="note">{children}</div>;
}

/** Truth Gap: Meta báo vs CRM ghi nhận (slate vs lime, amber khi lệch). */
export function TruthGap({ gap }: { gap: NonNullable<ProjectReport['truthGap']> }) {
  const max = Math.max(gap.metaPurchases, gap.crmSeats, 1);
  const over = gap.overreportPct;
  return (
    <div className="panel">
      <div className="lbl">Truth Gap · Meta tự báo vs CRM</div>
      <div className="gap" style={{ marginTop: 8 }}>
        <div className="gap-row"><span style={{ color: 'var(--meta)' }}>Meta</span>
          <div className="bar"><i className="meta" style={{ width: `${(gap.metaPurchases / max) * 100}%` }} /></div><b className="tnum">{fmtInt(gap.metaPurchases)}</b></div>
        <div className="gap-row"><span style={{ color: 'var(--crm)' }}>CRM</span>
          <div className="bar"><i className="crm" style={{ width: `${(gap.crmSeats / max) * 100}%` }} /></div><b className="tnum">{fmtInt(gap.crmSeats)}</b></div>
      </div>
      <p className="gap-note" style={{ margin: '12px 0 0' }}>
        Meta báo <b style={{ color: 'var(--meta)' }}>{gap.metaPurchases}</b> purchase · CRM ghi nhận <b style={{ color: 'var(--crm)' }}>{gap.crmSeats}</b> seat
        {over !== null && <> · {over > 0 ? 'Over-report ' : 'Under-report '}<Chip tone={Math.abs(over) > 30 ? 'warn' : ''}>{over > 0 ? '▲' : '▼'} {fmtPct(Math.abs(over))}</Chip></>}
      </p>
    </div>
  );
}

export function Funnel({ f }: { f: ProjectReport['funnel'] }) {
  return (
    <div className="panel tight funnel">
      <div><div className="lbl">Lead (CRM)</div><div className="v" style={{ color: 'var(--crm)' }}>{fmtInt(f.leads)}</div></div>
      <div><div className="lbl">Seat</div><div className="v" style={{ color: 'var(--crm)' }}>{fmtInt(f.seats)}</div><div className="arrow">↳ {fmtPct(f.leadToSeatPct)} của lead</div></div>
      <div><div className="lbl">Program</div><div className="v" style={{ color: 'var(--crm)' }}>{fmtInt(f.programs)}</div><div className="arrow">↳ {fmtPct(f.seatToProgramPct)} của seat</div></div>
    </div>
  );
}

/** Biểu đồ theo ngày: cột = spend (Meta), đường = chi phí / kết quả (CPL Meta hoặc CPA seat). SVG thuần, render phía server. */
export function DailyChart({ daily, mode, relative = false }: { daily: DayPoint[]; mode: 'meta' | 'crm'; relative?: boolean }) {
  const days = daily.filter((d) => d.spend > 0 || d.crmLeads > 0);
  if (days.length < 1) return <div className="empty">Chưa có dữ liệu theo ngày.</div>;
  const W = 720, H = 220, L = 44, R = 44, T = 14, B = 28;
  const maxSpend = Math.max(...days.map((d) => d.spend), 1);
  const cost = (d: DayPoint) => {
    const conv = mode === 'crm' ? d.seats : d.leadsMeta + d.purchasesMeta;
    return conv > 0 ? d.spend / conv : null;
  };
  const costs = days.map(cost);
  const maxCost = Math.max(...(costs.filter((c): c is number => c !== null)), 1);
  const bw = (W - L - R) / days.length;
  const x = (i: number) => L + i * bw + bw / 2;
  const yS = (v: number) => T + (H - T - B) * (1 - v / maxSpend);
  const yC = (v: number) => T + (H - T - B) * (1 - v / maxCost);
  const pts = costs.map((c, i) => (c === null ? null : [x(i), yC(c)] as const));
  const path = pts.reduce<string>((s, p, i) => (p ? `${s}${s && pts[i - 1] ? 'L' : 'M'}${p[0]},${p[1]} ` : s), '');
  const color = 'var(--crm)'; // lime: đường chi phí luôn nổi bật trên nền cột slate
  const step = Math.max(1, Math.ceil(days.length / 8));
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Spend và chi phí theo ngày">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={yS(maxSpend * t)} y2={yS(maxSpend * t)} stroke="#ffffff14" />
            {!relative && <text x={L - 6} y={yS(maxSpend * t) + 4} textAnchor="end">{fmtMoney(maxSpend * t)}</text>}
            {!relative && <text x={W - R + 6} y={yC(maxCost * t) + 4}>{fmtMoney(maxCost * t)}</text>}
          </g>
        ))}
        {days.map((d, i) => (
          <g key={d.date}>
            <rect x={x(i) - bw * 0.3} y={yS(d.spend)} width={bw * 0.6} height={Math.max(0, H - B - yS(d.spend))} rx={2}
              fill={d.provisional ? 'url(#hatch)' : '#7c8cff55'} stroke="#7c8cff" strokeWidth={d.provisional ? 1 : 0}>
              <title>{`${d.date}: ${relative ? `chỉ số ${Math.round(d.spend)}` : fmtMoney(d.spend)}${d.provisional ? ' (tạm tính)' : ''}`}</title>
            </rect>
            {i % step === 0 && <text x={x(i)} y={H - 8} textAnchor="middle">{fmtDay(d.date)}</text>}
          </g>
        ))}
        <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="#7c8cff55" /></pattern></defs>
        {path && <path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />}
        {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={4} fill={color} stroke="#0a0a0a" strokeWidth={1.5}><title>{relative ? days[i].date : `${days[i].date}: ${fmtMoney(costs[i])}`}</title></circle>)}
      </svg>
      <div className="legend">
        <span><i style={{ background: '#7c8cff55', border: '1px solid #7c8cff' }} />Spend / ngày (Meta)</span>
        <span><i style={{ background: color }} />{mode === 'crm' ? 'CPA seat (CRM)' : 'Chi phí / kết quả (Meta)'}</span>
        {days.some((d) => d.provisional) && <span>▨ Ngày tạm tính</span>}
      </div>
    </div>
  );
}
