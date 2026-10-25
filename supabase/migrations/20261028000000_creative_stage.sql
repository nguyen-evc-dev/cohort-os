-- Gắn nhãn stage thủ công cho creative (khi tên ad không có từ khóa TOF/MOF/BOF để tự nhận).
-- Nhãn nằm cùng dòng creative_assets: áp cho cả concept (scope = concept) hoặc 1 ad (scope = ad).
-- Thứ tự ưu tiên khi báo cáo: nhãn theo ad > nhãn theo concept > stage tự nhận từ tên ad / adset / campaign.
alter table public.creative_assets
  add column stage text check (stage in ('TOFU', 'MOFU', 'BOFU'));

comment on column public.creative_assets.stage is 'Stage do người dùng gắn tay (ghi đè stage tự nhận từ tên ad).';
