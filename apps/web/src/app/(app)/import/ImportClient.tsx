'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { detectFileKind, parseCsv, prepareHubspotImport, type ImportFiles, type PreparedImport } from '@cohort/core';
import { fmtInt, fmtMoney, fmtDay, fmtPct } from '@/lib/format';
import { Banner, Chip, Tile } from '@/components/ui';
import { guessFormName } from '@/lib/import-helpers';
import { importCrm, type ImportResult } from './actions';

export interface KnownCampaign { id: string; name: string; spend: number; ownerProjectId: string | null; _last?: string }
interface Props {
  projects: { id: string; slug: string; name: string }[];
  forms: { form: string; projectId: string }[];
  campaigns: KnownCampaign[];
}
type Slot = 'submissions' | 'deals' | 'contacts';
interface Loaded { name: string; text: string }

const SLOT_LABEL: Record<Slot, string> = { submissions: '① Form submissions', deals: '② Deals', contacts: '③ Contacts (dự phòng)' };

export function ImportClient({ projects, forms, campaigns }: Props) {
  const [files, setFiles] = useState<Partial<Record<Slot, Loaded>>>({});
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [formName, setFormName] = useState('');
  const [addIds, setAddIds] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const prepared = useMemo<{ data: PreparedImport | null; error: string | null }>(() => {
    if (!files.submissions) return { data: null, error: null };
    try {
      const f: ImportFiles = { submissions: files.submissions.text, deals: files.deals?.text, contacts: files.contacts?.text };
      return { data: prepareHubspotImport(f), error: null };
    } catch (e) { return { data: null, error: (e as Error).message }; }
  }, [files]);

  async function addFiles(list: FileList | File[]) {
    setError(null); setResult(null);
    const next = { ...files };
    for (const f of Array.from(list)) {
      if (!/\.csv$/i.test(f.name)) { setError(`"${f.name}" không phải file .csv. Export HubSpot ở định dạng CSV và không mở bằng Excel.`); continue; }
      if (f.size > 25 * 1024 * 1024) { setError(`"${f.name}" quá lớn (> 25MB).`); continue; }
      const text = await f.text();
      const kind = detectFileKind(parseCsv(text).header);
      if (kind === 'unknown') { setError(`Không nhận ra file "${f.name}". Cần file Form submissions (có cột Conversion Page) hoặc Deals (có cột Deal Stage).`); continue; }
      next[kind] = { name: f.name, text };
      if (kind === 'submissions' && !formName) setFormName(guessFormName(f.name));
    }
    setFiles(next);
  }

  // Đã biết form này thuộc Project nào → tự chọn
  useEffect(() => {
    const hit = forms.find((x) => x.form === formName.trim());
    if (hit) setProjectId(hit.projectId);
  }, [formName, forms]);

  const known = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns]);
  const seen = prepared.data?.preview.campaigns_seen ?? [];
  // Mặc định tick các campaign tìm thấy mà chưa thuộc Project nào
  useEffect(() => {
    setAddIds(new Set(seen.filter((id) => known.has(id) && !known.get(id)!.ownerProjectId)));
  }, [prepared.data, known]); // eslint-disable-line react-hooks/exhaustive-deps

  const projectName = projects.find((p) => p.id === projectId)?.name;
  const t = prepared.data?.preview.totals;
  const canSubmit = !!prepared.data && !!projectId && formName.trim().length > 0 && !pending && !(result && result.ok);

  function submit() {
    if (!prepared.data) return;
    setResult(null);
    start(async () => {
      const res = await importCrm({
        project_id: projectId, form_name: formName.trim(), submissions: prepared.data!.submissions, deals: prepared.data!.deals,
        add_campaigns: [...addIds],
      });
      setResult(res);
    });
  }

  return (
    <>
      <details className="panel" style={{ marginBottom: 16 }} open={!files.submissions}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Cần export gì từ HubSpot? (checklist)</summary>
        <div className="grid g2" style={{ marginTop: 12 }}>
          <div><b>① Form submissions</b> <Chip tone="crm">bắt buộc</Chip>
            <p className="note" style={{ marginTop: 6 }}>Marketing → Forms → form của đợt → <b>Submissions</b> → Export (CSV). Cột app đọc: <span className="mono">Conversion ID · Conversion Date · Conversion Page · Contact ID</span>.</p></div>
          <div><b>② Deals</b> <Chip>nên có</Chip>
            <p className="note" style={{ marginTop: 6 }}>View “nguyen-coaching”, thêm cột <span className="mono">Associated Contact IDs</span>. App đọc: <span className="mono">Record ID · Deal Name* · Deal Stage · Amount · Create Date · Close Date</span>. (*chỉ đọc trên máy để nhận ra deal Webinar, không gửi đi.)</p></div>
        </div>
        <p className="note">⚠ <b>Không mở file bằng Excel</b> trước khi import (Contact ID bị đổi thành 2.57E+11 và không ghép được). Tên, email, SĐT, owner trong file sẽ <b>tự bị bỏ</b>.</p>
      </details>

      <div
        className="panel"
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files); }}
        style={{ borderStyle: 'dashed', borderColor: drag ? 'var(--crm)' : undefined, textAlign: 'center', padding: 28 }}
      >
        <p style={{ margin: '0 0 10px' }}>Kéo thả 1–3 file <b>.csv</b> vào đây, hoặc</p>
        <button className="ghost" style={{ width: 'auto', margin: 0, padding: '8px 18px' }} onClick={() => inputRef.current?.click()}>Chọn file…</button>
        <input ref={inputRef} type="file" accept=".csv,text/csv" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
          {(Object.keys(SLOT_LABEL) as Slot[]).map((s) => (
            <Chip key={s} tone={files[s] ? 'crm' : ''} title={files[s]?.name}>{files[s] ? '✓' : '○'} {SLOT_LABEL[s]}{files[s] ? ` · ${files[s]!.name.slice(0, 28)}` : ''}</Chip>
          ))}
        </div>
      </div>

      {error && <div style={{ marginTop: 12 }}><Banner tone="warn">⚠ {error}</Banner></div>}
      {prepared.error && <div style={{ marginTop: 12 }}><Banner tone="warn">⚠ {prepared.error}</Banner></div>}

      {prepared.data && t && (
        <>
          <h2 className="section-title">Xem trước <small>chưa gửi gì lên server</small></h2>
          <div className="grid g4">
            <Tile label="Lượt đăng ký (file)" value={fmtInt(prepared.data.fileRows.submissions)} tone="crm" box="crm" hint={`${fmtInt(t.unique_contacts)} contact duy nhất`} />
            <Tile label="Gắn được ad" value={fmtPct(t.unique_contacts ? (t.tracked_contacts / t.unique_contacts) * 100 : null)} tone="crm" box="crm" hint={`${fmtInt(t.tracked_contacts)} lead có h_ad_id`} />
            <Tile label="Deal" value={fmtInt(t.deals)} tone="crm" box="crm" hint={Object.entries(t.deals_by_type).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'} />
            <Tile label="Seat đã mua (ghép được)" value={`${t.won_seats_matched}/${t.won_seats}`} tone="crm" box="crm" hint={`Program ${t.won_programs_matched}/${t.won_programs}`} />
          </div>

          {prepared.data.warnings.map((w) => <div key={w} style={{ marginTop: 10 }}><Banner tone="warn">⚠ {w}</Banner></div>)}

          <div className="panel" style={{ marginTop: 16 }}>
            <div className="lbl">Đã bỏ qua {prepared.data.dropped.length} cột (không gửi đi)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {prepared.data.dropped.length === 0 && <span style={{ color: 'var(--muted)' }}>Không có cột thừa.</span>}
              {prepared.data.dropped.map((d, i) => <Chip key={`${d.file}-${d.column}-${i}`} tone={d.pii ? 'burn' : ''} title={`${d.file}${d.pii ? ' · thông tin cá nhân' : ''}`}>{d.pii ? '🛡 ' : ''}{d.column}</Chip>)}
            </div>
            <p className="note" style={{ marginTop: 8 }}>Dòng 🛡 đỏ là cột thông tin cá nhân (tên, email, SĐT, owner…): app không đọc và không lưu.</p>
          </div>

          <h2 className="section-title">Ghép vào Project</h2>
          <div className="panel">
            {projects.length === 0 ? (
              <p>Chưa có Project nào. <Link href="/projects" style={{ textDecoration: 'underline' }}>Tạo Project →</Link> rồi quay lại (file vẫn giữ trên trang này nếu anh mở tab mới để tạo).</p>
            ) : (
              <div className="form-grid">
                <div><label htmlFor="form">Tên form HubSpot</label><input id="form" value={formName} onChange={(e) => setFormName(e.target.value)} maxLength={200} placeholder="00_webinar_11_5_26" /></div>
                <div><label htmlFor="proj">Project</label>
                  <select id="proj" value={projectId} onChange={(e) => setProjectId(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              </div>
            )}
            <p className="note">Mỗi form thuộc đúng 1 Project. Lần sau gặp lại form này, app tự chọn đúng Project.</p>
          </div>

          <h2 className="section-title">Campaign Meta tìm thấy trong lead <small>{seen.length} campaign</small></h2>
          <div className="panel tight">
            <table className="data">
              <thead><tr><th className="l" style={{ cursor: 'default' }}>Campaign</th><th style={{ cursor: 'default' }}>Spend (Meta)</th><th className="l" style={{ cursor: 'default' }}>Trạng thái</th><th style={{ cursor: 'default' }}>Gán vào Project</th></tr></thead>
              <tbody>
                {seen.length === 0 && <tr><td className="l" colSpan={4} style={{ textAlign: 'center' }}>Không có campaign nào trong lead (chưa có tracking utm_id).</td></tr>}
                {seen.map((id) => {
                  const c = known.get(id);
                  const mine = c?.ownerProjectId === projectId;
                  const other = !!c?.ownerProjectId && !mine;
                  return (
                    <tr key={id}>
                      <td className="l" style={{ whiteSpace: 'normal' }}>{c?.name || <span className="mono">{id}</span>}<div className="mono" style={{ color: 'var(--faint)' }}>{id}</div></td>
                      <td className="n meta">{c ? fmtMoney(c.spend) : '—'}</td>
                      <td className="l">{!c ? <Chip tone="warn">ID lạ (không có trong dữ liệu Meta)</Chip> : mine ? <Chip tone="crm">đã thuộc Project này</Chip> : other ? <Chip>thuộc Project khác</Chip> : <Chip tone="meta">chưa gán</Chip>}</td>
                      <td className="n"><input type="checkbox" aria-label={`Gán campaign ${c?.name ?? id}`} disabled={!c || mine || other} checked={mine || addIds.has(id)}
                        onChange={(e) => setAddIds((s) => { const n = new Set(s); if (e.target.checked) n.add(id); else n.delete(id); return n; })} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h2 className="section-title">5 dòng mẫu <small>đã che mờ</small></h2>
          <div className="panel tight">
            <table className="data">
              <thead><tr><th className="l" style={{ cursor: 'default' }}>Conversion</th><th className="l" style={{ cursor: 'default' }}>Ngày</th><th className="l" style={{ cursor: 'default' }}>Contact</th><th className="l" style={{ cursor: 'default' }}>Ad</th><th className="l" style={{ cursor: 'default' }}>Placement</th><th className="l" style={{ cursor: 'default' }}>Nguồn</th></tr></thead>
              <tbody>
                {prepared.data.submissions.slice(0, 5).map((s) => (
                  <tr key={s.conversion_id}>
                    <td className="l mono">{s.conversion_id.slice(0, 6)}…</td><td className="l">{fmtDay(s.converted_on)}</td>
                    <td className="l mono">{s.contact_id ? `…${s.contact_id.slice(-4)}` : '—'}</td><td className="l mono">{s.ad_id ? `…${s.ad_id.slice(-6)}` : '—'}</td>
                    <td className="l mono">{s.placement ?? '—'}</td><td className="l"><Chip tone={s.source_hint === 'tracked' ? 'crm' : s.source_hint === 'direct' ? '' : 'warn'}>{s.source_hint}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 20, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" style={{ width: 'auto', padding: '10px 22px', margin: 0 }} disabled={!canSubmit} onClick={submit}>
              {pending ? 'Đang nhập…' : `Nhập vào ${projectName ?? 'Project'}`}
            </button>
            <span className="note" style={{ margin: 0 }}>Nhập lại cùng file là an toàn: lượt đăng ký và deal được ghi đè theo ID, không bị nhân đôi.</span>
          </div>
        </>
      )}

      {result && !result.ok && <div style={{ marginTop: 14 }}><Banner tone="warn">⚠ {result.error}</Banner></div>}
      {result && result.ok && (
        <div style={{ marginTop: 14 }}>
          <Banner tone="meta">
            <span className="ok">✓ Đã nhập {fmtInt(result.submissions)} lượt đăng ký và {fmtInt(result.deals)} deal vào <b>{result.projectName}</b>
              {result.campaignsAdded ? `, gán thêm ${result.campaignsAdded} campaign` : ''}.</span>{' '}
            <Link href={`/p/${result.slug}`} style={{ textDecoration: 'underline' }}>Mở báo cáo →</Link>
          </Banner>
        </div>
      )}
    </>
  );
}
