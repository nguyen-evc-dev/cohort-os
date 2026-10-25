-- =====================================================================
-- Cổng công khai (T2.5 thumbnail, T2.9 share link)
-- Hai route công khai của web (/api/thumb/*, /s/*) cần đọc dữ liệu khi CHƯA đăng nhập.
-- Thay vì đặt secret key trên server web, mở đúng 2 hàm security definer, chạy bằng role `gateway`
-- chỉ có quyền tối thiểu. anon KHÔNG đọc trực tiếp bảng nào.
-- =====================================================================
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'gateway') then create role gateway nologin; end if;
end $$;
grant gateway to current_user;
grant usage on schema public to gateway;
grant create on schema public to gateway; -- tạm: Postgres yêu cầu owner mới có CREATE trên schema

grant select on public.creative_assets to gateway;
create policy gateway_read on public.creative_assets for select to gateway using (true);

grant select, update on public.shares to gateway;
create policy gateway_read on public.shares for select to gateway using (revoked_at is null and expires_at > now());
create policy gateway_count on public.shares for update to gateway using (revoked_at is null and expires_at > now()) with check (true);

-- Ảnh chỉ được phục vụ nếu fileId đã được gắn trong creative_assets
create function public.thumb_allowed(p_file_id text)
returns boolean language sql stable security definer set search_path = ''
as $$ select p_file_id ~ '^[A-Za-z0-9_-]{10,120}$' and exists (select 1 from public.creative_assets a where a.drive_file_id = p_file_id) $$;

-- Mở 1 share link: trả snapshot nếu token đúng, chưa hết hạn, chưa thu hồi; mỗi lần mở tăng view_count.
-- Trả null cho mọi trường hợp còn lại (không phân biệt "sai", "hết hạn", "thu hồi" để khỏi lộ thông tin).
create function public.share_open(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare r public.shares;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{40,128}$' then return null; end if;
  update public.shares s set view_count = s.view_count + 1
    where s.token = p_token and s.revoked_at is null and s.expires_at > now()
    returning * into r;
  if not found then return null; end if;
  return jsonb_build_object('title', r.title, 'snapshot', r.snapshot, 'hide_money', r.hide_money,
                            'created_at', r.created_at, 'expires_at', r.expires_at);
end $$;

alter function public.thumb_allowed(text) owner to gateway;
alter function public.share_open(text) owner to gateway;
revoke all on function public.thumb_allowed(text) from public;
revoke all on function public.share_open(text) from public;
grant execute on function public.thumb_allowed(text) to anon, authenticated;
grant execute on function public.share_open(text) to anon, authenticated;
revoke create on schema public from gateway;

comment on function public.thumb_allowed(text) is 'Cổng công khai: fileId Drive đã được gắn trong creative_assets?';
comment on function public.share_open(text) is 'Cổng công khai: mở share link theo token, tăng view_count, trả snapshot.';
