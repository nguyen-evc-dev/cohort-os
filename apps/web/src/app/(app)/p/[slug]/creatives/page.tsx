import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ConceptRow, Row } from '@cohort/core';
import { createClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/server-data';
import { loadAssets, loadReport } from '@/lib/data';
import { filterQuery, parseFilters, showCrm } from '@/lib/filters';
import { fmtInt, fmtMoney, fmtRange, fmtRate } from '@/lib/format';
import { Banner, PageHead } from '@/components/ui';
import { AssetDialog } from './AssetDialog';
import { CreativeGrid } from '@/components/CreativeGrid';
import { ExportPngButton, ShareButton } from '@/components/ShareExport';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
export const metadata = { title: 'Creative Vault' };

export default async function CreativeVault({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SP }) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const sp = await searchParams;
  const ws = await getWorkspace();
  const f = parseFilters(sp, ws.latestDate);
  const db = await createClient();
  const loaded = await loadReport(db, ws, slug, f);
  if (!loaded) notFound();
  const { project, report: r } = loaded;
  const { rows: assets, stageReady } = await loadAssets(db);
  const assetOf = (c: ConceptRow) => assets.find((x) => (x.scope === 'concept' && x.concept_key === c.conceptKey) || (x.scope === 'ad' && c.ads.includes(String(x.ad_id))));
  const adNames = new Map<string, string>();
  const walk = (ns: typeof r.tree) => ns.forEach((n) => { if (n.level === 'ad') adNames.set(n.id, n.name); walk(n.children); });
  walk(r.tree);

  const stage = one(sp.stage) ?? '';
  const format = one(sp.format) ?? '';
  const sort = one(sp.sort) === 'spend' ? 'spend' : 'cpa';
  const crmMode = r.hasCrm && showCrm(f);
  let list: ConceptRow[] = r.concepts.filter((c) => (!stage || c.stages.includes(stage)) && (!format || c.format === format));
  if (sort === 'spend') list = [...list].sort((a, b) => b.meta.spend - a.meta.spend);

  const base = `/p/${slug}/creatives`;
  const href = (patch: Record<string, string>) => {
    const q = new URLSearchParams(filterQuery(f).replace(/^\?/, ''));
    for (const [k, v] of Object.entries({ stage, format, sort: sort === 'cpa' ? '' : sort, ...patch })) { if (v) q.set(k, v); else q.delete(k); }
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const opt = (label: string, key: 'stage' | 'format' | 'sort', value: string, cur: string) =>
    <Link key={label} href={href({ [key]: value })} aria-current={cur === value}>{label}</Link>;

  return (
    <>
      <PageHead title="Creative Vault" meta={<>{project.name} · {fmtRange(f.from, f.to)} · {list.length} concept</>}
        right={<span style={{ display: 'flex', gap: 8 }}><ShareButton slug={slug} /><ExportPngButton targetId="vault-capture" fileName={`cohort-os-creatives-${project.slug}`} /></span>} />
      {!crmMode && <Banner tone="meta">Chưa có CRM nên caption dùng số Meta tự báo (slate). Đèn tính theo chi phí / kết quả Meta.</Banner>}
      <div className="filters">
        <div className="seg" role="group" aria-label="Giai đoạn funnel">
          {opt('Mọi stage', 'stage', '', stage)}{opt('TOFU', 'stage', 'TOFU', stage)}{opt('MOFU', 'stage', 'MOFU', stage)}{opt('BOFU', 'stage', 'BOFU', stage)}
        </div>
        <div className="seg" role="group" aria-label="Định dạng">
          {opt('Photo + Video', 'format', '', format)}{opt('Photo', 'format', 'photo', format)}{opt('Video', 'format', 'video', format)}
        </div>
        <div className="seg" role="group" aria-label="Sắp xếp">
          {opt(crmMode ? 'CPA thực ↑' : 'CPA ↑', 'sort', '', sort === 'cpa' ? '' : sort)}{opt('Spend ↓', 'sort', 'spend', sort)}
        </div>
      </div>

      <div id="vault-capture">
      <div className="only-capture"><h1 style={{ fontSize: 28 }}>Creative Vault · {project.name}</h1><p className="note" style={{ margin: '4px 0 16px' }}>{fmtRange(f.from, f.to)}</p></div>
      {list.length === 0 ? (
        <div className="panel empty"><h3>Không có creative nào</h3><p>Bỏ bớt bộ lọc hoặc chọn khoảng ngày dài hơn.</p></div>
      ) : (
        <CreativeGrid concepts={list} crmMode={crmMode} primaryLabel={r.primary.label} steps={r.steps}
          thumbs={Object.fromEntries(list.flatMap((c) => { const a = assetOf(c); return a?.drive_file_id ? [[c.conceptKey, a.drive_file_id as string]] : []; }))}
          extra={(c) => {
            const asset = assetOf(c);
            return (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <AssetDialog conceptKey={c.conceptKey} conceptName={c.concept} ads={c.ads.map((id) => ({ id, name: adNames.get(id) ?? id }))}
                  existing={asset ? { id: asset.id, scope: asset.scope, fileId: asset.drive_file_id, postUrl: asset.post_url } : null}
                  stage={(asset?.stage as string | null | undefined) ?? null} currentStages={c.stages} stageReady={stageReady} />
                {asset?.post_url && <a className="cap" href={asset.post_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline', marginTop: 4 }}>Xem post ↗</a>}
              </div>
            );
          }} />
      )}
      </div>
      <p className="note">Winner: ≥ 2 chuyển đổi và CPA ≤ 80% mức trung bình Project · Burner: 0 chuyển đổi mà spend ≥ 2× mức trung bình · Chưa đủ data: spend còn thấp.</p>
    </>
  );
}
