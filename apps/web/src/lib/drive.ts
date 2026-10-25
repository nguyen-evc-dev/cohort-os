/** Tách fileId từ link Drive, hoặc nhận link bài đăng Facebook / Instagram. Hàm thuần để test. */
export type ParsedLink =
  | { kind: 'drive'; fileId: string }
  | { kind: 'post'; url: string }
  | { kind: 'error'; message: string };

export const FILE_ID_RE = /^[A-Za-z0-9_-]{10,120}$/;
const POST_HOSTS = ['facebook.com', 'fb.com', 'fb.watch', 'instagram.com'];

export function parseAssetLink(input: string): ParsedLink {
  const raw = String(input || '').trim();
  if (!raw) return { kind: 'error', message: 'Chưa dán link.' };
  if (/^[A-Za-z0-9_-]{25,60}$/.test(raw)) return { kind: 'drive', fileId: raw };
  let u: URL;
  try { u = new URL(raw); } catch { return { kind: 'error', message: 'Không đọc được link. Dán đầy đủ, bắt đầu bằng https://' }; }
  if (u.protocol !== 'https:') return { kind: 'error', message: 'Chỉ nhận link https.' };
  const host = u.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'drive.google.com') {
    if (/\/drive\/(u\/\d+\/)?folders\//.test(u.pathname)) return { kind: 'error', message: 'Đây là link thư mục. Mở file ảnh/video rồi chọn Chia sẻ → Sao chép đường liên kết.' };
    const m = u.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    const id = m?.[1] ?? u.searchParams.get('id');
    if (id && FILE_ID_RE.test(id)) return { kind: 'drive', fileId: id };
    return { kind: 'error', message: 'Không tìm thấy mã file trong link Drive.' };
  }
  if (POST_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    if (u.search.length > 300 || /[?&](access_token|token)=/i.test(u.search)) return { kind: 'error', message: 'Link có tham số lạ, hãy dán link bài đăng sạch.' };
    return { kind: 'post', url: `${u.origin}${u.pathname}${u.search}` };
  }
  return { kind: 'error', message: 'Chỉ nhận link Google Drive hoặc bài đăng Facebook / Instagram.' };
}
