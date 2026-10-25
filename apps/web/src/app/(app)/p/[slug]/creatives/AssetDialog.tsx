'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { parseAssetLink } from '@/lib/drive';
import { removeAsset, saveAsset, type AssetState } from './actions';

interface Props {
  conceptKey: string;
  conceptName: string;
  ads: { id: string; name: string }[];
  existing: { id: string; scope: string; fileId: string | null; postUrl: string | null } | null;
  /** Stage đã gắn tay (TOFU/MOFU/BOFU) hoặc null = tự nhận theo tên ad */
  stage: string | null;
  /** Stage hiện đang hiển thị cho concept này (đã gồm nhãn tay nếu có) */
  currentStages: string[];
  /** false khi migration creative_stage chưa được đẩy lên DB */
  stageReady: boolean;
}

const label = (s: string) => s.replace('FU', '');

/** Hộp thoại gắn ảnh (link Drive / bài đăng) và stage thủ công cho 1 concept hoặc 1 ad. */
export function AssetDialog({ conceptKey, conceptName, ads, existing, stage, currentStages, stageReady }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [link, setLink] = useState('');
  const [scope, setScope] = useState<'concept' | 'ad'>('concept');
  const [stageVal, setStageVal] = useState(stage ?? 'AUTO');
  const [broken, setBroken] = useState(false);
  const [state, action, pending] = useActionState<AssetState, FormData>(saveAsset, { ok: false, message: '' });
  const parsed = link ? parseAssetLink(link) : null;
  const stageChanged = stageVal !== (stage ?? 'AUTO');

  useEffect(() => { if (state.ok) { ref.current?.close(); setLink(''); } }, [state]);
  useEffect(() => { setBroken(false); }, [link]);
  useEffect(() => { setStageVal(stage ?? 'AUTO'); }, [stage]);

  const canSave = !pending && parsed?.kind !== 'error' && (!!link || stageChanged);

  return (
    <>
      <button type="button" className="ghost" style={{ margin: '4px 0 0', padding: '4px 8px', fontSize: 12, width: 'auto' }} onClick={() => ref.current?.showModal()}>
        {existing ? '🖼 Sửa ảnh / stage' : '🖼 Gắn ảnh / stage'}
      </button>
      <dialog ref={ref} aria-label={`Gắn ảnh và stage cho ${conceptName}`} style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: 20, width: 'min(480px, 92vw)' }}>
        <form action={action}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18 }}>Gắn ảnh cho “{conceptName}”</h3>
          <p className="note" style={{ margin: '0 0 12px' }}>Dán link file Drive (chia sẻ “Bất kỳ ai có đường liên kết”) hoặc link bài đăng Facebook / Instagram. Để trống nếu chỉ muốn gắn stage.</p>
          <input type="hidden" name="concept_key" value={conceptKey} />
          <input type="hidden" name="stage_edit" value={stageChanged ? '1' : '0'} />
          <label htmlFor={`l-${conceptKey}`}>Link</label>
          <input id={`l-${conceptKey}`} name="link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/file/d/…/view" autoComplete="off" />
          {parsed?.kind === 'error' && <p className="err" style={{ margin: '8px 0 0', fontSize: 13 }}>{parsed.message}</p>}
          {parsed?.kind === 'drive' && (
            <div style={{ marginTop: 10 }}>
              {broken
                ? <p className="err" style={{ fontSize: 13, margin: 0 }}>Không tải được ảnh. Mở file trong Drive → Chia sẻ → “Bất kỳ ai có đường liên kết” (người xem), rồi dán lại.</p>
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={`/api/thumb/${parsed.fileId}`} alt="Xem thử" onError={() => setBroken(true)} style={{ maxHeight: 180, maxWidth: '100%', borderRadius: 6, border: '1px solid var(--border)' }} />}
            </div>
          )}
          {parsed?.kind === 'post' && <p className="note" style={{ margin: '8px 0 0' }}>Link bài đăng sẽ hiện nút “Xem post”. Facebook không cho lấy ảnh tự động nên thẻ vẫn dùng ảnh mặc định.</p>}

          <div className="form-grid" style={{ marginTop: 12 }}>
            <div><label htmlFor={`s-${conceptKey}`}>Áp dụng cho</label>
              <select id={`s-${conceptKey}`} name="scope" value={scope} onChange={(e) => setScope(e.target.value as 'concept' | 'ad')}>
                <option value="concept">Cả concept (mọi ad cùng concept)</option><option value="ad">Chỉ 1 ad</option></select></div>
            {scope === 'ad' && (
              <div><label htmlFor={`a-${conceptKey}`}>Ad</label>
                <select id={`a-${conceptKey}`} name="ad_id">{ads.map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}</select></div>
            )}
            <div><label htmlFor={`g-${conceptKey}`}>Stage funnel</label>
              <select id={`g-${conceptKey}`} name="stage" value={stageVal} onChange={(e) => setStageVal(e.target.value)} disabled={!stageReady}>
                <option value="AUTO">Tự động (theo tên ad)</option>
                <option value="TOFU">TOF · tệp lạnh</option>
                <option value="MOFU">MOF · tệp ấm</option>
                <option value="BOFU">BOF · sẵn sàng mua</option>
              </select></div>
          </div>
          <p className="note" style={{ margin: '6px 0 0', fontSize: 12 }}>
            {stageReady
              ? <>Hiện đang hiển thị: <b>{currentStages.length ? currentStages.map(label).join(', ') : 'chưa có stage (tên ad không có TOF / MOF / BOF)'}</b>. Nhãn gắn tay ghi đè nhãn tự nhận, và áp dụng cho báo cáo, lọc stage và nhận định AI.</>
              : <>Cần đẩy migration trước khi gắn stage: <span className="mono">npx supabase db push --linked</span>.</>}
          </p>
          <label htmlFor={`n-${conceptKey}`} style={{ marginTop: 12 }}>Ghi chú (tùy chọn)</label>
          <input id={`n-${conceptKey}`} name="notes" maxLength={1000} placeholder="vd: bản cắt 15s, hook câu hỏi" />

          {state.message && <p className={state.ok ? 'ok' : 'err'} style={{ margin: '10px 0 0', fontSize: 13 }}>{state.message}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button type="submit" disabled={!canSave} style={{ margin: 0 }}>{pending ? 'Đang lưu…' : 'Lưu'}</button>
            <button type="button" className="ghost" style={{ margin: 0 }} onClick={() => ref.current?.close()}>Đóng</button>
          </div>
        </form>
        {existing && (
          <form action={removeAsset} style={{ marginTop: 10 }}>
            <input type="hidden" name="id" value={existing.id} />
            <button type="submit" className="ghost" style={{ margin: 0, width: 'auto', padding: '4px 10px', fontSize: 12, color: 'var(--burn)' }}>Gỡ ảnh và stage đang gắn</button>
          </form>
        )}
      </dialog>
    </>
  );
}
