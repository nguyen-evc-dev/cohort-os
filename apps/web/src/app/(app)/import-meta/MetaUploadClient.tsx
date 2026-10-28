'use client';
import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { readTable } from '@cohort/core';
import { fmtDay, fmtInt, fmtMoney } from '@/lib/format';
import { Banner, Chip, Tile } from '@/components/ui';
import { importMetaReport, previewMetaReport, type ImportMetaResult, type MetaPreview } from './actions';

interface Props { projects: { id: string; slug: string; name: string }[] }

const REQUIRED_COLS = ['Day (breakdown theo ngày)', 'Campaign ID', 'Ad set ID', 'Ad ID', 'Campaign name', 'Ad set name', 'Ad name', 'Amount spent', 'Impressions'];
const OPTIONAL_COLS = ['Reach', 'Frequency', 'Link clicks', 'Website landing page views', '3-second video plays', '15-second ThruPlays', 'Video plays at 25% / 50% / 75% / 100%', 'Purchases', 'Leads', 'các cột custom conversion (vd WBN1126 - Check Out, WBN1126 - Purchased)'];

export function MetaUploadClient({ projects }: Props) {
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);
  const [preview, setPreview] = useState<MetaPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [assign, setAssign] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ImportMetaResult | null>(null);
  const [pending, start] = useTransition();
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load(file: File) {
    setError(null); setResult(null); setPreview(null); setTable(null);
    if (file.size > 20 * 1024 * 1024) { setError('File quá lớn (> 20MB).'); return; }
    let t: string[][];
    try { t = readTable(new Uint8Array(await file.arrayBuffer()), file.name); } catch (e) { setError((e as Error).message); return; }
    setFileName(file.name); setTable(t);
    start(async () => {
      const res = await previewMetaReport(t, projectId || null);
      if (!res.ok) { setError(res.error); return; }
      setPreview(res.preview);
      const suggested = res.preview.suggestedProjectId && projects.some((p) => p.id === res.preview.suggestedProjectId) ? res.preview.suggestedProjectId : projectId;
      setProjectId(suggested);
      setAssign(new Set(res.preview.campaigns.filter((c) => c.owner === 'none').map((c) => c.id)));
    });
  }

  function refreshPreview(nextProject: string) {
    setProjectId(nextProject);
    if (!table) return;
    start(async () => { const res = await previewMetaReport(table, nextProject); if (res.ok) setPreview(res.preview); });
  }

  function submit() {
    if (!table || !preview?.ok) return;
    setResult(null);
    start(async () => { setResult(await importMetaReport({ project_id: projectId, table, assign: [...assign], file_name: fileName })); });
  }

  const p = preview;
  const spendMatches = p && p.fileTotals.spend !== null && Math.abs(p.totals.spend - p.fileTotals.spend) <= Math.max(0.05, p.fileTotals.spend * 0.005);
  const canSubmit = !!p?.ok && !!projectId && !pending && !(result && result.ok);
  const projectName = projects.find((x) => x.id === projectId)?.name;

  return (
    <>
      <details className="panel" style={{ marginBottom: 16 }} open={!p}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Xuất report từ Ads Manager thế nào? (checklist)</summary>
        <p className="note" style={{ marginTop: 10 }}>Ads Manager → <b>Reports</b> → mở report của đợt → bật <b>Breakdown theo Day</b> và các cột bên dưới → <b>Export</b> (.xlsx hoặc .csv). Chỉ xuất file, không sửa gì trên tài khoản quảng cáo. Lưu file vào thư mục <span className="mono">reports-raw</span>.</p>
        <div className="grid g2" style={{ marginTop: 12 }}>
          <div><b>Bắt buộc</b> <Chip tone="crm">cần đủ</Chip>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>{REQUIRED_COLS.map((c) => <Chip key={c} tone="meta">{c}</Chip>)}</div>
            <p className="note" style={{ marginTop: 8 }}>Cần <b>ID</b> vì CRM ghép lead với ad bằng ID (tên ad đổi / trùng). Cần <b>Day</b> để vẽ biểu đồ và so với CRM theo ngày.</p></div>
          <div><b>Nên có</b> <Chip>tùy chọn</Chip>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>{OPTIONAL_COLS.map((c) => <Chip key={c}>{c}</Chip>)}</div>
            <p className="note" style={{ marginTop: 8 }}>Cột custom conversion nhận theo <b>tên</b>, phải có trong danh mục (trang Project → khai báo mục tiêu).</p></div>
        </div>
      </details>

      <div
        className="panel"
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void load(f); }}
        style={{ borderStyle: 'dashed', borderColor: drag ? 'var(--crm)' : undefined, textAlign: 'center', padding: 28 }}
      >
        <p style={{ margin: '0 0 10px' }}>Kéo thả 1 file <b>.xlsx</b> hoặc <b>.csv</b> vào đây, hoặc</p>
        <button className="ghost" style={{ width: 'auto', margin: 0, padding: '8px 18px' }} onClick={() => inputRef.current?.click()}>Chọn file…</button>
        <input ref={inputRef} type="file" accept=".xlsx,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = ''; }} />
        {fileName && <div style={{ marginTop: 12 }}><Chip tone={p?.ok ? 'crm' : p ? 'warn' : ''}>{p?.ok ? '✓' : '○'} {fileName.slice(0, 48)}</Chip></div>}
      </div>

      {pending && !p && <div style={{ marginTop: 12 }}><Banner tone="meta"><span>Đang kiểm tra file…</span></Banner></div>}
      {error && <div style={{ marginTop: 12 }}><Banner tone="warn">⚠ {error}</Banner></div>}

      {p && !p.ok && (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <Banner tone="warn"><span><b>Chưa nạp được file này.</b> Sửa rồi xuất lại:</span></Banner>
          {p.problems.map((x) => <Banner key={x} tone="warn"><span>⚠ {x}</span></Banner>)}
        </div>
      )}

      {p && p.ok && (
        <>
          <h2 className="section-title">Xem trước <small>chưa ghi gì vào DB</small></h2>
          <div className="grid g4">
            <Tile label="Dòng ad × ngày" value={fmtInt(p.adRows)} tone="meta" box="meta" hint={`${fmtInt(p.days)} ngày · ${p.dateFrom ? fmtDay(p.dateFrom) : '—'} → ${p.dateTo ? fmtDay(p.dateTo) : '—'}`} />
            <Tile label="Chi tiêu" value={fmtMoney(p.totals.spend)} tone="meta" box="meta"
              hint={p.fileTotals.spend === null ? 'File không có dòng tổng' : spendMatches ? `✓ khớp dòng tổng của file (${fmtMoney(p.fileTotals.spend)})` : `lệch dòng tổng ${fmtMoney(p.fileTotals.spend)}`} />
            <Tile label="Ghi đè / thêm mới" value={`${fmtInt(p.overlap.existingRows)} / ${fmtInt(p.overlap.newRows)}`} tone="meta" box="meta"
              hint={p.overlap.existingRows ? `phần ghi đè: ${fmtMoney(p.overlap.existingSpend)} → ${fmtMoney(p.overlap.uploadSpend)}` : 'chưa có số trùng trong DB'} />
            <Tile label="Custom conversion" value={p.customUsed.length ? fmtInt(p.customUsed.reduce((s, c) => s + c.total, 0)) : '—'} tone="meta" box="meta"
              hint={p.customUsed.map((c) => `${c.name} ${fmtInt(c.total)}`).join(' · ') || 'file không có cột custom conversion'} />
          </div>

          {p.warnings.map((w) => <div key={w} style={{ marginTop: 10 }}><Banner tone="warn">⚠ {w}</Banner></div>)}

          <h2 className="section-title">Ghép vào Project</h2>
          <div className="panel">
            {projects.length === 0
              ? <p>Chưa có Project nào. <Link href="/projects" style={{ textDecoration: 'underline' }}>Tạo Project →</Link></p>
              : (
                <div className="form-grid">
                  <div><label htmlFor="proj">Project</label>
                    <select id="proj" value={projectId} onChange={(e) => refreshPreview(e.target.value)}>{projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
                </div>
              )}
            <p className="note">Số Meta là số của cả tài khoản (theo ad × ngày). Việc “ghép vào Project” là gán các campaign trong file vào Project để báo cáo của Project tính đúng. Campaign đã thuộc Project khác sẽ không bị chuyển.</p>
          </div>

          <h2 className="section-title">Campaign trong file <small>{p.campaigns.length} campaign</small></h2>
          <div className="panel tight">
            <table className="data">
              <thead><tr><th className="l" style={{ cursor: 'default' }}>Campaign</th><th style={{ cursor: 'default' }}>Spend</th><th style={{ cursor: 'default' }}>Dòng</th><th className="l" style={{ cursor: 'default' }}>Trạng thái</th><th style={{ cursor: 'default' }}>Gán vào Project</th></tr></thead>
              <tbody>
                {p.campaigns.map((c) => (
                  <tr key={c.id}>
                    <td className="l" style={{ whiteSpace: 'normal' }}>{c.name || <span className="mono">{c.id}</span>}<div className="mono" style={{ color: 'var(--faint)' }}>{c.id}</div></td>
                    <td className="n meta">{fmtMoney(c.spend)}</td>
                    <td className="n">{fmtInt(c.adRows)}</td>
                    <td className="l">{c.owner === 'this' ? <Chip tone="crm">đã thuộc Project này</Chip> : c.owner === 'other' ? <Chip>thuộc {c.ownerName ?? 'Project khác'}</Chip> : <Chip tone="meta">chưa gán</Chip>}</td>
                    <td className="n"><input type="checkbox" aria-label={`Gán campaign ${c.name || c.id}`} disabled={c.owner !== 'none'} checked={c.owner === 'this' || assign.has(c.id)}
                      onChange={(e) => setAssign((s) => { const n = new Set(s); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 20, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" style={{ width: 'auto', padding: '10px 22px', margin: 0 }} disabled={!canSubmit} onClick={submit}>
              {pending ? 'Đang nhập…' : `Nhập vào ${projectName ?? 'Project'}`}
            </button>
            <span className="note" style={{ margin: 0 }}>Nhập lại cùng file là an toàn: số được ghi đè theo (ngày, ad), không nhân đôi.</span>
          </div>
        </>
      )}

      {result && !result.ok && <div style={{ marginTop: 14 }}><Banner tone="warn">⚠ {result.error}</Banner></div>}
      {result && result.ok && (
        <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
          <Banner tone="meta">
            <span className="ok">✓ Đã nhập {fmtInt(result.rows)} dòng ({fmtDay(result.dateFrom)} → {fmtDay(result.dateTo)}) vào <b>{result.projectName}</b>
              {result.actions ? `, ${fmtInt(result.actions)} chuyển đổi custom` : ''}{result.campaignsAdded ? `, gán thêm ${result.campaignsAdded} campaign` : ''}.</span>{' '}
            <Link href={`/p/${result.slug}`} style={{ textDecoration: 'underline' }}>Mở báo cáo →</Link>
          </Banner>
          {result.warnings.map((w) => <Banner key={w} tone="warn"><span>⚠ {w}</span></Banner>)}
          <span className="note">Đèn RYG tính lại ở lần sync kế tiếp, hoặc chạy <span className="mono">npm run sync:signals</span> trên máy.</span>
        </div>
      )}
    </>
  );
}
