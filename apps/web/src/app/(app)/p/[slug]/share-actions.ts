'use server';
import { shotKey } from '@/lib/drive';
import crypto from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { buildShareSnapshot, SHARE_TTL_HOURS, type ShareTtl } from '@cohort/core';
import { requireAdmin } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/server-data';
import { fetchAll, loadReport } from '@/lib/data';
import { parseFilters } from '@/lib/filters';
import { fmtRange } from '@/lib/format';

export type ShareResult = { ok: true; url: string; expiresAt: string } | { ok: false; error: string };
interface Input { slug: string; d?: string; from?: string; to?: string; src?: string; ttl: string; hideMoney: boolean }

/**
 * Tạo share link: server TỰ TÍNH LẠI báo cáo (không tin số do trình duyệt gửi), cắt thành snapshot đóng băng,
 * rồi lưu vào `shares` với token ngẫu nhiên 32 byte. Link hết hạn / thu hồi được.
 */
export async function createShare(input: Input): Promise<ShareResult> {
  const { supabase } = await requireAdmin();
  if (!(input.ttl in SHARE_TTL_HOURS)) return { ok: false, error: 'Thời hạn không hợp lệ.' };
  const ws = await getWorkspace();
  const f = parseFilters({ d: input.d, from: input.from, to: input.to, src: input.src }, ws.latestDate);
  const loaded = await loadReport(supabase, ws, String(input.slug), f);
  if (!loaded) return { ok: false, error: 'Không tìm thấy Project.' };

  const assets = await fetchAll((a, b) => supabase.from('creative_assets').select('scope,concept_key,ad_id,drive_file_id,shot_code').order('id').range(a, b)).catch(() => fetchAll((a, b) => supabase.from('creative_assets').select('scope,concept_key,ad_id,drive_file_id').not('drive_file_id', 'is', null).order('id').range(a, b)));
  const thumbs: Record<string, string> = {};
  for (const c of loaded.report.concepts) {
    const hit = assets.find((x) => (x.scope === 'concept' && x.concept_key === c.conceptKey) || (x.scope === 'ad' && c.ads.includes(String(x.ad_id))));
    const key = hit?.shot_code ? shotKey(hit.shot_code as string) : (hit?.drive_file_id as string | null | undefined);
    if (key) thumbs[c.conceptKey] = key;
  }

  let snapshot;
  try {
    snapshot = buildShareSnapshot({
      title: `${loaded.project.name} · ${fmtRange(f.from, f.to)}`, projectName: loaded.project.name, report: loaded.report,
      src: f.src, hideMoney: !!input.hideMoney, thumbs,
    });
  } catch (e) { return { ok: false, error: (e as Error).message }; }

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SHARE_TTL_HOURS[input.ttl as ShareTtl] * 3_600_000).toISOString();
  const { error } = await supabase.from('shares').insert({ token, title: snapshot.title, snapshot, hide_money: snapshot.hideMoney, expires_at: expiresAt });
  if (error) return { ok: false, error: `Không tạo được link (${error.message}).` };

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3100';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  revalidatePath('/settings');
  return { ok: true, url: `${proto}://${host}/s/${token}`, expiresAt };
}

export async function revokeShare(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin();
  const token = String(formData.get('token') ?? '');
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(token)) return;
  await supabase.from('shares').update({ revoked_at: new Date().toISOString() }).eq('token', token).is('revoked_at', null);
  revalidatePath('/settings');
}
