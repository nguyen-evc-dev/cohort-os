-- =====================================================================
-- Đo theo mục tiêu từng Project (custom conversion), không theo Lead / ROAS mặc định.
--   • meta_actions_daily: số chuyển đổi theo ad × ngày × loại hành động (custom conversion, pixel event,
--     video_view = lượt xem 3 giây). Suy ra từ cost_per_action_type: count = spend / cost (connector không có
--     field đếm riêng cho custom conversion).
--   • meta_custom_conversions: danh mục custom conversion của tài khoản (tên + ID) để chọn khi tạo Project.
--   • projects.goal: chuỗi chuyển đổi của Project (bước Meta / CRM, bước chính, bước cuối, giá trị).
--   • meta_ads_daily: thêm video_3s, outbound_clicks (hook rate, CTR outbound).
-- =====================================================================

alter table public.meta_ads_daily
  add column video_3s integer not null default 0,
  add column outbound_clicks integer not null default 0;

create table public.meta_actions_daily (
  date        date not null,
  ad_id       text not null check (ad_id ~ '^\d{6,25}$'),
  campaign_id text not null check (campaign_id ~ '^\d{6,25}$'),
  action_type text not null check (action_type ~ '^[a-z0-9_.]{2,80}$'),
  count       integer not null check (count >= 0),
  primary key (date, ad_id, action_type)
);
create index on public.meta_actions_daily (campaign_id, date);
create index on public.meta_actions_daily (action_type, date);

create table public.meta_custom_conversions (
  id            text primary key check (id ~ '^\d{6,25}$'),
  name          text not null check (char_length(name) <= 200),
  event_type    text check (char_length(event_type) <= 40),
  is_archived   boolean not null default false,
  last_fired_at timestamptz,
  default_value numeric(12, 2),
  seen_at       timestamptz not null default now()
);

alter table public.projects
  add column goal jsonb not null default '{}'::jsonb
  check (jsonb_typeof(goal) = 'object' and octet_length(goal::text) <= 8000);

-- RLS giống các bảng Meta: sync (service_role) ghi, admin chỉ đọc, anon / authenticated khác không có gì
do $$
declare t text;
begin
  foreach t in array array['meta_actions_daily', 'meta_custom_conversions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('create policy admin_read on public.%I for select to authenticated using ((select public.is_admin()))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

comment on table public.meta_actions_daily is 'Chuyển đổi theo ad × ngày × action_type (custom conversion / pixel event / video_view). count = spend / cost_per_action_type.';
comment on column public.projects.goal is 'Chuỗi chuyển đổi của Project: { focus, steps[], primary, final, compare, target_cost }.';
