# apps/bot — Bé Sugar (Google Apps Script)

File trong `src/` là code Apps Script, đưa lên project **CohortOS-Engine**, tức project đang chứa Chat App Bé Sugar. Có 2 cách:

- **clasp:** copy `.clasp.json.example` thành `.clasp.json`, điền Script ID, rồi chạy `clasp push` trong thư mục này.
- **Copy tay:** trong editor Apps Script, tạo file cùng tên rồi dán nội dung vào (danh sách ở bảng dưới). Xóa file `Code.gs` cũ của bản bootstrap, vì `Chat.js` đã thay nó.

> Trước khi đưa lên: chạy `pnpm build:bot` ở gốc repo để sinh lại `src/Core.generated.js` (gói code lõi: kiểm tra số, quét PII, skill, audit SAC). `pnpm check:bot` kiểm tra file này không bị cũ. Sửa skill (`skills/*.md`) xong cũng phải chạy `pnpm build:skills` rồi `pnpm build:bot`.

## Script Properties (Project Settings → Script Properties)

| Property | Ý nghĩa |
|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `BOT_TOKEN` | Đọc Supabase qua `public.bot_read` (token lấy bằng `npm run bot:token` trên máy) |
| `AGENT_WEBHOOKS` | `{"alerts":"<URL>","analyst":"<URL>","ryg":"<URL>","auditor":"<URL>"}`. Agent nào thiếu thì dùng `alerts` |
| `ADMIN_EMAIL` | Email duy nhất được ra lệnh (mặc định `nguyen@evancoaching.net`) |
| `ANTHROPIC_API_KEY` | **Mới (Phase 4).** Cho `/analyze`, giải thích của `/ryg`, phần đọc nội dung / landing page của `/audit`. Không có thì `/campaigns`, `/report` và card `/ryg`, `/audit` vẫn chạy |
| `ALLOWED_SPACES` | Tùy chọn: thêm space được phục vụ, dạng `spaces/AAA,spaces/BBB`. Space của webhook Alerts luôn được phục vụ; tin nhắn riêng với admin luôn được |
| `WEB_BASE_URL` | `https://cohort-os-psi.vercel.app` (link trong card) |

## Sau khi đưa code lên
1. Điền Script Properties như trên.
2. Chạy `testConnection` một lần (đọc Supabase + gửi tin thử vào Alerts). Lần đầu Google sẽ xin thêm quyền (gọi dịch vụ bên ngoài, tạo trigger): bấm cho phép.
3. Chạy `installTriggers` một lần: cài **2 trigger cố định**, `tick` mỗi 10 phút (nhắc việc sau sync) và `processJobs` mỗi 1 phút (xử lý lệnh chậm `/ryg`, `/analyze`, `/audit`). Chạy lại nhiều lần không nhân đôi. Bot **không tạo trigger theo từng lệnh** (Apps Script giới hạn 20 trigger).
4. **Deploy → Manage deployments → Edit → Version: New version → Deploy**, giữ nguyên Deployment ID của Chat App.
5. Trong space **Bot Growth Command** gõ `/` phải thấy 6 lệnh. Thử `/report`.

## Lệnh

| Lệnh | Agent trả lời | Việc |
|---|---|---|
| `/campaigns` | 🔎 Sugar Analyst | Campaign đang chạy: trạng thái, SAC, chi tiêu 7 ngày, Project. **Chạy ngay** (vài giây) |
| `/report [project\|campaign] [7d\|30d\|all]` | 🔎 Sugar Analyst | Card theo **mục tiêu của Project**: chuyển đổi chính + CPA/CPL so target, chuỗi bước, Truth Gap, creative, đèn, link sâu về web. Không tốn token. **Chạy ngay** |
| `/ryg [project]` | 🚦 Sugar RYG | Card đèn đỏ / xanh / vàng (màu do code quyết định) + lời giải thích của Claude (skill `ryg-decision`) |
| `/analyze <câu hỏi>` | 🔎 Sugar Analyst | Claude phân tích sâu (skill `ads-deep-analysis` + `meta-ads-playbook`). Mọi số phải có trong dữ liệu, sai thì viết lại 1 lần, vẫn sai thì gắn cảnh báo |
| `/audit <campaign\|ad\|ID>` | 🛡️ Sugar Auditor | Card 🔴🟡🟢 do **code** tính (targeting SAC, cụm hứa hẹn thu nhập…) + Claude đọc copy và landing page (`web_fetch` chỉ `evancoaching.net` / `evancoaching.com`) |
| `/help` | trả ngay | Hướng dẫn |

Gõ câu tự do khi @Bé Sugar: bot tự chọn lệnh theo từ khóa (không tốn token), mặc định là `/analyze`.

