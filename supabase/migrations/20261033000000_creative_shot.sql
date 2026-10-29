-- =====================================================================
-- Creative Vault: thêm ảnh chụp màn hình (prnt.sc / Lightshot) làm ảnh bìa. Video vẫn lấy từ link Drive.
--   shot_code  mã ảnh (mã trên link prnt.sc, hoặc tên file ảnh khi dán link ảnh trực tiếp)
--   shot_url   link trang prnt.sc (để mở xem bản gốc), có thể trống
--   shot_image link ảnh trên CDN Lightshot (host cố định, kiểm bằng CHECK) — server chỉ phục vụ link này qua /api/shot/<mã>
-- Hàm công khai shot_image_for (giống thumb_allowed): chỉ trả link cho mã đã gắn trong creative_assets.
-- =====================================================================

alter table public.creative_assets
  add column shot_code  text check (shot_code ~ '^[A-Za-z0-9_-]{4,40}$'),
  add column shot_url   text check (char_length(shot_url) <= 300 and shot_url ~ '^https://(www\.)?(prnt\.sc|prntscr\.com)/'),
  add column shot_image text check (char_length(shot_image) <= 300 and shot_image ~ '^https://(img\.lightshot\.app|image\.prntscr\.com|i\.imgur\.com)/[^?#\s]+\.(png|jpe?g|webp|gif)$'),
  add constraint creative_assets_shot_pair check ((shot_code is null) = (shot_image is null));

create index on public.creative_assets (shot_code) where shot_code is not null;

grant gateway to current_user;
grant create on schema public to gateway; -- tạm: Postgres yêu cầu owner mới có CREATE trên schema

create function public.shot_image_for(p_code text)
returns text language sql stable security definer set search_path = ''
as $$ select a.shot_image from public.creative_assets a where p_code ~ '^[A-Za-z0-9_-]{4,40}$' and a.shot_code = p_code limit 1 $$;

alter function public.shot_image_for(text) owner to gateway;
revoke all on function public.shot_image_for(text) from public;
grant execute on function public.shot_image_for(text) to anon, authenticated;
revoke create on schema public from gateway;

comment on function public.shot_image_for(text) is 'Cổng công khai: link ảnh prnt.sc đã gắn cho mã này (null nếu chưa gắn).';
