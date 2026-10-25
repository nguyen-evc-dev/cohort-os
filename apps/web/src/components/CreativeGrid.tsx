import type { ReactNode } from 'react';
import type { ConceptRow } from '@cohort/core';
import { fmtInt, fmtMoney, fmtRate } from '@/lib/format';

const STATUS = { green: 'Winner', red: 'Burner', yellow: 'Theo dõi', grey: 'Chưa đủ data' } as const;

/** Lưới thẻ creative theo concept (Design Proposal 4.2). Dùng chung cho Creative Vault và trang share. */
export function CreativeGrid({ concepts, thumbs, crmMode, extra }: {
  concepts: ConceptRow[];
  /** conceptKey → fileId Drive (ảnh phục vụ qua /api/thumb) */
  thumbs: Record<string, string>;
  crmMode: boolean;
  /** Phần thêm dưới mỗi thẻ (nút gắn ảnh — chỉ admin) */
  extra?: (c: ConceptRow) => ReactNode;
}) {
  return (
    <div className="vault">
      {concepts.map((c) => {
        const fileId = thumbs[c.conceptKey];
        const cpa = crmMode ? c.crm.cpaSeat : c.cpaReal;
        return (
          <article key={c.conceptKey} className={`cv ${c.light}`}>
            <div className="thumb">
              {fileId ? <img src={`/api/thumb/${fileId}`} alt={`Creative ${c.concept}`} loading="lazy" crossOrigin="anonymous" /> : <span aria-hidden>{c.format === 'video' ? '▶' : '▣'}</span>}
              <div className="pills">
                <span className="pill">● {c.format || '?'}</span>
                {c.stages.map((s) => <span key={s} className="pill">{s.replace('FU', '')}</span>)}
              </div>
            </div>
            <div className="body">
              <span className="status">{STATUS[c.light]}</span>
              <div className="nm" title={c.concept}>{c.concept}</div>
              <div className={`cap ${crmMode ? '' : 'metaonly'}`}>
                Đã tiêu: <b style={{ color: 'var(--meta)' }}>{fmtMoney(c.meta.spend)}</b>{' | '}
                {crmMode ? 'Mang về' : 'Kết quả'}: <b>{fmtInt(c.conversions)}{crmMode ? ' Seat' : ''}</b>{' | '}
                {crmMode ? 'CPA thực' : 'CPA'}: <b>{fmtMoney(cpa)}</b>
              </div>
              <div className="cap">{c.ads.length} ad · CTR {fmtRate(c.meta.ctr)} · CPM {fmtMoney(c.meta.cpm)}</div>
              {extra?.(c)}
              <div className="flip">
                <div style={{ color: 'var(--meta)' }}>Meta: {fmtInt(c.meta.leads)} lead · {fmtInt(c.meta.purchases)} purchase · CPA {fmtMoney(c.meta.cpaMeta)}</div>
                {crmMode && <div style={{ color: 'var(--crm)' }}>CRM: {fmtInt(c.crm.leads)} lead · {fmtInt(c.crm.seats)} seat · {fmtMoney(c.crm.revenue)}</div>}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
