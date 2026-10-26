-- =====================================================================
-- Đường giữ chân video (mẫu báo cáo "Giữ chân" cho editor / designer):
-- lượt xem tới 25 / 50 / 75 / 100% độ dài video, theo ad × ngày. Chỉ là số tổng hợp từ Meta, không có PII.
-- Tỷ lệ = video_pXX / video_3s (tính ở code, không lưu).
-- =====================================================================

alter table public.meta_ads_daily
  add column video_p25 integer not null default 0 check (video_p25 >= 0),
  add column video_p50 integer not null default 0 check (video_p50 >= 0),
  add column video_p75 integer not null default 0 check (video_p75 >= 0),
  add column video_p100 integer not null default 0 check (video_p100 >= 0);

comment on column public.meta_ads_daily.video_p50 is 'Lượt xem tới 50% video (video_p50_watched_actions).';
