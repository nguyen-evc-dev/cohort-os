# Skill: meta-ads-playbook (lõi khai thác dữ liệu Meta Ads)

Chuyển thể từ bộ `meta-ads-prompts` của Nguyên (bản gốc: `skills/vendor/meta-ads-prompts/`) cho Cohort OS.
Khác bản gốc ở 3 điểm:
1. **Chỉ đọc.** Mọi prompt ⚠️ (pause, tăng budget, duplicate) chỉ được trình bày thành **đề xuất** để Nguyên tự làm. Không có công cụ nào ghi vào tài khoản quảng cáo.
2. **Đo theo mục tiêu của Project**, không theo ROAS hay Lead mặc định của Meta. Mỗi Project khai báo chuỗi chuyển đổi (vd Webinar: Check Out → Purchased → Seat CRM → Khóa học $1,750). "Chuyển đổi chính" quyết định CPA / CPL; "chuyển đổi cuối" quyết định giá trị thật.
3. **Số do code tính**, AI chỉ diễn giải. Mọi con số phải có trong dữ liệu đầu vào.

## Thước đo (thứ tự ưu tiên)
1. **Số chuyển đổi chính** và **chi phí trên chuyển đổi chính** (CPA / CPL theo tên bước, vd "CPA Check Out").
2. **Chuyển đổi cuối** (vd khóa học, escrow): số lượng, chi phí trên chuyển đổi cuối, giá trị.
3. Tỉ lệ chuyển giữa các bước (bước sau / bước trước).
4. ROAS chỉ là chỉ số phụ, tính trên giá trị chuyển đổi cuối.
5. Chỉ số quá trình: CPM, CTR (link), CPC, tỉ lệ vào trang (LPV / click), frequency.
6. Creative video: **Hook rate** = lượt xem 3 giây / impression; **Hold rate** = ThruPlay / lượt xem 3 giây.

## 1. Health check (theo dõi hằng ngày)
Đánh dấu ad / ad set có một trong các dấu hiệu, kèm nguyên nhân khả nghi và đề xuất (tắt / giảm budget / đổi creative / giữ):
- CPM tăng > 30% so với 7 ngày trước.
- CTR giảm > 40% so với mức của chính nó.
- Frequency > 3.5.
- Chi phí trên chuyển đổi chính vượt target (hoặc vượt mốc chuẩn nếu chưa có target).
- Tiêu > 50% daily budget mà 0 chuyển đổi chính.

## 2. Phân nhóm creative (winner detection)
Xếp hạng ad theo Hook rate, Hold rate, CTR, CVR (chuyển đổi chính / link click):
- 🥇 **SCALE-READY**: top 10%, đủ dữ liệu, chi phí / chuyển đổi chính ≤ 80% mốc.
- 🔁 **ITERATE**: chỉ số quá trình tốt nhưng chưa đủ chuyển đổi → thử biến thể.
- ⚠️ **FATIGUE**: chi phí / chuyển đổi tăng 7 ngày liền, frequency cao.
- ❌ **KILL**: tiêu ≥ 2× mốc, 0–1 chuyển đổi, CTR thấp.
Mô tả pattern chung của nhóm SCALE-READY (format, concept, stage, hook).

## 3. Phân bổ budget (chỉ đề xuất)
- Ad set có chi phí / chuyển đổi chính > 1.5× mốc: tổng budget đang chạy.
- Đề xuất chuyển tối đa 70% sang top 3 ad set tốt nhất chưa chạm trần (frequency < 2).
- Scale 20% mỗi 3 ngày khi tốt liên tục 3 ngày và đã ổn định ≥ 48 giờ sau lần đổi gần nhất.
- Bảng "từ → đến" với số tiền cụ thể. Nguyên tự thao tác trong Ads Manager.

## 4. Báo cáo
- **Sáng hằng ngày (≤ 200 từ, đọc trên điện thoại):** spend, chuyển đổi chính + chi phí, chuyển đổi cuối; so với hôm kia; top 3 tốt / top 3 kém; cảnh báo; 3 việc nên làm hôm nay.
- **Tuần (thứ Hai → Chủ nhật):** phễu đủ các bước của Project, tỉ lệ từng bước, thay đổi so với tuần trước; theo campaign / placement / stage / concept; top 5 điểm tốt, top 5 vấn đề + nguyên nhân gốc; 3 việc lớn tuần sau.
- **Cho sếp / người ngoài (≤ 150 từ):** tránh thuật ngữ, tập trung vào kết quả (số đăng ký, số mua, giá trị), 3 điểm tốt, 1 điểm cần lưu ý, kế hoạch tuần tới.
- **3 dòng khi đang họp:** spend, chuyển đổi chính + chi phí, 1 việc cấp bách nhất (nếu có).

## 5. Khắc phục sự cố
- **Học mãi không xong:** số chuyển đổi đã có so với ngưỡng thoát learning, audience có quá nhỏ, budget có đủ ra chuyển đổi. Đề xuất: A kiên nhẫn · B mở audience / tăng budget · C đổi sự kiện tối ưu.
- **Chi phí / chuyển đổi tăng dần:** theo thứ tự (1) bão hòa audience (frequency, reach) (2) creative mỏi (CTR, hook rate) (3) bên ngoài (mùa vụ, đối thủ) (4) tracking / pixel (5) đấu giá (CPM).
- **Tracking:** số chuyển đổi Meta lệch nhiều so với CRM → kiểm tra pixel, custom conversion, độ phủ tracking của form.

## Không làm
- Không tự thay đổi chiến dịch. Không khuyên dùng Bid cap / ROAS goal khi không có dữ liệu chứng minh.
- Không đánh giá campaign bằng "Lead" của Meta nếu Project không chọn Lead làm chuyển đổi chính.
