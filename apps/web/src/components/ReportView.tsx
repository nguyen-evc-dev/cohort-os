import type { ProjectReport } from '@cohort/core';
import { DASH, fmtInt, fmtMoney, fmtPct, fmtRoas } from '@/lib/format';
import { Chip, Tile, TruthGap } from '@/components/ui';
import { ReportTable } from '@/components/ReportTable';
import { MetricChart } from '@/components/MetricChart';

type Src = 'meta' | 'crm' | 'both';

/** "Check Out (điền form)" → nhãn chi phí: CPL nếu bước là lead / đăng ký, còn lại CPA. */
export function costLabel(stepLabel: string): string {
  return /lead|đăng ký|dang ky|form|regist|check ?out/i.test(stepLabel) ? 'CPL' : 'CPA';
}

/**
 * Thân báo cáo Project (đo theo mục tiêu): bước chính + chi phí → chuỗi bước → giá trị bước cuối → biểu đồ → bảng.
 * Dùng chung cho trang admin và trang share. `hideMoney`: số tiền đã bị bỏ khỏi dữ liệu.
 */
export function ReportView({ r, src, hideMoney = false, allowExport = true, fileName, storageKey }: {
  r: ProjectReport; src: Src; hideMoney?: boolean; allowExport?: boolean; fileName: string; storageKey: string;
}) {
  const showCrm = r.hasCrm && src !== 'meta';
  const showMeta = src !== 'crm';
  const p = r.primary;
  const pTone = p.kind === 'crm' ? 'crm' : 'meta';
  const others = r.steps.filter((s) => !s.isPrimary && !s.isFinal);
  const targetHit = p.target && p.cost !== null ? p.cost <= p.target : null;

  return (
    <>
      <div className="hero">
        <div className="panel hero-main">
          <div className="lbl">Chuyển đổi chính · {p.label}{p.fallback ? ' (tạm dùng bước Meta, chờ CRM)' : ''}</div>
          <div className={`hero-num ${pTone}`}>{fmtInt(p.value)}</div>
          <div className="hero-sub" style={{ fontSize: 15 }}>
            {costLabel(p.label)} <b className="tnum" style={{ color: `var(--${pTone})`, fontSize: 22 }}>{hideMoney ? DASH : fmtMoney(p.cost)}</b>
            {p.target && !hideMoney && <> · target {fmtMoney(p.target)} <Chip tone={targetHit ? 'crm' : 'burn'}>{targetHit ? 'đạt' : 'vượt target'}</Chip></>}
          </div>
        </div>
        <div className="tiles">
          <Tile label="Spend" value={hideMoney ? DASH : fmtMoney(r.total.meta.spend)} tone="meta" box="meta"
            hint={`${fmtInt(r.total.meta.impressions)} impr · CTR ${r.total.meta.ctr === null ? DASH : fmtPct(r.total.meta.ctr * 100)}`} />
          <Tile label={`Bước cuối · ${r.final.label}`} value={r.final.available ? fmtInt(r.final.count) : 'Chờ CRM'} tone={r.final.available ? 'crm' : ''} box="crm"
            hint={r.final.available ? <>{costLabel(r.final.label)} {fmtMoney(r.final.cost)} · giá trị {fmtMoney(r.final.value)}{r.final.roas !== null && <> · ROAS {fmtRoas(r.final.roas)}</>}</> : 'Import HubSpot để có số bước cuối'} />
          {others.slice(0, 2).map((s) => (
            <Tile key={s.key} label={s.label} value={s.available ? fmtInt(s.count) : 'Chờ CRM'} tone={s.available ? (s.source === 'crm' ? 'crm' : 'meta') : ''} box={s.source === 'crm' ? 'crm' : 'meta'}
              hint={s.available ? `${costLabel(s.label)} ${fmtMoney(s.cost)}${s.rateFromPrev !== null ? ` · ${fmtPct(s.rateFromPrev)} từ bước trước` : ''}` : undefined} />
          ))}
          {others.length < 2 && (
            <Tile label="CPM · CPC" value={hideMoney ? DASH : `${fmtMoney(r.total.meta.cpm)} · ${fmtMoney(r.total.meta.cpc)}`} tone="meta" box="meta"
              hint={r.total.meta.hookRate !== null ? `Hook rate ${fmtPct(r.total.meta.hookRate * 100)} · Hold ${r.total.meta.holdRate === null ? DASH : fmtPct(r.total.meta.holdRate * 100)}` : `LPV/click ${r.total.meta.lpvRate === null ? DASH : fmtPct(r.total.meta.lpvRate * 100)}`} />
          )}
        </div>
      </div>

      <h2 className="section-title">Chuỗi chuyển đổi <small>{r.goal.focus || (r.goalConfigured ? '' : 'mặc định: Lead / Purchase Meta → CRM')}</small></h2>
      <div className="panel tight chain" role="list">
        {r.steps.map((s) => (
          <div key={s.key} role="listitem" className={s.isPrimary ? 'main' : ''}>
            {s.rateFromPrev !== null && <span className="rate">{fmtPct(s.rateFromPrev)}</span>}
            <div className="lbl" style={{ marginBottom: 2 }}>{s.label}{s.isPrimary ? ' · chính' : s.isFinal ? ' · cuối' : ''}</div>
            <div className={`v ${s.available ? s.source : 'na'}`}>{s.available ? fmtInt(s.count) : DASH}</div>
            <div className="c">{s.available ? <>{costLabel(s.label)} {fmtMoney(s.cost)}{s.value ? <> · {fmtMoney(s.value)}</> : null}</> : 'Chờ CRM'}</div>
            <div className="c" style={{ color: 'var(--faint)' }}>{s.source === 'meta' ? 'Meta' : 'CRM'}</div>
          </div>
        ))}
      </div>

      {r.hasCrm && showCrm && showMeta && r.truthGap && (
        <div className="grid g2" style={{ marginTop: 16 }}>
          <TruthGap gap={r.truthGap} />
          <div className="panel" style={{ fontSize: 13 }}>
            <span className="lbl">Độ phủ tracking</span>
            <b className="tnum" style={{ fontSize: 22 }}>{fmtPct(r.trackedPct)}</b>
            <span style={{ color: 'var(--muted)' }}> lượt đăng ký gắn được ad (h_ad_id)</span>
            {r.unattributed.leadIds > 0 && <> · <Chip tone="warn">{r.unattributed.leadIds} lead unattributed</Chip></>}
          </div>
        </div>
      )}

      <h2 className="section-title">Theo ngày <small>{hideMoney ? 'spend là chỉ số tương đối (cao nhất = 100)' : 'giờ PT · chọn tối đa 6 chỉ số'}</small></h2>
      <div className="panel">
        <MetricChart daily={r.daily} steps={r.steps.map((s) => ({ key: s.key, label: s.label, source: s.source, available: s.available }))}
          primaryKey={p.key} storageKey={storageKey} relative={hideMoney} />
      </div>

      <h2 className="section-title">Campaign → Adset → Ad <small>Meta tự báo (slate) · CRM sự thật (lime) · Δ lệch (amber)</small></h2>
      {r.tree.length === 0
        ? <div className="panel empty"><h3>Không có chi tiêu trong khoảng này</h3><p>Thử chọn “30 ngày” hoặc “Tất cả”.</p></div>
        : <ReportTable tree={r.tree} total={r.total} unattributed={r.unattributed} hasCrm={r.hasCrm} src={src}
            steps={r.steps.map((s) => ({ key: s.key, label: s.label, source: s.source }))} primaryKey={p.key} finalKey={r.final.key}
            hasCompare={!!r.goal.compare} baselineCost={hideMoney ? null : (r.goal.target_cost ?? p.cost)} fileName={fileName} allowExport={allowExport && !hideMoney} />}

      {r.hasCrm && showCrm && r.placements.length > 0 && (
        <>
          <h2 className="section-title">Theo vị trí hiển thị <small>từ utm_medium · CRM</small></h2>
          <div className="panel tight">
            <table className="data">
              <thead><tr><th className="l" style={{ cursor: 'default' }}>Placement</th><th style={{ cursor: 'default' }}>Lượt đăng ký</th><th style={{ cursor: 'default' }}>% lead</th><th style={{ cursor: 'default' }}>Seat</th><th style={{ cursor: 'default' }}>Program</th></tr></thead>
              <tbody>
                {r.placements.map((pl) => (
                  <tr key={pl.placement}><td className="l mono">{pl.placement}</td><td className="n crm">{fmtInt(pl.leads)}</td><td className="n">{fmtPct(pl.sharePct)}</td><td className="n crm">{fmtInt(pl.seats)}</td><td className="n crm">{fmtInt(pl.programs)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
