/**
 * Quyết định truy cập — hàm thuần, test được không cần server.
 * Chỉ 1 admin dùng app. Mọi route đều cần đăng nhập + là admin, trừ danh sách công khai.
 */

/** Route không cần đăng nhập. `/s/` = share link snapshot, `/api/thumb/` và `/api/shot/` = ảnh creative (Drive / prnt.sc) qua proxy. */
export const PUBLIC_PREFIXES = ['/login', '/auth/callback', '/s/', '/api/thumb/', '/api/shot/'] as const;
/** Route cho người đã đăng nhập nhưng KHÔNG phải admin (để thấy thông báo và đăng xuất). */
export const NON_ADMIN_ALLOWED = ['/forbidden', '/auth/signout'] as const;

export type AccessDecision =
  | { action: 'allow' }
  | { action: 'redirect'; to: string };

export interface AccessState { signedIn: boolean; isAdmin: boolean }

const matches = (path: string, prefixes: readonly string[]) =>
  prefixes.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)));

/** Chỉ chấp nhận đường dẫn nội bộ cho ?next= (chặn chuyển hướng ra domain khác). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (matches(next, PUBLIC_PREFIXES) || matches(next, NON_ADMIN_ALLOWED)) return '/';
  return next;
}

export function decideAccess(pathname: string, state: AccessState, search = ''): AccessDecision {
  if (matches(pathname, PUBLIC_PREFIXES)) {
    // Admin đã đăng nhập mà mở /login → về trang chính
    if (pathname === '/login' && state.signedIn && state.isAdmin) return { action: 'redirect', to: '/' };
    return { action: 'allow' };
  }
  if (!state.signedIn) {
    const next = safeNext(pathname + search);
    return { action: 'redirect', to: next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}` };
  }
  if (!state.isAdmin) {
    return matches(pathname, NON_ADMIN_ALLOWED) ? { action: 'allow' } : { action: 'redirect', to: '/forbidden' };
  }
  if (pathname === '/forbidden') return { action: 'redirect', to: '/' };
  return { action: 'allow' };
}
