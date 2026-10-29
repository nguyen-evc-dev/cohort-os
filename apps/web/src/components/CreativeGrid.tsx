import type { ReactNode } from 'react';
import type { ConceptRow, StepSummary } from '@cohort/core';
import { fmtInt, fmtMoney, fmtRate } from '@/lib/format';
import { thumbSrc } from '@/lib/drive';

const STATUS = { green: 'Winner', red: 'Burner', yellow: 'Theo dõi', grey: 'Chưa đủ data' } as const;

/** Lưới thẻ creative theo concept (Design Proposal 4.2). Dùng chung cho Creative Vault và trang share. */
export function CreativeGrid({ concepts, thumbs, crmMode, extra, primaryLabel, steps }: {
  concepts: ConceptRow[];
  /** conceptKey → khóa ảnh bìa: fileId Drive (/api/thumb) hoặc "s~<mã>" ảnh chụp prnt.sc (/api/shot) */
  thumbs: Record<string, string>;
  crmMode: boolean;
  /** Tên bước chính của mục tiêu (vd "Purchased (mua vé)") */
  primaryLabel: string;
  steps: StepSummary[];
  /** Phần thêm dưới mỗi thẻ (nút gắn ảnh — chỉ admin) */
  extra?: (c: ConceptRow) => ReactNode;
}) {
  return (
    <div className="vault">
      {concepts.map((c) => {
        const fileId = thumbs[c.conceptKey];
        const cpa = c.cpaReal;
        return (
          <article key={c.conceptKey} className={`cv ${c.light}`}>
            <div className="thumb">
              {fileId ? <img src={thumbSrc(fileId)} alt={`Creative ${c.concept}`} loading="lazy" crossOrigin="anonymous" /> : <span aria-hidden>{c.format === 'video' ? '▶' : '▣'}</span>}
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
                {primaryLabel}: <b>{fmtInt(c.conversions)}</b>{' | '}
                CPA: <b>{fmtMoney(cpa)}</b>
              </div>
              <div className="cap">{c.ads.length} ad · CTR {fmtRate(c.meta.ctr)} · CPM {fmtMoney(c.meta.cpm)}</div>
              {extra?.(c)}
              <div className="flip">
                {steps.filter((s) => s.available && (crmMode || s.source === 'meta')).map((s) => (
                  <div key={s.key} style={{ color: s.source === 'crm' ? 'var(--crm)' : 'var(--meta)' }}>{s.label}: {fmtInt(c.steps[s.key]?.count ?? 0)} · {fmtMoney(c.steps[s.key]?.cost ?? null)}</div>
                ))}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
