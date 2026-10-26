import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/server-data';
import { loadReport } from '@/lib/data';
import { filterQuery, parseFilters } from '@/lib/filters';
import { fmtRange } from '@/lib/format';
import { Banner, PageHead } from '@/components/ui';
import { ReportView } from '@/components/ReportView';
import { ExportPngButton, ShareButton } from '@/components/ShareExport';
import { InsightPanel } from '@/components/InsightPanel';
import { insightContext } from '@/lib/insight';

type SP = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: slug === 'all' ? 'Toàn tài khoản' : decodeURIComponent(slug) };
}

export default async function ProjectReportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SP }) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const ws = await getWorkspace();
  const f = parseFilters(await searchParams, ws.latestDate);
  const db = await createClient();
  const loaded = await loadReport(db, ws, slug, f);
  if (!loaded) notFound();
  const { project, report: r } = loaded;
  const q = filterQuery(f);
  const noCampaigns = project.campaignIds !== null && project.campaignIds.length === 0;
  const range = fmtRange(f.from, f.to);
  const ctx = insightContext(loaded);
  const { data: lastInsight } = await db.from('insights').select('body,created_at,data_version').eq('scope', 'project').eq('scope_id', ctx.scopeId).eq('kind', 'report').order('created_at', { ascending: false }).limit(1).maybeSingle();

  return (
    <>
      <PageHead
        title={project.name}
        meta={<>{range} · {project.campaignIds === null ? 'mọi campaign' : `${project.campaignIds.length} campaign`}</>}
        right={<span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn ghost" href={`/p/${slug}/creatives${q}`}>Creative Vault</Link>
          <Link className="btn ghost" href={`/p/${slug}/ryg${q}`}>Đèn RYG</Link>
          <ShareButton slug={slug} />
          <ExportPngButton targetId="report-capture" fileName={`cohort-os-${project.slug}-${f.from ?? 'all'}`} />
        </span>}
      />

      {project.id && !r.goalConfigured && (
        <Banner tone="warn"><span>🎯 Project chưa khai báo <b>mục tiêu</b>, nên đang đo tạm bằng Lead / Purchase mặc định của Meta. <Link href={`/projects?p=${project.slug}#goal`}>Khai báo chuyển đổi chính (custom conversion) →</Link></span></Banner>
      )}
      {noCampaigns && <Banner tone="meta">Project này chưa có campaign nào. <Link href="/projects">Gán campaign →</Link></Banner>}
      {!r.hasCrm && !noCampaigns && project.id && (
        <Banner tone="meta"><span>② <b>Chờ CRM</b>: chưa import HubSpot cho Project này, nên chỉ có số Meta (tự báo). <Link href="/import">Import HubSpot →</Link></span></Banner>
      )}
      {r.provisionalDates.length > 0 && (
        <Banner tone="warn">Ngày {r.provisionalDates.join(', ')} là <b>tạm tính</b>: Meta có thể điều chỉnh số trong 24–48 giờ.</Banner>
      )}

      {r.total.meta.spend > 0 && (
        <div style={{ marginBottom: 16 }}>
          <InsightPanel slug={slug} configured={!!process.env.ANTHROPIC_API_KEY}
            initial={lastInsight ? { text: lastInsight.body, createdAt: lastInsight.created_at } : null} stale={!!lastInsight && lastInsight.data_version !== ctx.version} />
        </div>
      )}

      <div id="report-capture">
        <div className="only-capture"><h1 style={{ fontSize: 28 }}>{project.name}</h1><p className="note" style={{ margin: '4px 0 16px' }}>{range} · giờ PT</p></div>
        <ReportView r={r} src={f.src} fileName={`cohort-os-${project.slug}-${f.from ?? 'all'}`} storageKey={project.slug} />
      </div>
    </>
  );
}
