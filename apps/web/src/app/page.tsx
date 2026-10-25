import { requireAdmin } from '@/lib/supabase/server';

// Trang chủ tạm (T0.3) — Overview thật làm ở T2.2.
export default async function Home() {
  const { user } = await requireAdmin();
  return (
    <main className="center">
      <div className="card">
        <h1 className="brand">Cohort OS</h1>
        <p className="sub">Đăng nhập thành công · <span className="pill">admin ✓</span></p>
        <p className="note">Tài khoản: <b>{user.email}</b></p>
        <p className="note">Dashboard báo cáo sẽ có ở các ticket T2.x.</p>
        <form action="/auth/signout" method="post">
          <button type="submit" className="ghost">Đăng xuất</button>
        </form>
      </div>
    </main>
  );
}
