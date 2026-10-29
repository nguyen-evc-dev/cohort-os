/**
 * Phân loại link gắn vào creative: file Drive (ảnh / video), ảnh chụp màn hình prnt.sc (Lightshot), hoặc bài đăng Facebook / Instagram.
 * Hàm thuần để test. Ảnh chụp prnt.sc dùng làm ảnh bìa; video vẫn lấy từ link Drive.
 */
export type ParsedLink =
  | { kind: 'drive'; fileId: string }
  | { kind: 'post'; url: string }
  /** pageUrl = trang prnt.sc (cần đọc ra link ảnh); imageUrl = link ảnh trực tiếp trên CDN Lightshot (nếu người dùng dán thẳng) */
  | { kind: 'shot'; code: string; pageUrl: string | null; imageUrl: string | null }
  | { kind: 'error'; message: string };

export const FILE_ID_RE = /^[A-Za-z0-9_-]{10,120}$/;
export const SHOT_CODE_RE = /^[A-Za-z0-9_-]{4,40}$/;
const POST_HOSTS = ['facebook.com', 'fb.com', 'fb.watch', 'instagram.com'];
const SHOT_PAGE_HOSTS = ['prnt.sc', 'prntscr.com'];
/** CDN ảnh Lightshot (mới và cũ). Chỉ host đúng này, không nhận subdomain lạ. */
export const SHOT_IMAGE_HOSTS = ['img.lightshot.app', 'image.prntscr.com', 'i.imgur.com'];
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

/** Link ảnh trực tiếp hợp lệ: https, đúng host CDN Lightshot, đuôi ảnh, không có thông tin đăng nhập / cổng lạ. */
export function isShotImageUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  return u.protocol === 'https:' && !u.username && !u.password && (u.port === '' || u.port === '443')
    && SHOT_IMAGE_HOSTS.includes(u.hostname.toLowerCase()) && IMAGE_EXT.test(u.pathname) && u.pathname.length <= 200;
}

/** Lấy link ảnh từ thẻ og:image (hoặc ảnh chính) của trang prnt.sc. Trả null nếu không có. */
export function extractShotImage(html: string): string | null {
  const og = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html) ?? /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);
  const img = /<img[^>]+id=["']screenshot-image["'][^>]+src=["']([^"']+)["']/i.exec(html) ?? /<img[^>]+src=["']([^"']+)["'][^>]+id=["']screenshot-image["']/i.exec(html);
  for (const c of [og?.[1], img?.[1]]) {
    if (!c) continue;
    const abs = c.startsWith('//') ? `https:${c}` : c;
    if (isShotImageUrl(abs)) return abs;
  }
  return null;
}

export function parseAssetLink(input: string): ParsedLink {
  const raw = String(input || '').trim();
  if (!raw) return { kind: 'error', message: 'Chưa dán link.' };
  if (/^[A-Za-z0-9_-]{25,60}$/.test(raw)) return { kind: 'drive', fileId: raw };
  let u: URL;
  try { u = new URL(raw); } catch { return { kind: 'error', message: 'Không đọc được link. Dán đầy đủ, bắt đầu bằng https://' }; }
  if (u.protocol !== 'https:') return { kind: 'error', message: 'Chỉ nhận link https.' };
  if (u.username || u.password) return { kind: 'error', message: 'Link có thông tin đăng nhập, hãy dán link sạch.' };
  const host = u.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'drive.google.com') {
    if (/\/drive\/(u\/\d+\/)?folders\//.test(u.pathname)) return { kind: 'error', message: 'Đây là link thư mục. Mở file ảnh/video rồi chọn Chia sẻ → Sao chép đường liên kết.' };
    const m = u.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    const id = m?.[1] ?? u.searchParams.get('id');
    if (id && FILE_ID_RE.test(id)) return { kind: 'drive', fileId: id };
    return { kind: 'error', message: 'Không tìm thấy mã file trong link Drive.' };
  }
  if (SHOT_PAGE_HOSTS.includes(host)) {
    const code = u.pathname.split('/').filter(Boolean)[0] ?? '';
    if (u.pathname.split('/').filter(Boolean).length !== 1 || !SHOT_CODE_RE.test(code)) return { kind: 'error', message: 'Link prnt.sc không đúng dạng https://prnt.sc/xxxxxxx.' };
    return { kind: 'shot', code, pageUrl: `https://prnt.sc/${code}`, imageUrl: null };
  }
  if (SHOT_IMAGE_HOSTS.includes(u.hostname.toLowerCase())) {
    const clean = `https://${u.hostname.toLowerCase()}${u.pathname}`;
    const stem = (u.pathname.split('/').pop() ?? '').replace(IMAGE_EXT, '');
    if (!isShotImageUrl(clean) || !SHOT_CODE_RE.test(stem)) return { kind: 'error', message: 'Link ảnh không đúng dạng (cần đuôi .png / .jpg).' };
    return { kind: 'shot', code: stem, pageUrl: null, imageUrl: clean };
  }
  if (POST_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    if (u.search.length > 300 || /[?&](access_token|token)=/i.test(u.search)) return { kind: 'error', message: 'Link có tham số lạ, hãy dán link bài đăng sạch.' };
    return { kind: 'post', url: `${u.origin}${u.pathname}${u.search}` };
  }
  return { kind: 'error', message: 'Chỉ nhận link Google Drive, ảnh chụp prnt.sc hoặc bài đăng Facebook / Instagram.' };
}

/**
 * Khóa ảnh bìa của 1 creative: mã prnt.sc → "s~<mã>" (ưu tiên), nếu không có thì fileId Drive.
 * "~" không nằm trong FILE_ID_RE nên không thể trùng với fileId Drive.
 */
export const shotKey = (code: string) => `s~${code}`;
export function thumbSrc(key: string): string {
  return key.startsWith('s~') ? `/api/shot/${encodeURIComponent(key.slice(2))}` : `/api/thumb/${key}`;
}
