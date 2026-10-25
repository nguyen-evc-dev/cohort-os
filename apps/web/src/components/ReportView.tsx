import type { ProjectReport } from '@cohort/core';
import { DASH, fmtInt, fmtMoney, fmtPct, fmtRoas } from '@/lib/format';
import { Chip, DailyChart, Funnel, Tile, TruthGap } from '@/components/ui';
import { ReportTable } from '@/components/ReportTable';

type Src = 'meta' | 'crm' | 'both';

/**
 * Thân báo cáo Project (hero → tile → Truth Gap → funnel → biểu đồ → bảng → placement).
 * Dùng chung cho trang admin và trang share (snapshot). `hideMoney`: số tiền đã bị bỏ khỏi dữ liệu, giao diện chỉ hiện tỉ lệ / số đếm.
 */
export function ReportView({ r, src, hideMoney = false, allowExport = true, fileName }: {
  r: ProjectReport; src: Src; hideMoney?: boolean; allowExport?: boolean; fileName: string;
}) {
  const showCrm = r.hasCrm && src !== 'meta';
  const showMeta = src !== 'crm';
  const crmMode = showCrm;

  const hero = crmMode
    ? { label: 'Cash ROAS (CRM)', value: fmtRoas(r.total.crm.cashRoas), cls: 'crm',
        sub: hideMoney ? <>Số tiền đã được ẩn</> : <>Doanh thu <b className="tnum" style={{ color: 'var(--crm)' }}>{fmtMoney(r.total.crm.revenue)}</b> trên spend <b className="tnum" style={{ color: 'var(--meta)' }}>{fmtMoney(r.total.meta.spend)}</b></> }
    : hideMoney
      ? { label: 'Kết quả Meta', value: fmtInt(r.primary.value), cls: 'meta', sub: <>lead + purchase Meta tự báo · số tiền đã được ẩn</> }
      : { label: 'Spend (Meta)', value: fmtMoney(r.total.meta.spend), cls: 'meta',
          sub: <>{fmtInt(r.primary.value)} {r.primary.kind === 'meta' ? 'kết quả Meta' : 'seat'} · chi phí/kết quả <b className="tnum">{fmtMoney(r.primary.cost)}</b></> };

  return (
    <>
      <div className="hero">
        <div className="panel hero-main">
          <div className="lbl">{hero.label}</div>
          <div className={`hero-num ${hero.cls} ${hero.value === DASH ? 'na' : ''}`}>{hero.value}</div>
          <div className="hero-sub">{hero.sub}</div>
        </div>
        <div className="tiles">
          {crmMode ? (
            <>
              <Tile label="Spend" value={fmtMoney(r.total.meta.spend)} tone="meta" box="meta" hint="Meta" />
              <Tile label="Revenue" value={fmtMoney(r.total.crm.revenue)} tone="crm" box="crm" hint={hideMoney ? undefined : `seat ${fmtMoney(r.total.crm.seatRevenue)} · program ${fmtMoney(r.total.crm.programRevenue)}`} />
              <Tile label="Seat · Program" value={`${fmtInt(r.total.crm.seats)} · ${fmtInt(r.total.crm.programs)}`} tone="crm" box="crm" hint={`${fmtInt(r.total.crm.leads)} lead (CRM)`} />
              <Tile label="CPA thực (seat)" value={fmtMoney(r.total.crm.cpaSeat)} tone="crm" box="crm" hint={r.total.meta.cpaMeta !== null ? `Meta báo ${fmtMoney(r.total.meta.cpaMeta)}` : undefined} />
            </>
          ) : (
            <>
              <Tile label="Lead (Meta)" value={fmtInt(r.total.meta.leads)} tone="meta" box="meta" hint={`CPL ${fmtMoney(r.total.meta.cpl)}`} />
              <Tile label="Purchase (Meta)" value={fmtInt(r.total.meta.purchases)} tone="meta" box="meta" hint={`CPA ${fmtMoney(r.total.meta.cpaMeta)}`} />
              <Tile label="CPM" value={fmtMoney(r.total.meta.cpm)} tone="meta" box="meta" hint={`${fmtInt(r.total.meta.impressions)} impressions`} />
              <Tile label="CTR link" value={r.total.meta.ctr === null ? DASH : fmtPct(r.total.meta.ctr * 100)} tone="meta" box="meta" hint={`${fmtInt(r.total.meta.clicks)} clicks`} />
            </>
          )}
        </div>
      </div>

      {r.hasCrm && showCrm && showMeta && r.truthGap && (
        <div className="grid g2" style={{ marginTop: 16 }}>
          <TruthGap gap={r.truthGap} />
          <div className="grid" style={{ gridTemplateRows: 'auto auto' }}>
            <Funnel f={r.funnel} />
            <div className="panel" style={{ fontSize: 13 }}>
              <span className="lbl">Độ phủ tracking</span>
              <b className="tnum" style={{ fontSize: 22 }}>{fmtPct(r.trackedPct)}</b>
              <span style={{ color: 'var(--muted)' }}> lượt đăng ký gắn được ad (h_ad_id)</span>
              {r.unattributed.leadIds > 0 && <> · <Chip tone="warn">{r.unattributed.leadIds} lead unattributed</Chip></>}
            </div>
          </div>
        </div>
      )}
      {r.hasCrm && showCrm && !showMeta && <div style={{ marginTop: 16 }}><Funnel f={r.funnel} /></div>}

      <h2 className="section-title">{hideMoney ? 'Xu hướng spend theo ngày' : 'Spend & chi phí theo ngày'} <small>{hideMoney ? 'chỉ số tương đối, ngày cao nhất = 100' : 'giờ PT'}</small></h2>
      <div className="panel"><DailyChart daily={r.daily} mode={crmMode ? 'crm' : 'meta'} relative={hideMoney} /></div>

      <h2 className="section-title">Campaign → Adset → Ad <small>Meta tự báo (slate) · CRM sự thật (lime) · Δ lệch (amber)</small></h2>
      {r.tree.length === 0
        ? <div className="panel empty"><h3>Không có chi tiêu trong khoảng này</h3><p>Thử chọn “30 ngày” hoặc “Tất cả”.</p></div>
        : <ReportTable tree={r.tree} total={r.total} unattributed={r.unattributed} hasCrm={r.hasCrm} src={src}
            baselineCost={hideMoney ? null : r.primary.cost} fileName={fileName} allowExport={allowExport && !hideMoney} />}

      {r.hasCrm && showCrm && r.placements.length > 0 && (
        <>
          <h2 className="section-title">Theo vị trí hiển thị <small>từ utm_medium · CRM</small></h2>
          <div className="panel tight">
            <table className="data">
              <thead><tr><th className="l" style={{ cursor: 'default' }}>Placement</th><th style={{ cursor: 'default' }}>Lượt đăng ký</th><th style={{ cursor: 'default' }}>% lead</th><th style={{ cursor: 'default' }}>Seat</th><th style={{ cursor: 'default' }}>Program</th></tr></thead>
              <tbody>
                {r.placements.map((p) => (
                  <tr key={p.placement}><td className="l mono">{p.placement}</td><td className="n crm">{fmtInt(p.leads)}</td><td className="n">{fmtPct(p.sharePct)}</td><td className="n crm">{fmtInt(p.seats)}</td><td className="n crm">{fmtInt(p.programs)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
