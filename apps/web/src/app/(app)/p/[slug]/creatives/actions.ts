'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/supabase/server';
import { parseAssetLink } from '@/lib/drive';

export interface AssetState { ok: boolean; message: string }

const AD_ID = /^\d{6,25}$/;
const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v.trim() : '');

/** Gắn ảnh Drive (hoặc link bài đăng FB/IG) cho 1 concept hoặc 1 ad. Mỗi concept / ad có đúng 1 dòng. */
export async function saveAsset(_prev: AssetState, formData: FormData): Promise<AssetState> {
  const { supabase } = await requireAdmin();
  const scope = str(formData.get('scope')) === 'ad' ? 'ad' : 'concept';
  const conceptKey = str(formData.get('concept_key'));
  const adId = str(formData.get('ad_id'));
  const notes = str(formData.get('notes')).slice(0, 1000);
  const link = parseAssetLink(str(formData.get('link')));
  if (link.kind === 'error') return { ok: false, message: link.message };
  if (scope === 'concept' && (!conceptKey || conceptKey.length > 300)) return { ok: false, message: 'Thiếu concept.' };
  if (scope === 'ad' && !AD_ID.test(adId)) return { ok: false, message: 'Ad không hợp lệ.' };

  const base = {
    scope, notes: notes || null, updated_at: new Date().toISOString(),
    concept_key: scope === 'concept' ? conceptKey : null, ad_id: scope === 'ad' ? adId : null,
    drive_file_id: link.kind === 'drive' ? link.fileId : null,
    drive_url: link.kind === 'drive' ? `https://drive.google.com/file/d/${link.fileId}/view` : null,
    post_url: link.kind === 'post' ? link.url : null,
  };
  const find = supabase.from('creative_assets').select('id').eq('scope', scope);
  const { data: existing, error: fe } = await (scope === 'concept' ? find.eq('concept_key', conceptKey) : find.eq('ad_id', adId)).maybeSingle();
  if (fe) return { ok: false, message: `Không đọc được dữ liệu (${fe.message}).` };
  const { error } = existing
    ? await supabase.from('creative_assets').update(base).eq('id', existing.id)
    : await supabase.from('creative_assets').insert(base);
  if (error) return { ok: false, message: `Không lưu được (${error.message}).` };
  revalidatePath('/p', 'layout');
  return { ok: true, message: 'Đã lưu.' };
}

export async function removeAsset(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const id = str(formData.get('id'));
  if (!/^[0-9a-f-]{36}$/.test(id)) return;
  await supabase.from('creative_assets').delete().eq('id', id);
  revalidatePath('/p', 'layout');
}
