import 'server-only';
import { extractShotImage, isShotImageUrl, type ParsedLink } from './drive';

/**
 * Ảnh chụp màn hình prnt.sc (Lightshot). Trang prnt.sc chỉ trả HTML cho trình duyệt (không có User-Agent thì lỗi 520),
 * ảnh thật nằm trên CDN img.lightshot.app. Server đọc trang MỘT LẦN lúc lưu để lấy link ảnh, rồi lưu link đó vào DB;
 * lúc hiển thị chỉ phục vụ ảnh qua /api/shot/<mã> (cùng origin: html-to-image không dính CORS, share link không lộ link gốc).
 * Chống SSRF: chỉ host cố định, không theo redirect ra ngoài danh sách, ảnh ≤ 6MB, thời gian chờ ngắn.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_HTML_BYTES = 600 * 1024;

export interface FetchedImage { buf: ArrayBuffer; type: string }

/** Tải ảnh từ CDN Lightshot. Chỉ nhận ảnh png / jpg / webp / gif; theo redirect tối đa 3 bước và chỉ trong danh sách host. */
export async function fetchShotImage(url: string): Promise<FetchedImage | null> {
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!isShotImageUrl(cur)) return null;
    const res = await fetch(cur, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'image/*' }, signal: AbortSignal.timeout(8000), next: { revalidate: 86400 } }).catch(() => null);
    if (!res) return null;
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return null;
      cur = new URL(loc, cur).toString();
      continue;
    }
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !/^image\/(png|jpe?g|webp|gif)/i.test(type)) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_IMAGE_BYTES) return null;
    const buf = await res.arrayBuffer();
    return buf.byteLength > MAX_IMAGE_BYTES ? null : { buf, type };
  }
  return null;
}

export type ResolvedShot = { ok: true; code: string; pageUrl: string | null; imageUrl: string } | { ok: false; message: string };

/** Từ link prnt.sc (hoặc link ảnh trực tiếp) → link ảnh trên CDN, đã kiểm tra tải được. */
export async function resolveShot(p: Extract<ParsedLink, { kind: 'shot' }>): Promise<ResolvedShot> {
  let imageUrl = p.imageUrl;
  if (!imageUrl) {
    const res = await fetch(p.pageUrl!, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(8000), cache: 'no-store' }).catch(() => null);
    if (!res || !res.ok) {
      return { ok: false, message: `Không đọc được trang prnt.sc${res ? ` (HTTP ${res.status})` : ''}. Cách khác: mở link, bấm chuột phải vào ảnh → Sao chép địa chỉ hình ảnh, rồi dán link ảnh (dạng https://img.lightshot.app/xxxx.png).` };
    }
    const finalHost = new URL(res.url).hostname.replace(/^www\./, '');
    if (finalHost !== 'prnt.sc' && finalHost !== 'prntscr.com') return { ok: false, message: 'Link prnt.sc chuyển hướng sang trang lạ nên em không đọc.' };
    const html = (await res.text()).slice(0, MAX_HTML_BYTES);
    imageUrl = extractShotImage(html);
    if (!imageUrl) return { ok: false, message: 'Trang prnt.sc không có ảnh (ảnh có thể đã bị xóa).' };
  }
  const img = await fetchShotImage(imageUrl);
  if (!img) return { ok: false, message: 'Tìm thấy link ảnh nhưng không tải được (ảnh lớn quá 6MB hoặc server ảnh từ chối).' };
  return { ok: true, code: p.code, pageUrl: p.pageUrl, imageUrl };
}
