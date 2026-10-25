'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/supabase/server';
import { slugify } from '@/lib/format';

const ID_RE = /^\d{6,25}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v.trim() : '');
const go = (kind: 'ok' | 'err', msg: string): never => redirect(`/projects?${kind}=${encodeURIComponent(msg)}`);

/** Mọi action tự kiểm tra admin (không dựa vào việc trang đã chặn). RLS là lớp thứ 3. */
export async function createProject(formData: FormData) {
  const { supabase } = await requireAdmin();
  const name = str(formData.get('name'));
  const slug = slugify(str(formData.get('slug')) || name);
  const start = str(formData.get('start_date'));
  const end = str(formData.get('end_date'));
  if (!name || name.length > 120) go('err', 'Tên Project phải có 1–120 ký tự.');
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) go('err', 'Slug chỉ gồm a–z, 0–9 và dấu gạch ngang (2–60 ký tự).');
  if (slug === 'all') go('err', '"all" là tên dành riêng cho báo cáo toàn tài khoản.');
  if ((start && !DATE_RE.test(start)) || (end && !DATE_RE.test(end))) go('err', 'Ngày không hợp lệ.');
  if (start && end && start > end) go('err', 'Ngày bắt đầu phải trước ngày kết thúc.');
  const { error } = await supabase.from('projects').insert({ name, slug, start_date: start || null, end_date: end || null });
  if (error) go('err', error.code === '23505' ? `Đã có Project với slug "${slug}".` : `Không tạo được Project (${error.message}).`);
  revalidatePath('/', 'layout');
  go('ok', `Đã tạo Project "${name}". Tick campaign bên dưới rồi bấm Lưu.`);
}

export async function saveCampaigns(formData: FormData) {
  const { supabase } = await requireAdmin();
  const projectId = str(formData.get('project_id'));
  const ids = [...new Set(formData.getAll('c').filter((v): v is string => typeof v === 'string'))];
  if (!/^[0-9a-f-]{36}$/.test(projectId)) go('err', 'Project không hợp lệ.');
  if (ids.some((i) => !ID_RE.test(i))) go('err', 'Có campaign ID không hợp lệ.');

  const { data: taken, error: e0 } = await supabase.from('project_campaigns').select('campaign_id,project_id');
  if (e0) go('err', `Không đọc được dữ liệu (${e0.message}).`);
  const other = (taken || []).filter((t) => t.project_id !== projectId && ids.includes(String(t.campaign_id)));
  if (other.length) go('err', `${other.length} campaign đã thuộc Project khác. Bỏ tick ở Project đó trước.`);

  const mine = (taken || []).filter((t) => t.project_id === projectId).map((t) => String(t.campaign_id));
  const remove = mine.filter((m) => !ids.includes(m));
  if (remove.length) {
    const { error } = await supabase.from('project_campaigns').delete().eq('project_id', projectId).in('campaign_id', remove);
    if (error) go('err', `Không bỏ được campaign (${error.message}).`);
  }
  const add = ids.filter((i) => !mine.includes(i)).map((campaign_id) => ({ campaign_id, project_id: projectId, mapped_by: 'manual' }));
  if (add.length) {
    const { error } = await supabase.from('project_campaigns').insert(add);
    if (error) go('err', `Không gán được campaign (${error.message}).`);
  }
  revalidatePath('/', 'layout');
  go('ok', `Đã lưu: Project có ${ids.length} campaign.`);
}

export async function archiveProject(formData: FormData) {
  const { supabase } = await requireAdmin();
  const projectId = str(formData.get('project_id'));
  const status = str(formData.get('status')) === 'archived' ? 'archived' : 'active';
  if (!/^[0-9a-f-]{36}$/.test(projectId)) go('err', 'Project không hợp lệ.');
  const { error } = await supabase.from('projects').update({ status }).eq('id', projectId);
  if (error) go('err', `Không cập nhật được (${error.message}).`);
  revalidatePath('/', 'layout');
  go('ok', status === 'archived' ? 'Đã lưu trữ Project (dữ liệu giữ nguyên).' : 'Đã bật lại Project.');
}
