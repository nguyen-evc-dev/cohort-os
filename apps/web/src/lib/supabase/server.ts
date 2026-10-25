import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Thiếu NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  return { url, key };
}

/** Client Supabase phía server, dùng phiên đăng nhập trong cookie (RLS áp dụng). */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Gọi từ Server Component: không ghi cookie được; proxy đã làm mới phiên.
        }
      },
    },
  });
}

/**
 * Lớp kiểm tra thứ 2 (sau proxy): dùng ở đầu mọi trang/route nội bộ.
 * getUser() xác thực token với Supabase Auth (không tin cookie mù quáng); is_admin() kiểm tra bảng admins.
 */
export async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: isAdmin, error } = await supabase.rpc('is_admin');
  if (error || isAdmin !== true) redirect('/forbidden');
  return { supabase, user };
}
