import { isSacCampaign, readGoal } from '@cohort/core';
import { createClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/server-data';
import { fetchAll, loadCustomConversions } from '@/lib/data';
import { GoalEditor, type CustomConversion } from './GoalEditor';
import { fmtDay, fmtMoney } from '@/lib/format';
import { Banner, Chip, PageHead } from '@/components/ui';
import { archiveProject, createProject, saveCampaigns } from './actions';

export const metadata = { title: 'Project & campaign' };
type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ProjectsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ws = await getWorkspace();
  const db = await createClient();
  const [rows, customRows] = await Promise.all([
    fetchAll((a, b) => db.from('meta_ads_daily').select('campaign_id,campaign_name,spend,date').order('date').order('ad_id').range(a, b)),
    loadCustomConversions(db),
  ]);
  const customs: CustomConversion[] = customRows.map((c) => ({ id: String(c.id), name: String(c.name), event_type: c.event_type ?? null, is_archived: !!c.is_archived, last_fired_at: c.last_fired_at ?? null }));

  const byCamp = new Map<string, { id: string; name: string; spend: number; last: string; first: string }>();
  for (const r of rows) {
    const c = byCamp.get(r.campaign_id) || { id: r.campaign_id, name: '', spend: 0, last: '', first: r.date };
    c.spend += Number(r.spend);
    if (r.date >= c.last) { c.last = r.date; c.name = r.campaign_name || c.name; }
    byCamp.set(r.campaign_id, c);
  }
  const status = new Map(ws.campaigns.map((c) => [String(c.id), String(c.effective_status || '')]));
  const owner = new Map(ws.projectCampaigns.map((c) => [String(c.campaign_id), String(c.project_id)]));
  const projectName = new Map(ws.projects.map((p) => [p.id as string, p.name as string]));
  const campaigns = [...byCamp.values()].filter((c) => c.spend > 0).sort((a, b) => b.last.localeCompare(a.last) || b.spend - a.spend);
  const kw = (one(sp.kw) ?? '').trim().toLowerCase();
  const kwProject = one(sp.p);
  const ok = one(sp.ok);
  const err = one(sp.err);

  return (
    <>
      <PageHead title="Project & campaign" meta="Project = nhóm campaign Meta + 1 bộ dữ liệu HubSpot. Mỗi campaign thuộc đúng 1 Project." />
      {ok && <Banner tone="meta"><span className="ok">✓ {ok}</span></Banner>}
      {err && <Banner tone="warn"><span>⚠ {err}</span></Banner>}

      <h2 className="section-title">Tạo Project mới</h2>
      <form action={createProject} className="panel">
        <div className="form-grid">
          <div><label htmlFor="name">Tên Project</label><input id="name" name="name" required maxLength={120} placeholder="Webinar RE11" /></div>
          <div><label htmlFor="slug">Slug (để trống = tự tạo từ tên)</label><input id="slug" name="slug" maxLength={60} placeholder="webinar-re11" pattern="[a-z0-9\-]*" /></div>
          <div><label htmlFor="start_date">Bắt đầu</label><input id="start_date" name="start_date" type="date" /></div>
          <div><label htmlFor="end_date">Kết thúc (tùy chọn)</label><input id="end_date" name="end_date" type="date" /></div>
        </div>
        <button type="submit" style={{ width: 'auto', padding: '8px 18px' }}>Tạo Project</button>
      </form>

      <h2 className="section-title">Gán campaign <small>{campaigns.length} campaign có chi tiêu từ khi sync</small></h2>
      {ws.projects.length === 0 && <div className="panel empty"><h3>Chưa có Project</h3><p>Tạo Project ở trên, rồi quay lại đây để gán campaign.</p></div>}
      <div className="grid">
        {ws.projects.map((p) => {
          const pre = kwProject === p.slug && kw ? new Set(campaigns.filter((c) => c.name.toLowerCase().includes(kw)).map((c) => c.id)) : null;
          const mine = campaigns.filter((c) => owner.get(c.id) === p.id).length;
          return (
            <details key={p.id} className="panel" open={ws.projects.length === 1 || kwProject === p.slug || undefined}>
              <summary style={{ cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center' }}>
                <b style={{ fontSize: 16 }}>{p.name}</b><span className="mono" style={{ color: 'var(--muted)' }}>{p.slug}</span>
                <Chip tone={mine ? 'meta' : 'warn'}>{mine} campaign</Chip>
                {p.status === 'archived' && <Chip>lưu trữ</Chip>}
                {readGoal(p.goal) ? <Chip tone="crm">🎯 {readGoal(p.goal)!.steps.find((x) => x.key === readGoal(p.goal)!.primary)?.label}</Chip> : <Chip tone="warn">🎯 chưa khai báo mục tiêu</Chip>}
              </summary>

              <GoalEditor projectId={p.id} initial={readGoal(p.goal)} customs={customs} />

              <h4 style={{ margin: '18px 0 0', fontSize: 14 }}>Campaign của Project</h4>
              <form method="get" style={{ display: 'flex', gap: 8, margin: '8px 0 4px', alignItems: 'end' }}>
                <input type="hidden" name="p" value={p.slug} />
                <div style={{ flex: 1 }}><label htmlFor={`kw-${p.id}`}>Gợi ý theo từ khóa trong tên campaign</label>
                  <input id={`kw-${p.id}`} name="kw" defaultValue={kwProject === p.slug ? kw : ''} placeholder="vd: WBN-RE hoặc SELLER" /></div>
                <button className="ghost" type="submit" style={{ width: 'auto', margin: 0 }}>Tick gợi ý</button>
              </form>

              <form action={saveCampaigns}>
                <input type="hidden" name="project_id" value={p.id} />
                <div className="list" style={{ maxHeight: 380, overflow: 'auto', margin: '8px 0' }}>
                  {campaigns.map((c) => {
                    const o = owner.get(c.id);
                    const elsewhere = !!o && o !== p.id;
                    const checked = pre ? (pre.has(c.id) || o === p.id) : o === p.id;
                    return (
                      <label key={c.id} className={`li ${elsewhere ? 'dis' : ''}`} style={{ textTransform: 'none', letterSpacing: 0, fontSize: 13.5, color: 'var(--text)', margin: 0, fontFamily: 'inherit', fontWeight: 400 }}>
                        <input type="checkbox" name="c" value={c.id} defaultChecked={checked && !elsewhere} disabled={elsewhere} />
                        <span className="grow" title={c.name}>{c.name || c.id}</span>
                        {(isSacCampaign(c.name)) && <Chip tone="warn">SAC</Chip>}
                        {status.get(c.id) === 'ACTIVE' ? <Chip tone="crm">đang chạy</Chip> : null}
                        {elsewhere && <Chip>{projectName.get(o!)}</Chip>}
                        <span className="tnum" style={{ color: 'var(--muted)', width: 70, textAlign: 'right' }}>{fmtMoney(c.spend)}</span>
                        <span className="tnum hide-sm" style={{ color: 'var(--faint)', width: 90, textAlign: 'right' }}>{fmtDay(c.first)}→{fmtDay(c.last)}</span>
                      </label>
                    );
                  })}
                </div>
                <button type="submit" style={{ width: 'auto', padding: '8px 18px' }}>Lưu campaign của Project</button>
              </form>
              <form action={archiveProject} style={{ marginTop: 6 }}>
                <input type="hidden" name="project_id" value={p.id} />
                <input type="hidden" name="status" value={p.status === 'archived' ? 'active' : 'archived'} />
                <button className="ghost" type="submit" style={{ width: 'auto', padding: '5px 12px', fontSize: 12 }}>{p.status === 'archived' ? 'Bật lại Project' : 'Lưu trữ Project'}</button>
              </form>
            </details>
          );
        })}
      </div>
    </>
  );
}
