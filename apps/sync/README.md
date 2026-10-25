# apps/sync — CLI trên máy Nguyên

| Lệnh (chạy ở gốc `cohort-os`) | Việc |
|---|---|
| `npm run sync:gate` | In `RUN <ngày>` / `SKIP <lý do> <ngày>` / `ERROR …`. Chỉ đọc `sync_runs` |
| `npm run sync:push -- sync/inbox/<thư mục>` | Đọc JSON agent ghi → kiểm tra (tổng spend theo ngày lệch ≤ 1%, đủ ngày, không trùng, đúng tài khoản) → upsert `meta_*` → tính lại `signals` → ghi `sync_runs`. Mã thoát: 0 ok · 2 bị từ chối (DB không đổi) · 1 lỗi. Xóa inbox cũ hơn 14 ngày |
| `npm run bot:token` | Tạo token mới cho Bé Sugar (in ra 1 lần), lưu SHA-256 vào `bot_tokens`, thu hồi token cũ |

- Đọc key từ `cohort-os/.env.local` (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `META_AD_ACCOUNT_ID`, `REPORT_TZ`).
- Định dạng thư mục inbox: xem đầu file [src/inbox.ts](src/inbox.ts) và [agent/meta-sync.md](../../agent/meta-sync.md) mục 3.
- Test: `pnpm --filter @cohort/sync test` (dùng `MemoryStore`, không cần mạng).
