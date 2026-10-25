import { notFound } from 'next/navigation';
import type { ShareSnapshot } from '@cohort/core';
import { createAnonClient } from '@/lib/supabase/anon';
import { fmtRange } from '@/lib/format';
import { Banner } from '@/components/ui';
import { ReportView } from '@/components/ReportView';
import { CreativeGrid } from '@/components/CreativeGrid';
import { ExportPngButton } from '@/components/ShareExport';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Báo cáo chia sẻ', robots: { index: false, follow: false, nocache: true } };

/** Trang share công khai: snapshot đóng băng, chỉ đọc, không đăng nhập. Sai / hết hạn / thu hồi → 404 (không phân biệt). */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(token)) notFound();
  const { data, error } = await createAnonClient().rpc('share_open', { p_token: token });
  if (error || !data) notFound();
  const snap = data.snapshot as ShareSnapshot;
  if (!snap || snap.v !== 1 || !snap.report) notFound();

  const r = snap.report;
  const when = new Date(snap.generatedAt);
  const stamp = `${when.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} ${when.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' })}`;
  const crmMode = r.hasCrm && snap.src !== 'meta';

  return (
    <main className="share-wrap">
      <div className="share-head">
        <h1>{snap.projectName}</h1>
        <span className="note" style={{ margin: 0 }}>{fmtRange(r.range.from, r.range.to)} · giờ PT</span>
        <span style={{ flex: 1 }} />
        <ExportPngButton targetId="share-capture" fileName={`cohort-os-${snap.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} />
      </div>
      <Banner tone="meta">📸 <b>Snapshot</b> chụp lúc {stamp} (giờ VN). Số liệu đã đóng băng, không cập nhật theo thời gian thực.{snap.hideMoney && <> Số tiền đã được ẩn.</>}</Banner>
      <div id="share-capture">
        <div className="only-capture"><h1 style={{ fontSize: 28 }}>{snap.projectName}</h1><p className="note" style={{ margin: '4px 0 16px' }}>{fmtRange(r.range.from, r.range.to)} · giờ PT</p></div>
        <ReportView r={r} src={snap.src} hideMoney={snap.hideMoney} allowExport={false} fileName="share" />
        {r.concepts.length > 0 && (
          <>
            <h2 className="section-title">Creative <small>{r.concepts.length} concept</small></h2>
            <CreativeGrid concepts={r.concepts} thumbs={snap.thumbs} crmMode={crmMode} />
          </>
        )}
      </div>
      <p className="watermark">Snapshot • {stamp} • Cohort OS · hết hạn {new Date(data.expires_at).toLocaleDateString('vi-VN')}</p>
    </main>
  );
}
