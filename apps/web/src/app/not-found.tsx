export const metadata = { title: 'Không tìm thấy', robots: { index: false } };

export default function NotFound() {
  return (
    <main className="center">
      <div className="card">
        <h1 className="brand">Không tìm thấy</h1>
        <p className="sub">Trang không tồn tại, hoặc link chia sẻ đã hết hạn / bị thu hồi.</p>
      </div>
    </main>
  );
}
