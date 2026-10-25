---
name: meta-ads-prompts
description: >
  Dùng skill này BẤT CỨ KHI NÀO người dùng muốn làm bất kỳ thao tác nào liên quan đến Meta Ads /
  Facebook Ads: phân tích hiệu suất, theo dõi real-time, tối ưu creative, quản lý audience, phân bổ
  budget, chạy báo cáo, chuẩn bị sale/Black Friday, hay khắc phục sự cố (pixel, ad bị reject, campaign
  học mãi không xong...). Trigger khi người dùng nói: "check ads", "phân tích campaign", "báo cáo hôm qua",
  "tối ưu budget", "creative nào đang tốt", "health check", "tìm ad set lãng phí", "morning report",
  "BF prep", hoặc bất kỳ yêu cầu nào liên quan đến quản lý quảng cáo Meta/Facebook.
---

# Meta Ads Prompts — Thư viện Prompt Tối ưu

Bộ prompt được tổ chức theo 11 nhóm use case. Khi được trigger, hiển thị menu cho người dùng chọn nhóm,
rồi hỏi thêm để chọn prompt cụ thể, cuối cùng thực thi bằng Meta Ads MCP tools.

---

## Cách thực thi

### Bước 1 — Hiển thị menu nhóm

Khi skill được trigger, LUÔN bắt đầu bằng cách hỏi người dùng muốn làm gì. Nếu request của họ đã đủ rõ
(ví dụ: "health check buổi sáng", "morning report"), nhảy thẳng vào Bước 3.

Nếu cần menu, trình bày ngắn gọn:

```
Mày muốn làm gì với Meta Ads?

1. 📊 Phân tích trước khi chạy — tổng quan tài khoản, benchmark, lập ngân sách
2. 🔴 Theo dõi real-time — health check sáng, auto-pause, frequency monitoring
3. 🎨 Phân tích Creative — winner detection, pattern, A/B test setup
4. 🎯 Audience & Targeting — cross-segment matrix, lookalike, geo insights
5. 💰 Budget & Bidding — reallocation, CBO vs ABO, scaling rule
6. 🛍️ Catalog & Dynamic Ads — health check catalog, DPA winner, cross-sell
7. 📈 Báo cáo — daily morning, weekly, monthly, stakeholder summary
8. 🔥 Black Friday / Mega Sale — chuẩn bị, monitoring, hậu BF
9. ⚡ Quick Action — pause hàng loạt, tăng budget, tắt fatigue (copy-paste ngay)
10. 🤖 Auto Workflow — daily auto-pilot, anomaly detection
11. 🔧 Khắc phục sự cố — campaign stuck learning, ROAS giảm, ad bị reject, pixel lỗi
```

### Bước 2 — Hỏi thêm nếu cần

Sau khi người dùng chọn nhóm, đọc `references/prompts.md` — tìm đúng section tương ứng, show các prompt
trong nhóm đó và hỏi họ muốn dùng cái nào. Nếu chỉ có 1 prompt phù hợp thì chạy luôn.

Với các prompt có placeholder `[X]`, hỏi người dùng để điền số liệu thực tế trước khi chạy.

### Bước 3 — Thực thi bằng Meta Ads MCP

Dùng các Meta Ads MCP tools (`ads_get_ad_entities`, `ads_insights_performance_trend`,
`ads_insights_advertiser_context`, `ads_get_ad_accounts`, v.v.) để lấy data thực tế và phân tích
theo đúng cấu trúc của prompt đã chọn trong `references/prompts.md`.

**Nguyên tắc quan trọng:**
- Các prompt đánh dấu ⚠️ là thao tác thay đổi data (pause, update budget, duplicate...) — LUÔN liệt kê
  danh sách để người dùng confirm trước, KHÔNG tự thực hiện bất kỳ thay đổi nào.
- Các prompt 🔥 là hay dùng nhất, ưu tiên gợi ý khi người dùng mô tả vague.
- Nếu người dùng nói "cho tao 3 dòng" hoặc đang trong meeting → trả lời cực ngắn, chỉ top-line numbers
  + 1 action cấp bách nhất nếu có.
- Trình bày kết quả dạng bảng hoặc bullet ngắn gọn, dễ đọc. Không dài dòng.

---

## Tham chiếu

Toàn bộ 50+ prompt nằm trong: `references/prompts.md`

File chia theo 11 section khớp với menu. Đọc đúng section khi người dùng chọn nhóm — không cần đọc toàn bộ file.
