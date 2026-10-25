'use server';
import { revalidatePath } from 'next/cache';
import { validateCrmPayload, type CrmPayload } from '@cohort/core';
import { requireAdmin } from '@/lib/supabase/server';

export type ImportResult =
  | { ok: true; slug: string; projectName: string; submissions: number; deals: number; campaignsAdded: number; importId: string }
  | { ok: false; error: string };

const CHUNK = 500;
const orNull = (v: string | null | undefined) => (v ? v : null);

/**
 * Nhận dữ liệu CRM ĐÃ LÀM SẠCH từ trình duyệt (chỉ ID / nguồn ad / stage / amount).
 * Server kiểm tra lại toàn bộ (không tin client), quét PII, rồi ghi bằng phiên admin (RLS).
 */
export async function importCrm(raw: unknown): Promise<ImportResult> {
  const { supabase } = await requireAdmin();
  let p: CrmPayload;
  try { p = validateCrmPayload(raw); } catch (e) { return { ok: false, error: (e as Error).message }; }

  const { data: project, error: pe } = await supabase.from('projects').select('id,slug,name').eq('id', p.project_id).maybeSingle();
  if (pe || !project) return { ok: false, error: 'Không tìm thấy Project.' };

  // Gán thêm campaign: chỉ campaign có thật trong dữ liệu Meta và chưa thuộc Project khác
  let added = 0;
  if (p.add_campaigns.length) {
    const [known, owned] = await Promise.all([
      supabase.from('meta_ads_daily').select('campaign_id').in('campaign_id', p.add_campaigns).limit(1000),
      supabase.from('project_campaigns').select('campaign_id,project_id').in('campaign_id', p.add_campaigns),
    ]);
    if (known.error || owned.error) return { ok: false, error: 'Không đọc được danh sách campaign.' };
    const exist = new Set((known.data || []).map((r) => String(r.campaign_id)));
    const taken = new Set((owned.data || []).map((r) => String(r.campaign_id)));
    const rows = p.add_campaigns.filter((c) => exist.has(c) && !taken.has(c)).map((campaign_id) => ({ campaign_id, project_id: p.project_id, mapped_by: 'auto' }));
    if (rows.length) {
      const { error } = await supabase.from('project_campaigns').insert(rows);
      if (error) return { ok: false, error: `Không gán được campaign (${error.message}).` };
      added = rows.length;
    }
  }

  const { error: fe } = await supabase.from('project_forms').upsert({ form_name: p.form_name, project_id: p.project_id }, { onConflict: 'form_name' });
  if (fe) return { ok: false, error: `Không lưu được form (${fe.message}).` };

  const days = p.submissions.map((s) => s.converted_on).sort();
  const leads = new Map<string, boolean>();
  for (const s of p.submissions) if (s.contact_id && (s.source_hint === 'tracked' || s.source_hint === 'direct')) leads.set(s.contact_id, (leads.get(s.contact_id) ?? false) || s.source_hint === 'tracked');
  const trackedPct = leads.size ? Math.round(([...leads.values()].filter(Boolean).length / leads.size) * 10000) / 100 : null;

  const { data: imp, error: ie } = await supabase.from('crm_imports').insert({
    project_id: p.project_id, form_name: p.form_name, source: 'web', submissions_rows: p.submissions.length, deals_rows: p.deals.length,
    tracked_pct: trackedPct, date_from: days[0], date_to: days[days.length - 1],
  }).select('id').single();
  if (ie || !imp) return { ok: false, error: `Không ghi được lịch sử import (${ie?.message}).` };

  const subRows = p.submissions.map((s) => ({
    conversion_id: s.conversion_id, project_id: p.project_id, form_name: p.form_name, contact_id: s.contact_id, converted_on: s.converted_on,
    ad_id: s.ad_id, adset_id: s.adset_id, campaign_id: s.campaign_id, placement: s.placement, platform: s.platform, page_path: s.page_path,
    source_hint: s.source_hint, import_id: imp.id,
  }));
  for (let i = 0; i < subRows.length; i += CHUNK) {
    const { error } = await supabase.from('crm_submissions').upsert(subRows.slice(i, i + CHUNK), { onConflict: 'conversion_id' });
    if (error) return { ok: false, error: `Ghi lượt đăng ký thất bại (${error.message}). Import chưa hoàn tất, có thể chạy lại an toàn.` };
  }
  const dealRows = p.deals.map((d) => ({
    deal_id: d.deal_id, project_id: p.project_id, contact_ids: d.contact_ids, deal_stage: d.deal_stage, deal_type: d.deal_type,
    amount: d.amount, created_on: orNull(d.created_on), closed_on: orNull(d.closed_on), is_won: d.is_won, import_id: imp.id,
  }));
  for (let i = 0; i < dealRows.length; i += CHUNK) {
    const { error } = await supabase.from('crm_deals').upsert(dealRows.slice(i, i + CHUNK), { onConflict: 'deal_id' });
    if (error) return { ok: false, error: `Ghi deal thất bại (${error.message}). Import chưa hoàn tất, có thể chạy lại an toàn.` };
  }

  revalidatePath('/', 'layout');
  return { ok: true, slug: project.slug, projectName: project.name, submissions: subRows.length, deals: dealRows.length, campaignsAdded: added, importId: imp.id };
}
