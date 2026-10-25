import { sendMagicLink } from './actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <main className="center">
      <div className="card">
        <h1 className="brand">Cohort OS</h1>
        <p className="sub">Chỉ dành cho admin. Không có đăng ký mới.</p>
        {sp.sent ? (
          <p className="ok">Nếu email này có quyền truy cập, link đăng nhập đã được gửi. Mở email và bấm link trên <b>cùng trình duyệt</b> này.</p>
        ) : (
          <form action={sendMagicLink}>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required placeholder="nguyen@evancoaching.net" />
            <input type="hidden" name="next" value={sp.next || '/'} />
            <button type="submit">Gửi link đăng nhập</button>
            {sp.error === 'email' && <p className="err note">Email không hợp lệ.</p>}
            {sp.error === 'link' && <p className="err note">Link đăng nhập không hợp lệ hoặc đã hết hạn. Gửi lại link mới.</p>}
          </form>
        )}
      </div>
    </main>
  );
}
