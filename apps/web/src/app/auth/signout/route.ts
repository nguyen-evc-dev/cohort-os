import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** Chỉ nhận POST (form) để link GET không thể đăng xuất người dùng ngoài ý muốn. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', request.nextUrl.origin), { status: 303 });
}
