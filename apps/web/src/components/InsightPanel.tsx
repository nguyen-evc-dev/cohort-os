'use client';
import { useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { generateInsight, type InsightResult } from '@/app/(app)/p/[slug]/insight-actions';
import { fmtAgo } from '@/lib/format';

/** Khối "Nhận định AI" (C5): 3–5 gạch đầu dòng từ số tổng hợp. Có nhận định cũ thì hiện sẵn, bấm để làm mới. */
export function InsightPanel({ slug, initial, stale, configured }: {
  slug: string; initial: { text: string; createdAt: string } | null; stale: boolean; configured: boolean;
}) {
  const sp = useSearchParams();
  const [res, setRes] = useState<InsightResult | null>(initial ? { ok: true, text: initial.text, createdAt: initial.createdAt, cached: true } : null);
  const [pending, start] = useTransition();
  const run = (refresh: boolean) => start(async () => {
    setRes(await generateInsight({ slug, d: sp.get('d') ?? undefined, from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined, src: sp.get('src') ?? undefined, refresh }));
  });
  const text = res && res.ok ? res.text : '';
  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span className="lbl" style={{ margin: 0 }}>Nhận định AI · Bé Sugar</span>
        {res && res.ok && <span className="chip" title="Thời điểm tạo">{fmtAgo(res.createdAt)}{res.cached && stale ? ' · số liệu đã đổi' : ''}</span>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn ghost" disabled={pending || !configured} onClick={() => run(!!res)} title={configured ? '' : 'Chưa có ANTHROPIC_API_KEY'}>
          {pending ? 'Đang phân tích…' : res ? 'Làm mới' : 'Tạo nhận định'}
        </button>
      </div>
      {!configured && !res && <p className="note" style={{ margin: 0 }}>Chưa cấu hình <span className="mono">ANTHROPIC_API_KEY</span> (Setup Guide, bước 5). Thêm key vào <span className="mono">apps/web/.env.local</span> rồi chạy lại web.</p>}
      {res && !res.ok && <p className="err" style={{ margin: 0 }}>{res.error}</p>}
      {res && res.ok && res.warning && <p className="note" style={{ margin: '0 0 8px', color: 'var(--warn)' }}>⚠ {res.warning}</p>}
      {text && <div style={{ whiteSpace: 'pre-wrap', lineHeight: '22px' }}>{text}</div>}
      {!text && configured && !pending && !(res && !res.ok) && <p className="note" style={{ margin: 0 }}>Bấm “Tạo nhận định” để em đọc số và viết 3–5 ý chính. Mọi con số em nêu đều lấy từ số liệu ở trang này.</p>}
      <p className="note" style={{ margin: '10px 0 0', fontSize: 12 }}>Chỉ gợi ý, không thay đổi gì trên tài khoản quảng cáo. Dữ liệu gửi cho Claude chỉ là số tổng hợp (không có tên, email, SĐT).</p>
    </div>
  );
}
