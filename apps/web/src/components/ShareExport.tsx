'use client';
import { useRef, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { createShare, type ShareResult } from '@/app/(app)/p/[slug]/share-actions';

/** Nút Share: tạo snapshot đóng băng + link /s/<token>. Server tự tính lại số, trình duyệt chỉ gửi bộ lọc. */
export function ShareButton({ slug }: { slug: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const sp = useSearchParams();
  const [ttl, setTtl] = useState('7d');
  const [hide, setHide] = useState(false);
  const [res, setRes] = useState<ShareResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const make = () => start(async () => {
    setCopied(false);
    setRes(await createShare({ slug, d: sp.get('d') ?? undefined, from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined, src: sp.get('src') ?? undefined, ttl, hideMoney: hide }));
  });

  return (
    <>
      <button type="button" className="btn ghost" onClick={() => { setRes(null); ref.current?.showModal(); }}>Share</button>
      <dialog ref={ref} aria-label="Chia sẻ báo cáo" style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: 20, width: 'min(460px, 92vw)' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 18 }}>Chia sẻ báo cáo</h3>
        <p className="note" style={{ margin: '0 0 12px' }}>Tạo <b>ảnh chụp đóng băng</b> của màn hình này (đúng bộ lọc đang chọn). Người nhận không cần đăng nhập, không thấy lead / deal, không sửa được gì.</p>
        <div className="form-grid">
          <div><label htmlFor="ttl">Hết hạn sau</label>
            <select id="ttl" value={ttl} onChange={(e) => setTtl(e.target.value)}><option value="24h">24 giờ</option><option value="7d">7 ngày</option><option value="30d">30 ngày</option></select></div>
          <div><label htmlFor="hide">Số tiền</label>
            <select id="hide" value={hide ? 'hide' : 'show'} onChange={(e) => setHide(e.target.value === 'hide')}><option value="show">Hiện số tiền</option><option value="hide">Ẩn số tiền (chỉ tỉ lệ + số đếm)</option></select></div>
        </div>
        {res && !res.ok && <p className="err" style={{ margin: '10px 0 0', fontSize: 13 }}>{res.error}</p>}
        {res && res.ok && (
          <div style={{ marginTop: 12 }}>
            <label htmlFor="url">Link (hết hạn {new Date(res.expiresAt).toLocaleString('vi-VN')})</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input id="url" readOnly value={res.url} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" style={{ width: 'auto', margin: 0 }} onClick={async () => { await navigator.clipboard.writeText(res.url); setCopied(true); }}>{copied ? 'Đã chép ✓' : 'Chép'}</button>
            </div>
            <p className="note" style={{ margin: '8px 0 0' }}>Thu hồi bất cứ lúc nào ở <b>Cài đặt</b>.</p>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button type="button" style={{ margin: 0 }} disabled={pending} onClick={make}>{pending ? 'Đang tạo…' : res?.ok ? 'Tạo link mới' : 'Tạo link'}</button>
          <button type="button" className="ghost" style={{ margin: 0 }} onClick={() => ref.current?.close()}>Đóng</button>
        </div>
      </dialog>
    </>
  );
}

/** Xuất vùng báo cáo thành PNG 2x, kèm watermark. Ảnh creative đi qua proxy cùng origin nên không dính CORS. */
export function ExportPngButton({ targetId, fileName }: { targetId: string; fileName: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function run() {
    const node = document.getElementById(targetId);
    if (!node) return;
    setBusy(true); setErr('');
    node.classList.add('capturing');
    try {
      const { toPng } = await import('html-to-image');
      await document.fonts?.ready;
      const mark = document.createElement('div');
      mark.className = 'watermark';
      const now = new Date();
      mark.textContent = `Snapshot • ${now.toLocaleDateString('vi-VN')} ${now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} • Cohort OS`;
      node.appendChild(mark);
      try {
        const url = await toPng(node, { pixelRatio: 2, cacheBust: true, backgroundColor: '#0a0a0a', width: node.scrollWidth });
        const a = document.createElement('a');
        a.href = url; a.download = `${fileName}.png`; a.click();
      } finally { mark.remove(); }
    } catch (e) { setErr(`Không xuất được ảnh (${(e as Error).message || 'lỗi không rõ'}).`); }
    finally { node.classList.remove('capturing'); setBusy(false); }
  }
  return (
    <>
      <button type="button" className="btn ghost" onClick={run} disabled={busy}>{busy ? 'Đang xuất…' : 'Xuất PNG'}</button>
      {err && <span className="err" style={{ fontSize: 12 }}>{err}</span>}
    </>
  );
}
