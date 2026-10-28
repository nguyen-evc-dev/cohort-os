-- =====================================================================
-- Upload report Meta thủ công (xuất từ Ads Manager → up lên Web).
-- Trước giờ chỉ sync (service_role) ghi số Meta; admin chỉ đọc. Nay admin đã đăng nhập Web cũng ghi được
-- đúng các bảng cần cho việc nạp báo cáo, vẫn KHÔNG ghi được signals / bảng khác:
--   • meta_ads_daily: insert + update (ghi đè theo date, ad_id)
--   • meta_actions_daily: insert + delete (thay chuyển đổi theo campaign × khoảng ngày)
--   • meta_entities: chỉ insert (tạo dòng còn thiếu cho campaign / adset / ad mới, không sửa dòng sync đã ghi)
--   • sync_runs: insert (ghi nhận lần upload, kind = 'meta_upload')
-- Dữ liệu chỉ là số tổng hợp của quảng cáo, không có thông tin khách. Meta vẫn chỉ ĐỌC (file do Nguyên xuất).
-- =====================================================================

alter table public.sync_runs drop constraint sync_runs_kind_check;
alter table public.sync_runs add constraint sync_runs_kind_check check (kind in ('meta', 'meta_backfill', 'hubspot', 'meta_upload'));

create policy admin_insert on public.meta_ads_daily for insert to authenticated with check ((select public.is_admin()));
create policy admin_update on public.meta_ads_daily for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant insert, update on public.meta_ads_daily to authenticated;

create policy admin_insert on public.meta_actions_daily for insert to authenticated with check ((select public.is_admin()));
create policy admin_delete on public.meta_actions_daily for delete to authenticated using ((select public.is_admin()));
grant insert, delete on public.meta_actions_daily to authenticated;

create policy admin_insert on public.meta_entities for insert to authenticated with check ((select public.is_admin()));
grant insert on public.meta_entities to authenticated;

create policy admin_insert on public.sync_runs for insert to authenticated with check ((select public.is_admin()));
grant insert on public.sync_runs to authenticated;
