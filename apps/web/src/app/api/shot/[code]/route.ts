import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isShotImageUrl, SHOT_CODE_RE } from '@/lib/drive';
import { fetchShotImage } from '@/lib/shot';

/**
 * Phục vụ ảnh chụp màn hình prnt.sc đã gắn vào creative, cùng origin (như /api/thumb cho Drive).
 * Công khai (share link cần xem được), nhưng chỉ phục vụ mã đã có trong creative_assets: hàm DB shot_image_for
 * trả link ảnh đã được admin lưu và kiểm tra lúc gắn. Không nhận link từ người gọi → không có SSRF.
 */
const notFound = () => new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!SHOT_CODE_RE.test(code)) return notFound();
  const supabase = await createClient();
  const { data } = await supabase.rpc('shot_image_for', { p_code: code });
  if (typeof data !== 'string' || !isShotImageUrl(data)) return notFound();
  const img = await fetchShotImage(data);
  if (!img) return notFound();
  return new NextResponse(img.buf, { headers: {
    'Content-Type': img.type, 'Cache-Control': 'public, max-age=86400, s-maxage=86400', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:",
  } });
}
