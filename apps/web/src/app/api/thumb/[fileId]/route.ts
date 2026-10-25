import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { FILE_ID_RE } from '@/lib/drive';

/**
 * Proxy ảnh Drive cùng origin (để html-to-image không dính CORS và share link không lộ link Drive).
 * Chỉ phục vụ fileId đã gắn trong creative_assets (hàm DB thumb_allowed), hoặc admin đang xem thử trước khi lưu.
 * Chống SSRF: host cố định, chỉ theo redirect tới domain Google, tối đa 3 bước, ảnh ≤ 6MB.
 */
const ALLOWED = (h: string) => h === 'drive.google.com' || h === 'docs.google.com' || h.endsWith('.googleusercontent.com') || h === 'lh3.google.com';
const MAX_BYTES = 6 * 1024 * 1024;
const notFound = () => new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  if (!FILE_ID_RE.test(fileId)) return notFound();

  const supabase = await createClient();
  let allowed = false;
  const { data: { user } } = await supabase.auth.getUser();
  if (user) allowed = (await supabase.rpc('is_admin')).data === true;
  if (!allowed) allowed = (await supabase.rpc('thumb_allowed', { p_file_id: fileId })).data === true;
  if (!allowed) return notFound();

  let url = `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
  for (let hop = 0; hop < 4; hop++) {
    const host = new URL(url).hostname;
    if (!ALLOWED(host)) return notFound();
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), next: { revalidate: 86400 } }).catch(() => null);
    if (!res) return notFound();
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return notFound();
      url = new URL(loc, url).toString();
      continue;
    }
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !/^image\/(png|jpe?g|webp|gif)/i.test(type)) return notFound(); // file chưa chia sẻ công khai → Google trả trang đăng nhập (HTML)
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return notFound();
    return new NextResponse(buf, { headers: {
      'Content-Type': type, 'Cache-Control': 'public, max-age=86400, s-maxage=86400', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:",
    } });
  }
  return notFound();
}
