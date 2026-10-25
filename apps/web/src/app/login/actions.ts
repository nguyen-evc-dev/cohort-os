'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/access';

/**
 * Gửi link đăng nhập qua email.
 * shouldCreateUser: false → không bao giờ tạo tài khoản mới (kể cả khi ai đó lỡ bật lại đăng ký trên Supabase).
 * Luôn hiện cùng một thông báo, dù email có tài khoản hay không → không dò được ai có tài khoản.
 */
export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const next = safeNext(String(formData.get('next') || '/'));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect(`/login?error=email&next=${encodeURIComponent(next)}`);

  const h = await headers();
  const origin = h.get('origin') || `${h.get('x-forwarded-proto') || 'http'}://${h.get('host')}`;
  const supabase = await createClient();
  await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  redirect('/login?sent=1');
}
