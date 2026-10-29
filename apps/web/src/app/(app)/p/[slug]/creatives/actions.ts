'use server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/supabase/server';
import { parseAssetLink } from '@/lib/drive';
import { resolveShot } from '@/lib/shot';

export interface AssetState { ok: boolean; message: string }

const AD_ID = /^\d{6,25}$/;
const STAGES: Record<string, 'TOFU' | 'MOFU' | 'BOFU'> = { TOF: 'TOFU', TOFU: 'TOFU', MOF: 'MOFU', MOFU: 'MOFU', BOF: 'BOFU', BOFU: 'BOFU' };
const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v.trim() : '');

/**
 * Gắn link Drive (ảnh / video), ảnh chụp prnt.sc, link bài đăng và/hoặc stage thủ công cho 1 concept hoặc 1 ad. Mỗi concept / ad có đúng 1 dòng.
 * Link prnt.sc chỉ đổi ảnh bìa, KHÔNG đụng link Drive của video. Link để trống thì giữ link cũ (chỉ đổi stage). Stage "auto" xóa nhãn thủ công, quay về tự nhận theo tên ad.
 */
export async function saveAsset(_prev: AssetState, formData: FormData): Promise<AssetState> {
  const { supabase } = await requireAdmin();
  const scope = str(formData.get('scope')) === 'ad' ? 'ad' : 'concept';
  const conceptKey = str(formData.get('concept_key'));
  const adId = str(formData.get('ad_id'));
  const notes = str(formData.get('notes')).slice(0, 1000);
  const stageRaw = str(formData.get('stage')).toUpperCase();
  const stageTouched = formData.get('stage') !== null && str(formData.get('stage_edit')) === '1';
  const stage = stageRaw && stageRaw !== 'AUTO' ? STAGES[stageRaw] : null;
  if (stageRaw && stageRaw !== 'AUTO' && !stage) return { ok: false, message: 'Stage không hợp lệ.' };
  const linkText = str(formData.get('link'));
  const link = linkText ? parseAssetLink(linkText) : null;
  if (link?.kind === 'error') return { ok: false, message: link.message };
  if (!link && !stageTouched) return { ok: false, message: 'Dán link hoặc chọn stage.' };
  if (scope === 'concept' && (!conceptKey || conceptKey.length > 300)) return { ok: false, message: 'Thiếu concept.' };
  if (scope === 'ad' && !AD_ID.test(adId)) return { ok: false, message: 'Ad không hợp lệ.' };

  const find = supabase.from('creative_assets').select('id').eq('scope', scope);
  const { data: existing, error: fe } = await (scope === 'concept' ? find.eq('concept_key', conceptKey) : find.eq('ad_id', adId)).maybeSingle();
  if (fe) return { ok: false, message: `Không đọc được dữ liệu (${fe.message}).` };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (link?.kind === 'shot') {
    const shot = await resolveShot(link);
    if (!shot.ok) return { ok: false, message: shot.message };
    Object.assign(patch, { shot_code: shot.code, shot_url: shot.pageUrl, shot_image: shot.imageUrl });
  }
  if (notes) patch.notes = notes;
  if (stageTouched) patch.stage = stage;
  if (link?.kind === 'drive') Object.assign(patch, { drive_file_id: link.fileId, drive_url: `https://drive.google.com/file/d/${link.fileId}/view`, post_url: null });
  if (link?.kind === 'post') Object.assign(patch, { post_url: link.url, drive_file_id: null, drive_url: null });

  const { error } = existing
    ? await supabase.from('creative_assets').update(patch).eq('id', existing.id)
    : await supabase.from('creative_assets').insert({
        scope, concept_key: scope === 'concept' ? conceptKey : null, ad_id: scope === 'ad' ? adId : null, ...patch,
      });
  if (error) {
    const missing = /(stage|shot_)/.test(error.message) && /column|schema/i.test(error.message);
    return { ok: false, message: missing ? 'DB chưa có cột mới (stage / ảnh chụp). Chạy: npx supabase db push --linked' : `Không lưu được (${error.message}).` };
  }
  revalidatePath('/p', 'layout');
  return { ok: true, message: stageTouched && !link ? (stage ? `Đã gắn nhãn ${stage.replace('FU', '')}.` : 'Đã bỏ nhãn thủ công.') : link?.kind === 'shot' ? 'Đã lưu ảnh chụp (hiện làm ảnh bìa, video vẫn giữ link Drive).' : 'Đã lưu.' };
}

export async function removeAsset(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const id = str(formData.get('id'));
  if (!/^[0-9a-f-]{36}$/.test(id)) return;
  await supabase.from('creative_assets').delete().eq('id', id);
  revalidatePath('/p', 'layout');
}

/** Xem thử link prnt.sc trước khi lưu: trả link ảnh trên CDN để hiện ngay trong hộp thoại (chỉ admin). */
export async function previewShot(link: string): Promise<{ ok: true; imageUrl: string } | { ok: false; message: string }> {
  await requireAdmin();
  const parsed = parseAssetLink(String(link || ''));
  if (parsed.kind !== 'shot') return { ok: false, message: 'Đây không phải link prnt.sc.' };
  const r = await resolveShot(parsed);
  return r.ok ? { ok: true, imageUrl: r.imageUrl } : { ok: false, message: r.message };
}

/** Gỡ riêng ảnh chụp prnt.sc (giữ link Drive, stage, ghi chú). */
export async function removeShot(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const id = str(formData.get('id'));
  if (!/^[0-9a-f-]{36}$/.test(id)) return;
  await supabase.from('creative_assets').update({ shot_code: null, shot_url: null, shot_image: null, updated_at: new Date().toISOString() }).eq('id', id);
  revalidatePath('/p', 'layout');
}
