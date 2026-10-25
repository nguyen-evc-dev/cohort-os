# apps/bot — Bé Sugar (Google Apps Script)

File trong `src/` là code Apps Script, đưa lên project **CohortOS-Engine**, tức project đang chứa Chat App Bé Sugar. Có 2 cách:

- **clasp:** copy `.clasp.json.example` thành `.clasp.json`, điền Script ID, rồi chạy `clasp push` trong thư mục này.
- **Copy tay:** trong editor Apps Script, tạo file cùng tên (`Logic`, `Config`, `Supabase`, `Cards`, `Alerts`, `Chat`) rồi dán nội dung vào. Xóa file `Code.gs` cũ của bản bootstrap, vì `Chat.js` đã thay nó.

Sau khi đưa code lên:
1. **Script Properties:** `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `BOT_TOKEN` (lấy bằng `npm run bot:token` trên máy), `AGENT_WEBHOOKS`, `ADMIN_EMAIL`, `WEB_BASE_URL`.
2. Chạy hàm `testConnection` một lần. Bé Sugar Alerts sẽ gửi tin thử vào space.
3. Chạy hàm `installTriggers` một lần để cài trigger `tick` 10 phút.
4. **Deploy → Manage deployments → Edit → Version: New version → Deploy**, giữ nguyên Deployment ID của Chat App.

| File | Việc |
|---|---|
| `Logic.js` | Hàm thuần: `planAlerts` (khi nào báo / nhắc), `summarizeDay`, `alertText`. Có test |
| `Alerts.js` | `tick` (trigger 10 phút), `installTriggers`, `testConnection`, `resetAlertState` |
| `Supabase.js` | `botRead_(view, since)` gọi `public.bot_read`: token bot, chạy bằng quyền `bot_reader`, chỉ đọc view `bot.v_*` |
| `Cards.js` | Gửi tin / card vào webhook theo agent (`AGENT_WEBHOOKS`) |
| `Chat.js` | Chat App nhận lệnh. Hiện mới có `/help`; các lệnh khác làm ở T4.x |

Test: `pnpm --filter @cohort/bot test`. Các file `src/*.js` được nạp vào sandbox giả lập Apps Script.
