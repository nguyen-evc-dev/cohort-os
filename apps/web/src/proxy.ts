/**
 * Lớp kiểm tra thứ 1: làm mới phiên Supabase + chuyển hướng theo decideAccess.
 * (Lớp 2: requireAdmin() trong trang. Lớp 3: RLS trong database.)
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { decideAccess } from './lib/access';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return new NextResponse('Cohort OS chưa cấu hình Supabase.', { status: 500 });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() xác thực với Supabase Auth và làm mới token nếu cần.
  const { data: { user } } = await supabase.auth.getUser();
  let isAdmin = false;
  if (user) {
    const { data } = await supabase.rpc('is_admin');
    isAdmin = data === true;
  }

  const decision = decideAccess(request.nextUrl.pathname, { signedIn: !!user, isAdmin }, request.nextUrl.search);
  if (decision.action === 'redirect') {
    const redirect = NextResponse.redirect(new URL(decision.to, request.url));
    // Giữ cookie phiên vừa làm mới
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }
  return response;
}

export const config = {
  // Bỏ qua file tĩnh và ảnh tối ưu của Next
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
