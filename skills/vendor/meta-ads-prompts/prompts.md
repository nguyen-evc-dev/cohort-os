# THƯ VIỆN PROMPT TỐI ƯU QUẢNG CÁO FACEBOOK / META ADS

> Bộ prompt cho Claude AI (kết nối Meta Ads MCP). Copy → paste → tinh chỉnh số liệu cho phù hợp tài khoản của bạn.

**Ghi chú đọc:**
- `[X]` = thay bằng số/text cụ thể của bạn
- 🔥 = prompt chủ lực, dùng nhiều
- ⚠️ = prompt thay đổi data, cần review kỹ trước khi approve

---

## MỤC LỤC

1. [Phân tích trước khi chạy chiến dịch](#1-phân-tích-trước-khi-chạy-chiến-dịch)
2. [Theo dõi real-time](#2-theo-dõi-real-time)
3. [Phân tích Creative](#3-phân-tích-creative)
4. [Phân tích Audience & Targeting](#4-phân-tích-audience--targeting)
5. [Tối ưu Budget & Bidding](#5-tối-ưu-budget--bidding)
6. [Catalog & Dynamic Ads](#6-catalog--dynamic-ads)
7. [Báo cáo & tổng kết](#7-báo-cáo--tổng-kết)
8. [Black Friday / Mega Sale](#8-black-friday--mega-sale)
9. [Quick action — copy paste dùng liền](#9-quick-action--copy-paste-dùng-liền)
10. [Prompt nâng cao — auto workflow](#10-prompt-nâng-cao--auto-workflow)
11. [Prompt khắc phục sự cố](#11-prompt-khắc-phục-sự-cố)

---

## 1. Phân tích trước khi chạy chiến dịch

### 🔥 Tổng quan tài khoản

```
Đưa cho tao bức tranh tổng thể tài khoản 90 ngày qua:
- Tổng spend, revenue, ROAS, CPA trung bình
- Top 5 campaign về spend & top 5 về ROAS
- Tỉ lệ active vs paused ad set
- Audience saturation: tổng reach / total addressable market ước tính
- Phân bổ ngân sách hiện tại theo objective (Conversions / Traffic / Awareness…)
Trình bày dạng bảng + 3 insight quan trọng nhất.
```

### Benchmark từ data quá khứ

```
Lấy data tất cả campaign trong cùng kỳ năm trước (DD/MM – DD/MM/YYYY). Phân tích:
- Top 5 ad set ROAS cao nhất (tên, audience, creative angle)
- Top 5 creative CTR > 2% (mô tả nội dung)
- Audience nào convert tốt nhất theo từng product category
- Giờ vàng (theo CVR và CPA)
- Tỉ lệ phân bổ giữa cold / warm / retargeting
Output dạng bảng có thể copy sang Excel.
```

### Lập kế hoạch ngân sách

```
Tao có ngân sách [X] triệu cho [N] ngày. Mục tiêu: [Y] đơn / ROAS [Z].
Dựa trên CPA và ROAS trung bình 90 ngày qua của tài khoản, hãy:
1. Tính khả thi của mục tiêu (có hợp lý không)
2. Đề xuất phân bổ ngân sách theo:
   - Objective (Conversions / Catalog Sales / Traffic)
   - Audience tier (cold / warm / retargeting / customer)
   - Creative type (video / image / carousel / collection)
3. Đề xuất số lượng ad set & ad cần tạo
4. Mốc daily spend từng giai đoạn
```

### Competitive analysis

```
Tao đang chuẩn bị launch sản phẩm [tên sp] giá [X]. Dựa vào lịch sử tài khoản và
kiến thức của mày về ngành [ngành]:
- CPA hợp lý nên target khoảng bao nhiêu?
- ROAS break-even là bao nhiêu nếu margin của tao là [Y]%?
- Audience nào nên test trước, audience nào nên tránh?
- 3 angle creative phổ biến nhất ngành này hiện nay?
```

---

## 2. Theo dõi real-time

### 🔥 Health check buổi sáng

```
Quét toàn bộ active ad set từ 0h đến giờ. Flag những cái có:
- CPM tăng >30% so với 7 ngày trước
- CTR giảm >40% so với baseline ad set đó
- Frequency >3.5
- CPA vượt target [X]đ
- Spend >50% daily budget mà chưa có conversion
Cho mỗi cái: nguyên nhân khả nghi + hành động đề xuất (pause / giảm budget / đổi creative / hold).
```

### 🔥 ⚠️ Auto-pause underperformer

```
Tìm ad set match TẤT CẢ điều kiện sau:
- Spend >[X]đ trong 24h qua
- 0 conversion HOẶC CPA > 2× target
- Frequency > 3
- Đã chạy >48h
List ra trước, tao confirm rồi mày mới pause.
```

### Realtime conversion tracking

```
Liệt kê 20 conversion gần nhất (24h qua):
- Thời gian, ad set, ad, audience type
- Giá trị đơn (nếu có Purchase event)
- Device, placement
Phát hiện pattern: giờ nào / placement nào / audience nào đang convert mạnh.
```

### Frequency cap monitoring

```
Cho tao danh sách top 10 ad set có frequency cao nhất hiện tại.
Với mỗi ad set:
- Frequency tuần này vs tuần trước
- CTR & CVR đang giảm bao nhiêu %
- Đề xuất: refresh creative / mở rộng audience / pause / hold
```

---

## 3. Phân tích Creative

### 🔥 Creative winner detection

```
Trong 30 ngày qua, xếp hạng tất cả ads theo các metric sau và phân nhóm:
- Hook rate = 3-second view / impression
- Hold rate = 15-second view / 3-second view
- CTR (link click / impression)
- CVR (purchase / link click)
Phân nhóm:
- 🥇 SCALE-READY: top 10%, đủ data, ROAS > 3
- 🔁 ITERATE: metric tốt nhưng chưa đủ data → test variation
- ⚠️ FATIGUE: ROAS giảm dần 7 ngày liên tiếp
- ❌ KILL: spend > [X]đ, 0–1 conversion, CTR < [Y]%
Mô tả chung pattern của nhóm SCALE-READY.
```

### Creative pattern analysis

```
Phân tích top 10 ads ROAS cao nhất quý này theo các yếu tố:
- Format (video / static / carousel / collection)
- Độ dài video (nếu video)
- Có hiển thị giá / discount trong 3 giây đầu không?
- Có UGC / KOL / studio shot không?
- Tone: urgency / storytelling / problem-solution / social proof
- CTA chính (Shop now / Learn more / Sign up...)
- Có voiceover / chỉ subtitle?
Tìm 3 pattern chung quan trọng nhất.
```

### Creative refresh cycle

```
Ad set nào đang chạy creative cũ hơn 14 ngày VÀ frequency > 3.5?
Với mỗi cái, đề xuất 3 creative variation mới:
- Variation 1: giữ visual, đổi hook + caption
- Variation 2: giữ message, đổi format (vd image → video)
- Variation 3: thử angle hoàn toàn mới
Mô tả ý tưởng cụ thể (không cần chi tiết sản xuất).
```

### A/B test setup

```
Tao có 3 hook video mới: [hook 1], [hook 2], [hook 3].
Thiết kế A/B test:
- Cấu trúc campaign / ad set
- Audience nên test (đề xuất 1 audience duy nhất, đủ size)
- Budget tối thiểu để có statistical significance
- Thời gian test (số ngày)
- Metric quyết định winner (CTR / CVR / ROAS / CPA)
- Khi nào dừng test sớm
```

---

## 4. Phân tích Audience & Targeting

### 🔥 Cross-segment performance matrix

```
Cho từng tổ hợp Age × Gender × Placement, tính:
- Spend, ROAS, CPA, CVR, CTR
Trong 30 ngày qua, list 10 segment:
- "Hidden gem": volume thấp (<5% total spend) nhưng ROAS top 20%
- "Money pit": spend lớn nhưng ROAS dưới trung bình
Đề xuất hành động cho từng nhóm.
```

### Lookalike performance comparison

```
So sánh hiệu quả LAL 1%, 2%, 3%, 5%, 10% trong 60 ngày qua:
- ROAS, CPA, CTR, scale potential
- LAL build từ source nào hiệu quả nhất (Purchasers / Add to Cart / Email list / Pixel events / Engagement)?
- Đề xuất 3 LAL mới đáng test cho quý tới
```

### Custom audience health

```
List tất cả custom audience đang dùng trong active ad set:
- Size hiện tại
- Status (Ready / Below 1000 / Empty)
- Last update
- Performance ROAS so với cold audience
Flag những audience đang dưới ngưỡng size tối thiểu hoặc chưa update >30 ngày.
```

### Geo & demographic insights

```
Phân tích chi tiết theo địa lý (province / region):
- Top 10 tỉnh/thành ROAS cao nhất
- Top 5 tỉnh/thành CPA cao bất thường (cần loại trừ?)
- Phân bổ spend hiện tại có match với phân bổ revenue không?
Đề xuất: tỉnh nào nên tăng budget, tỉnh nào nên exclude.
```

---

## 5. Tối ưu Budget & Bidding

### 🔥 Budget reallocation đề xuất

```
Với tổng daily budget hiện tại của campaign [tên]:
- Tìm ad set ROAS dưới 1.5 (đốt tiền)
- Tổng budget của nhóm này
- Đề xuất chuyển 70% sang top 3 ad set ROAS > 3 nhưng chưa scale hết tiềm năng
  (chưa hit budget cap, frequency < 2)
Output: bảng "from → to" với số tiền cụ thể.
```

### CBO vs ABO analysis

```
Phân tích 60 ngày qua:
- Campaign nào đang dùng CBO (Advantage Campaign Budget)?
- Campaign nào đang dùng ABO (Ad Set budget)?
- So sánh ROAS, CPA trung bình giữa 2 cách
- Trong CBO, có ad set nào bị "starve" (rất ít spend) trong khi ROAS tốt không?
Đề xuất: campaign nào nên chuyển CBO ↔ ABO.
```

### Bid strategy review

```
Liệt kê tất cả ad set theo bid strategy đang dùng (Lowest cost / Cost cap / Bid cap / ROAS goal).
- Performance trung bình từng nhóm
- Cảnh báo bid strategy không phù hợp với funnel stage
  (vd: cold audience không nên dùng Bid cap quá thấp)
Đề xuất tối ưu cho từng ad set.
```

### Scaling rule

```
Áp dụng quy tắc scale 20%:
Tìm ad set thỏa mãn:
- ROAS >= 2× target trong 3 ngày liên tiếp
- Frequency < 2.5
- Đang dùng < 80% daily budget
Đề xuất tăng budget 20% mỗi 3 ngày, không tăng đột ngột.
List ra để tao approve từng cái.
```

---

## 6. Catalog & Dynamic Ads

### Catalog health check

```
Quét tất cả product catalog đang dùng:
- Tổng số SKU, số SKU "Active for ads" / "In stock"
- Tỉ lệ products bị reject (thiếu image, sai price, missing GTIN…)
- Top 10 product có lỗi feed nghiêm trọng nhất
Đề xuất fix theo thứ tự ưu tiên.
```

### DPA winner products

```
Trong Dynamic Product Ads 30 ngày qua:
- Top 20 SKU bán chạy nhất (theo revenue)
- Top 20 SKU có ROAS cao nhất (đủ spend)
- Top 10 SKU "đốt tiền" (spend cao, 0–1 đơn)
Đề xuất: tạo product set riêng cho top winner để allocate budget mạnh hơn.
```

### Cross-sell / Upsell opportunities

```
Phân tích lịch sử mua hàng từ data Meta:
- Cặp sản phẩm hay được mua cùng nhau (top 10)
- Khách mua [SP A] bao lâu sau quay lại mua [SP B]?
Đề xuất 3 retargeting flow:
- View [SP A], không mua → ad [SP A] với social proof
- Mua [SP A] 7 ngày → ad cross-sell [SP B] phù hợp
- Mua > 30 ngày trước → reactivation offer
```

---

## 7. Báo cáo & tổng kết

### 🔥 Daily morning report

```
Tạo báo cáo sáng cho hôm qua (theo timezone tài khoản):
1. Top-line: spend, revenue, ROAS, CPA, đơn
2. So với hôm kia (% thay đổi)
3. Top 3 winner (campaign hoặc ad set), top 3 loser
4. Cảnh báo (frequency cao, CPA bất thường, ngân sách sắp hết…)
5. 3 hành động đề xuất cho hôm nay
Format: gọn, dễ đọc trên mobile, không quá 200 từ.
```

### Weekly performance review

```
Báo cáo tuần (Mon–Sun vừa qua):
- Top-line full funnel: Reach → Click → ATC → IC → Purchase
- Conversion rate từng bước, % thay đổi WoW
- Phân tích theo: campaign / placement / device / audience type
- Top 5 win + bài học
- Top 5 vấn đề + nguyên nhân gốc
- Plan 3 việc lớn cho tuần sau
```

### Monthly business review

```
Báo cáo tháng [tháng/năm]:
- KPI vs target: spend, revenue, ROAS, CPA, ROI, đơn, AOV
- Year-over-Year comparison cho cùng tháng năm ngoái
- Cohort analysis: customer mới vs cũ, retention sau 30 ngày
- Channel mix: % attributed revenue theo platform (FB / IG / Audience Network)
- 3 chiến lược thắng nhất tháng + 3 thử nghiệm thất bại + bài học
- Forecast tháng sau
```

### Stakeholder summary (cho sếp/khách hàng)

```
Tóm tắt performance tuần qua cho [sếp / client] không kỹ thuật:
- Tránh thuật ngữ ngành
- Focus vào outcome (đơn, doanh thu, ROI) thay vì metric process (CPM, CTR)
- 3 điểm tốt
- 1 điểm cần lưu ý
- Action plan tuần tới
Tone: chuyên nghiệp, không quá technical, không quá 150 từ.
```

---

## 8. Black Friday / Mega Sale

### 🔥 Tuần trước BF — chuẩn bị

```
Hôm nay là [ngày]. BF là [ngày BF]. Còn [N] ngày.
Plan đầy đủ:
1. Audit tài khoản: pixel, catalog, conversion API hoạt động OK?
2. Warm up audience: campaign nào nên scale ngay từ tuần này?
3. Creative: cần bao nhiêu variation, đã sẵn sàng chưa?
4. Budget plan: phân bổ theo từng ngày từ giờ tới sau BF
5. Retargeting setup: pool đã đủ size chưa?
6. Backup plan nếu CPM tăng 2-3× trong ngày BF
```

### Trong ngày BF — monitoring

```
Mỗi 2 tiếng, gửi tao báo cáo:
- Spend hiện tại / daily budget của top 10 campaign
- ROAS realtime, so với baseline ngày thường
- CPM tăng/giảm bao nhiêu %
- Top 3 ad set "on fire" — đề xuất tăng budget ngay
- Top 3 ad set "ngộp" — đề xuất pause
- Audience nào vừa chạm frequency cap
Format ngắn gọn, hành động rõ ràng.
```

### Sau BF — lessons learned

```
Hậu BF report (full BF window: [start date] → [end date]):
- KPI tổng vs target
- Phá ngưỡng nào (best ROAS day, best CPA hour…)
- Top 3 chiến lược thành công nhất
- Top 3 sai lầm + bài học
- Customer mới có potential retain (đề xuất audience segment)
- Forecast & playbook cho BF năm sau
```

### Customer post-BF retention

```
Phân tích pool khách hàng mới mua trong BF:
- Tổng số người, AOV, sản phẩm họ mua
- Repeat purchase rate sau 7 / 14 / 30 ngày
- Đề xuất 3 audience retargeting:
  1. Bought BF, chưa quay lại → reactivation
  2. Bought BF + AOV cao → VIP upsell
  3. Added to cart BF, không mua → recovery với offer mới
```

---

## 9. Quick action — copy paste dùng liền

### Pause hàng loạt

```
⚠️ Pause mọi ad set có CPA > [X]đ trong 48h qua AND frequency > 3 AND spend > 500k. List trước, tao confirm.
```

### Tăng budget winner

```
⚠️ Tăng 25% budget cho top 5 ad set ROAS > 3 trong 7 ngày qua, miễn là đang ở dưới 80% budget cap. List trước, tao confirm.
```

### Duplicate winner

```
⚠️ Duplicate top 3 ad set winner (ROAS cao nhất 14 ngày) sang campaign mới với:
- Audience: LAL 1% từ Purchasers 180 ngày
- Budget: 150% bản gốc
- Giữ nguyên creative
```

### Tắt creative fatigue

```
⚠️ Pause mọi ad có frequency > 4 AND CTR đã giảm > 50% so với 7 ngày đầu.
```

### Báo cáo nhanh

```
Tao đang trong cuộc họp. Cho tao 3 dòng: spend hôm nay, ROAS, hành động cấp bách nhất nếu có.
```

### Tìm hidden winner

```
Tìm ad set spend < 500k VÀ có >= 3 conversion VÀ ROAS > 3. Đây là winner chưa được scale. List ra.
```

---

## 10. Prompt nâng cao — auto workflow

### Daily auto-pilot

```
Mỗi ngày 8h sáng, tự động:
1. Đọc performance 24h qua
2. Tạo report ngắn gửi vào Slack/email tao
3. Flag bất kỳ ad set nào cần tao xử lý ngay (priority Critical / High / Medium)
4. Đề xuất 3 hành động cụ thể trong ngày
KHÔNG tự thực hiện thay đổi nào — chỉ propose để tao confirm.
```

### Weekly optimization session

```
Mỗi sáng thứ 2, tổ chức "Monday optimization session":
1. Recap tuần trước (key metrics + insights)
2. Approve / reject các đề xuất trong tuần qua chưa làm
3. Đề xuất 5 thử nghiệm cho tuần này
4. Update target tuần này nếu cần
Chuẩn bị data từ trước, vào session là tao chỉ ra quyết định.
```

### Anomaly detection

```
Realtime monitor: alert tao ngay khi phát hiện bất thường:
- CPM tăng > 50% trong 1h
- CPA gấp 3 lần baseline
- Bất kỳ campaign nào hết budget trước 6h chiều
- Pixel không nhận conversion > 2h
- Bất kỳ ad bị reject vì policy
Gửi alert kèm context (đang xảy ra ở đâu, có thể vì sao).
```

---

## 11. Prompt khắc phục sự cố

### Campaign mới đang "học mãi không xong"

```
Campaign [tên] đã chạy [N] ngày, vẫn ở Learning. Phân tích:
- Số conversion / event đã đạt vs ngưỡng yêu cầu
- Audience size có quá nhỏ không
- Budget có đủ để generate đủ event không
- Creative có mới quá / chưa stabilize?
Đề xuất 3 fix: option A (kiên nhẫn), option B (scale audience/budget), option C (đổi event optimization).
```

### Campaign cũ đang giảm ROAS

```
Campaign [tên] có ROAS giảm liên tục 14 ngày qua từ [X] xuống [Y].
Chẩn đoán nguyên nhân theo thứ tự ưu tiên:
1. Audience saturation? (check frequency, reach growth, overlap)
2. Creative fatigue? (CTR & hook rate trend)
3. External: competitor mới, mùa giảm, holiday hết?
4. Pixel / tracking issue?
5. Bid environment: CPM toàn ngành tăng?
Đưa ra hypothesis chính + cách verify + fix tương ứng.
```

### Ad bị reject

```
Liệt kê tất cả ad / ad set bị reject hoặc limited delivery 7 ngày qua:
- Lý do từ Meta (policy nào)
- Severity: cảnh cáo nhẹ vs nghiêm trọng có thể ảnh hưởng tài khoản
- Cách fix cho từng cái
- Có cần appeal không
```

### Pixel / Conversion API vấn đề

```
Kiểm tra health của pixel & CAPI 7 ngày qua:
- Số event nhận được mỗi ngày, % deduplication match rate
- Event nào hay bị mismatch (vd Purchase value khác giữa pixel và CAPI)
- Browser-side event coverage drop có nghiêm trọng không (do iOS / browser block)
- Đề xuất: bật event nào qua CAPI, parameter nào còn thiếu
```

---

## 12. Tips dùng prompt hiệu quả

1. **Càng cụ thể số liệu càng tốt.** Đừng nói "tăng budget cho cái nào tốt" — nói "tăng 25% cho ad set ROAS > 3 trong 7 ngày qua".

2. **Luôn yêu cầu list trước, action sau** với mọi thay đổi (pause, scale, duplicate). Đừng để Claude tự làm rồi mới biết.

3. **Cho context business.** Margin của bạn bao nhiêu? Mục tiêu là acquisition hay LTV? Claude sẽ analyze thông minh hơn.

4. **Lưu prompt thắng** — prompt nào ra insight tốt, edit lại cho gọn rồi save thành "preset" của riêng bạn.

5. **Đừng prompt quá dài 1 lần** — chia nhỏ. Phân tích trước → quyết định → action sau.

6. **Verify số liệu quan trọng.** AI có thể tính sai khi xử lý nhiều layer. Số quan trọng → check lại bằng UI Ads Manager.

7. **Tạo template báo cáo cố định** thay vì tự sáng tạo mỗi ngày — kết quả nhất quán hơn cho stakeholder.

---

## 13. Workflow đề xuất 1 ngày làm việc

| Giờ | Action | Prompt template |
|---|---|---|
| 8:00 | Morning health check | "🔥 Health check buổi sáng" |
| 8:15 | Daily morning report | "🔥 Daily morning report" |
| 11:00 | Realtime check | "Liệt kê 20 conversion gần nhất…" |
| 14:00 | Mid-day pulse | "Tao đang trong cuộc họp. Cho tao 3 dòng…" |
| 17:00 | EOD optimization | "Auto-reallocation đề xuất…" |
| 21:00 | Pre-sleep check | "Check pixel + alert bất thường" |

---

*Thư viện này sẽ tiếp tục được cập nhật. Khi tìm được prompt mới ra insight tốt, hãy thêm vào để team cùng dùng.*
