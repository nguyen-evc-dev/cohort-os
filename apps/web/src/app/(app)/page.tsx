import Link from 'next/link';
import { buildProjectReport, readGoal, type Row } from '@cohort/core';
import { createClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/server-data';
import { loadActions, loadCrm, loadMeta, loadSignals } from '@/lib/data';
import { costLabel } from '@/components/ReportView';
import { filterQuery, parseFilters, showCrm, showMeta } from '@/lib/filters';
import { DASH, fmtInt, fmtMoney, fmtRange, fmtRoas } from '@/lib/format';
import { Banner, Chip, Light, PageHead, Tile } from '@/components/ui';

export const metadata = { title: 'Overview' };

/** ROAS ≥ mốc này thì thẻ Project có glow (Design Proposal: cohort lãi sáng, lỗ không glow). */
const GLOW_ROAS = 1;

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ws = await getWorkspace();
  const f = parseFilters(await searchParams, ws.latestDate);
  const db = await createClient();
  const projects = ws.projects.filter((p) => p.status === 'active');
  const goals = new Map(projects.map((p) => [p.id as string, readGoal(p.goal)]));
  const actionTypes = [...new Set([...goals.values()].flatMap((g) => (g?.steps ?? []).filter((x) => x.source === 'meta' && x.action_type).map((x) => x.action_type!)))];
  const [metaRows, crm, sig, actions] = await Promise.all([loadMeta(db, f), loadCrm(db), loadSignals(db), loadActions(db, f, actionTypes)]);
  const q = filterQuery(f);

  const mapped = new Set(ws.projectCampaigns.map((c) => String(c.campaign_id)));
  const cards = projects.map((p) => {
    const ids = ws.projectCampaigns.filter((c) => c.project_id === p.id).map((c) => String(c.campaign_id));
    const report = buildProjectReport({
      metaRows, campaignIds: ids, range: { from: f.from, to: f.to },
      submissions: crm.submissions.filter((s) => s.project_id === p.id), deals: crm.deals, actions, goal: goals.get(p.id) ?? null,
    });
    return { p, ids, report };
  });
  const account = buildProjectReport({ metaRows, campaignIds: null, range: { from: f.from, to: f.to } });
  const unmapped = account.tree.filter((c) => !mapped.has(c.id) && c.meta.spend > 0);
  const unmappedSpend = unmapped.reduce((s, c) => s + c.meta.spend, 0);

  const counts = { red: 0, yellow: 0, green: 0, grey: 0 };
  for (const s of sig.rows) counts[s.color as keyof typeof counts] += 1;
  const topOf = (color: string): Row | undefined => sig.rows.filter((s) => s.color === color)
    .sort((a, b) => Number(b.numbers?.spend ?? 0) - Number(a.numbers?.spend ?? 0))[0];
  const topRed = topOf('red');
  const topGreen = topOf('green');

  if (!ws.latestDate) {
    return (
      <>
        <PageHead title="Overview" />
        <div className="panel empty">
          <h3>Chưa có số Meta nào</h3>
          <p>Chạy lần sync đầu: Claude Desktop → Scheduled → <b>cohort-meta-sync-1405</b> → Run now.</p>
        </div>
      </>
    );
  }

  const results = account.primary.value;
  return (
    <>
      <PageHead title="Overview" meta={<>{fmtRange(f.from, f.to)} · giờ PT · dữ liệu mới nhất {ws.latestDate}</>} />

      {unmapped.length > 0 && (
        <Banner tone="meta">
          <span>📌 <b>{unmapped.length} campaign</b> ({fmtMoney(unmappedSpend)}) chưa thuộc Project nào, nên chưa ghép được với HubSpot.{' '}
            <Link href="/projects">Gán vào Project →</Link></span>
        </Banner>
      )}

      <div className="grid g4">
        <Tile label="Spend toàn tài khoản (Meta)" value={fmtMoney(account.total.meta.spend)} tone="meta" box="meta"
          hint={`${account.tree.length} campaign có chi tiêu`} />
        <Tile label={account.primary.label} value={fmtInt(results)} tone="meta" box="meta" hint="toàn tài khoản, Meta tự báo" />
        <Tile label={`${costLabel(account.primary.label)} toàn tài khoản`} value={fmtMoney(account.primary.cost)} tone="meta" box="meta" hint="mỗi Project đo theo mục tiêu riêng ↓" />
        <Link href="/p/all/ryg" style={{ textDecoration: 'none' }}>
          <Tile label={`Đèn RYG · ${sig.asOf ?? DASH}`} value={<span style={{ display: 'inline-flex', gap: 14, alignItems: 'center' }}>
            <span><Light c="red" /> {counts.red}</span><span><Light c="yellow" /> {counts.yellow}</span><span><Light c="green" /> {counts.green}</span>
          </span>} hint={topRed ? `🔴 ${topRed.numbers?.entity_name ?? topRed.entity_id}` : topGreen ? `🟢 ${topGreen.numbers?.entity_name ?? topGreen.entity_id}` : 'Xem chi tiết →'} />
        </Link>
      </div>

      <h2 className="section-title">Project <small>mỗi Project = nhóm campaign Meta + bộ dữ liệu HubSpot</small></h2>
      <div className="episodes">
        {cards.map(({ p, ids, report }) => {
          const hasCrm = report.hasCrm;
          const pr = report.primary;
          const fin = report.final;
          // Glow khi đạt target chi phí của bước chính (hoặc giá trị bước cuối ≥ spend nếu chưa đặt target)
          const glow = pr.target ? pr.cost !== null && pr.cost <= pr.target : fin.available && fin.value >= report.total.meta.spend * GLOW_ROAS && fin.value > 0;
          return (
            <Link key={p.id} href={`/p/${p.slug}${q}`} className={`episode ${glow ? 'glow' : ''}`}>
              <h3>{p.name}</h3>
              <div className="date">{p.start_date ? `${p.start_date} → ${p.end_date ?? 'đang chạy'}` : `${ids.length} campaign`}</div>
              <div className="row"><span>Spend</span><b className="meta">{fmtMoney(report.total.meta.spend)}</b></div>
              <div className="row"><span>{pr.label}</span><b className={pr.kind}>{fmtInt(pr.value)}</b></div>
              <div className="row"><span>{costLabel(pr.label)}</span><b className={pr.kind}>{fmtMoney(pr.cost)}</b></div>
              {showCrm(f) && <div className="row"><span>{fin.label}</span><b className="crm">{fin.available ? <>{fmtInt(fin.count)}{fin.value > 0 && <span style={{ fontWeight: 400, fontSize: 13 }}> · {fmtMoney(fin.value)}</span>}</> : DASH}</b></div>}
              <div className="steps">
                <Chip tone="meta">① Meta ✓</Chip>
                {hasCrm ? <Chip tone="crm">② CRM ✓ · {report.total.crm.leads} lead</Chip> : <Chip tone="warn">② Chờ CRM</Chip>}
                {!report.goalConfigured && <Chip tone="warn">🎯 chưa khai báo mục tiêu</Chip>}
              </div>
            </Link>
          );
        })}
        <Link href="/projects" className="episode dashed">
          <h3>＋ Project mới</h3>
          <div className="date">Tạo Project, gán campaign Meta, rồi import HubSpot.</div>
        </Link>
      </div>

      {projects.length === 0 && (
        <p className="note">Chưa có Project nào. Các số ở trên là toàn tài khoản (chỉ Meta). Tạo Project để ghép với HubSpot.</p>
      )}
    </>
  );
}
