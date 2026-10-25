import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { supabaseEnv } from './server';

/** Client ẩn danh (không dùng phiên đăng nhập) — chỉ cho các route công khai gọi hàm cổng (share_open, thumb_allowed). */
export function createAnonClient() {
  const { url, key } = supabaseEnv();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