## Bảo mật
- Chỉ trả lời email admin; thiếu email thì từ chối; ngoài space đã cấu hình (và không phải DM) thì từ chối.
- Bot chỉ đọc view `bot.v_*` qua `bot_read`: không đọc được lead / deal, không có connector Meta, không ghi Supabase.
- Số theo mục tiêu Project lấy từ **bản chụp báo cáo** (`bot_snapshots`) do sync / web tính sẵn bằng code của Web. Làm mới bằng `npm run sync:snapshots`, hoặc tự cập nhật sau `sync:push`, `import:meta` và import HubSpot trên web.
- Tin người dùng gõ, nội dung ad và landing page chỉ là **dữ liệu** đưa vào tin nhắn người dùng, không nằm trong system prompt. Quét PII trước khi gọi Claude (có email / SĐT thì không gửi). Copy quảng cáo được che email / SĐT trước khi gửi.
- Log mỗi lần gọi Claude (kích thước dữ liệu + câu trả lời, không PII, không key) nằm ở **Cloud Logging** của project Apps Script (Executions / Logs).

## Bot im lặng / không thấy trả lời? (làm theo thứ tự)
1. **Danh sách file phải đủ** trong Apps Script (copy tay dễ sót): `Core.generated`, `Logic`, `Config`, `Supabase`, `Cards`, `Alerts`, `Guard`, `Router`, `Reports`, `Claude`, `Commands`, `Jobs`, `Chat`, `Diag`. Xóa `Code.gs` cũ.
2. Chọn hàm **`selfCheck`** → ▶ Run → xem **Execution log**: báo thiếu file / hàm nào, thiếu Script Property nào, còn code Chat cũ đè không, đọc được Supabase không.
3. Chọn hàm **`testChat`** → ▶ Run. Lần đầu Google hiện hộp xin quyền mới (gọi dịch vụ bên ngoài, tạo trigger): **Review permissions → Allow**. Chạy xong, space nhận card báo cáo. Nếu lỗi, log hiện dòng gây lỗi.
4. **Deploy phải là "Manage deployments → ✏️ Edit → Version: New version → Deploy" trên deployment CŨ.** Tạo "New deployment" sẽ ra Deployment ID khác, còn Chat App vẫn trỏ ID cũ nên chạy code cũ.
5. Thấy tin hồng "Chỉ hiển thị với bạn" trong Chat: bấm vào đọc. Nếu là "Authorization required / Configuration required" thì làm bước 3. Từ bản này, lỗi bất ngờ trong code hiện thành tin "⚠️ Bé Sugar gặp lỗi khi nhận lệnh (…)" ngay trong Chat.
6. Lỗi "too many time-based triggers": là của bản cũ tạo mỗi lệnh 1 trigger. Bản mới không còn tạo. Chạy `cleanupTriggers` rồi `installTriggers` để dọn và cài lại đúng 2 trigger. `selfCheck` hiện số trigger và nhịp tim của bộ xử lý nền.
7. Xem chi tiết ở **Executions** (Thực thi) của Apps Script: mỗi lệnh gõ trong Chat là 1 dòng `onAppCommand`.

## Giới hạn đã biết
- `/audit` kèm landing page có thể mất 30–60 giây. Nếu quá thời gian chờ, bot vẫn gửi card 🔴🟡🟢 và báo phần đọc landing page chưa làm được; gõ lại với 1 ad cụ thể.
- Lệnh chậm (`/ryg`, `/analyze`, `/audit`) trả lời trong khoảng 1–2 phút (trigger chạy mỗi phút). Việc xếp hàng chờ quá 10 phút thì bị bỏ (anh đã gõ lại).

| File | Việc |
|---|---|
| `Core.generated.js` | **Tự sinh** từ `packages/core`: kiểm tra số "có căn cứ", quét PII, nội dung skill, soát SAC. Không sửa tay |
| `Logic.js` | Hàm thuần nhắc việc: `planAlerts`, `summarizeDay`, `alertText` |
| `Alerts.js` | `tick` (trigger 10 phút), `installTriggers`, `testConnection`, `resetAlertState` |
| `Supabase.js` | `botRead_(view, since)` gọi `public.bot_read` |
| `Cards.js` | Gửi tin / card vào webhook theo agent |
| `Guard.js` | Đọc event Chat, kiểm tra email + space |
| `Router.js` | Phân loại câu tự do, tách `7d/30d/all`, chọn Project / campaign từ chữ gõ |
| `Reports.js` | Dựng card `/campaigns`, `/report`, `/ryg` |
| `Claude.js` | Gọi Claude, quét PII, kiểm tra số có căn cứ, log |
| `Commands.js` | Thực thi từng lệnh (kể cả `/audit` với `web_fetch`) |
| `Jobs.js` | Lệnh nhanh chạy ngay; lệnh chậm xếp hàng (Script Properties), trigger cố định mỗi phút xử lý, "nhịp tim" để Chat biết bộ xử lý còn sống |
| `Chat.js` | `onMessage`, `onAppCommand`, `onAddedToSpace` (lỗi bất ngờ hiện thành tin báo lỗi trong Chat) |
| `Diag.js` | `selfCheck` (kiểm tra đủ file / cấu hình), `testChat` (giả lập `/report webinar` từ admin) |

Test: `pnpm --filter @cohort/bot test`. Các file `src/*.js` được nạp vào sandbox giả lập Apps Script (`test/gas.ts`).
