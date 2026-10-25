import { createClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/server-data';
import { fetchAll } from '@/lib/data';
import { PageHead } from '@/components/ui';
import { ImportClient, type KnownCampaign } from './ImportClient';

export const metadata = { title: 'Import HubSpot' };

export default async function ImportPage() {
  const ws = await getWorkspace();
  const db = await createClient();
  const [rows, forms] = await Promise.all([
    fetchAll((a, b) => db.from('meta_ads_daily').select('campaign_id,campaign_name,spend,date').order('date').order('ad_id').range(a, b)),
    fetchAll((a, b) => db.from('project_forms').select('form_name,project_id').order('form_name').range(a, b)),
  ]);
  const byCamp = new Map<string, KnownCampaign>();
  const owner = new Map(ws.projectCampaigns.map((c) => [String(c.campaign_id), String(c.project_id)]));
  for (const r of rows) {
    const c = byCamp.get(r.campaign_id) || { id: r.campaign_id, name: '', spend: 0, ownerProjectId: owner.get(r.campaign_id) ?? null, _last: '' };
    c.spend += Number(r.spend);
    if (r.date >= (c._last ?? '')) { c._last = r.date; c.name = r.campaign_name || c.name; }
    byCamp.set(r.campaign_id, c);
  }
  const campaigns = [...byCamp.values()].map(({ _last, ...c }) => ({ ...c, spend: Math.round(c.spend * 100) / 100 }));
  const projects = ws.projects.filter((p) => p.status === 'active').map((p) => ({ id: p.id as string, slug: p.slug as string, name: p.name as string }));
  return (
    <>
      <PageHead title="Import HubSpot" meta="Bước ② · file được xử lý ngay trên trình duyệt này. Chỉ ID, nguồn quảng cáo, stage và amount được gửi lên." />
      <ImportClient
        projects={projects}
        forms={forms.map((f) => ({ form: f.form_name as string, projectId: f.project_id as string }))}
        campaigns={campaigns}
      />
    </>
  );
}
