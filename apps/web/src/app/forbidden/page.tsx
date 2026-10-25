export default function ForbiddenPage() {
  return (
    <main className="center">
      <div className="card">
        <h1 className="brand">Không có quyền</h1>
        <p className="sub">Tài khoản này không phải admin của Cohort OS.</p>
        <form action="/auth/signout" method="post">
          <button type="submit" className="ghost">Đăng xuất</button>
        </form>
      </div>
    </main>
  );
}
