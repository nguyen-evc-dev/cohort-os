'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import { parseAssetLink } from '@/lib/drive';
import { removeAsset, saveAsset, type AssetState } from './actions';

interface Props {
  conceptKey: string;
  conceptName: string;
  ads: { id: string; name: string }[];
  existing: { id: string; scope: string; fileId: string | null; postUrl: string | null } | null;
}

/** Hộp thoại gắn link Drive / bài đăng cho 1 concept (hoặc 1 ad). Có xem thử ảnh trước khi lưu. */
export function AssetDialog({ conceptKey, conceptName, ads, existing }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [link, setLink] = useState('');
  const [scope, setScope] = useState<'concept' | 'ad'>('concept');
  const [broken, setBroken] = useState(false);
  const [state, action, pending] = useActionState<AssetState, FormData>(saveAsset, { ok: false, message: '' });
  const parsed = link ? parseAssetLink(link) : null;

  useEffect(() => { if (state.ok) { ref.current?.close(); setLink(''); } }, [state]);
  useEffect(() => { setBroken(false); }, [link]);

  return (
    <>
      <button type="button" className="ghost" style={{ margin: '4px 0 0', padding: '4px 8px', fontSize: 12, width: 'auto' }} onClick={() => ref.current?.showModal()}>
        {existing ? '🖼 Đổi ảnh' : '🖼 Gắn ảnh / link'}
      </button>
      <dialog ref={ref} aria-label={`Gắn ảnh cho ${conceptName}`} style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: 20, width: 'min(480px, 92vw)' }}>
        <form action={action}>
          <h3 style={{ margin: '0 0 4px', fontSize: 18 }}>Gắn ảnh cho “{conceptName}”</h3>
          <p className="note" style={{ margin: '0 0 12px' }}>Dán link file Drive (chia sẻ “Bất kỳ ai có đường liên kết”) hoặc link bài đăng Facebook / Instagram.</p>
          <input type="hidden" name="concept_key" value={conceptKey} />
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
          </div>
          <label htmlFor={`n-${conceptKey}`} style={{ marginTop: 12 }}>Ghi chú (tùy chọn)</label>
          <input id={`n-${conceptKey}`} name="notes" maxLength={1000} placeholder="vd: bản cắt 15s, hook câu hỏi" />

          {state.message && <p className={state.ok ? 'ok' : 'err'} style={{ margin: '10px 0 0', fontSize: 13 }}>{state.message}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button type="submit" disabled={pending || parsed?.kind === 'error' || !link} style={{ margin: 0 }}>{pending ? 'Đang lưu…' : 'Lưu'}</button>
            <button type="button" className="ghost" style={{ margin: 0 }} onClick={() => ref.current?.close()}>Đóng</button>
          </div>
        </form>
        {existing && (
          <form action={removeAsset} style={{ marginTop: 10 }}>
            <input type="hidden" name="id" value={existing.id} />
            <button type="submit" className="ghost" style={{ margin: 0, width: 'auto', padding: '4px 10px', fontSize: 12, color: 'var(--burn)' }}>Gỡ ảnh đang gắn</button>
          </form>
        )}
      </dialog>
    </>
  );
}
