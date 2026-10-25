-- =====================================================================
-- Cohort OS v3 — schema khởi tạo (T0.2)
-- Nguyên tắc:
--   • KHÔNG có cột PII (tên, email, SĐT). Chỉ ID + nguồn quảng cáo + số.
--   • Mọi bảng: ENABLE + FORCE RLS, thu hồi quyền mặc định của anon/authenticated.
--   • authenticated chỉ thấy dữ liệu khi là admin (bảng admins). Đăng ký mới tắt ở dashboard.
--   • service_role (CLI sync trên máy Nguyên) bỏ qua RLS để ghi.
--   • bot_reader (Bé Sugar) chỉ đọc 4 view trong schema `bot`, không đọc được bảng nào.
-- =====================================================================

-- ---------- Vai trò cho Bé Sugar ----------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'bot_owner') then create role bot_owner nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'bot_reader') then create role bot_reader nologin; end if;
end $$;
grant bot_owner to current_user;  -- để migration đổi owner của view sang bot_owner

-- ---------- Admin ----------
create table public.admins (
  user_id    uuid primary key,
  email      text not null unique check (char_length(email) <= 200),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admins a where a.user_id = (select auth.uid())) $$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------- Cấu hình (ghi đè DEFAULT_CONFIG của packages/core) ----------
create table public.app_config (
  key        text not null check (char_length(key) <= 80),
  scope      text not null default 'global' check (char_length(scope) <= 80),
  value      text not null check (char_length(value) <= 500),
  note       text check (char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  primary key (key, scope)
);

-- ---------- Project = 1 đợt chạy (vd Webinar RE11) ----------
create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name       text not null check (char_length(name) <= 120),
  start_date date,
  end_date   date,
  status     text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);

-- Mỗi form HubSpot thuộc đúng 1 project
create table public.project_forms (
  form_name  text primary key check (char_length(form_name) <= 200),
  project_id uuid not null references public.projects (id) on delete cascade
);

-- Mỗi campaign Meta thuộc đúng 1 project
create table public.project_campaigns (
  campaign_id text primary key check (campaign_id ~ '^\d{6,25}$'),
  project_id  uuid not null references public.projects (id) on delete cascade,
  mapped_by   text not null default 'manual' check (mapped_by in ('auto', 'manual')),
  mapped_at   timestamptz not null default now()
);
create index on public.project_campaigns (project_id);

-- ---------- Meta (ghi bởi sync:push, service_role) ----------
create table public.meta_ads_daily (
  date               date not null,
  ad_id              text not null check (ad_id ~ '^\d{6,25}$'),
  account_id         text not null check (account_id ~ '^\d{6,25}$'),
  campaign_id        text not null check (campaign_id ~ '^\d{6,25}$'),
  campaign_name      text check (char_length(campaign_name) <= 500),
  objective          text check (char_length(objective) <= 60),
  adset_id           text not null check (adset_id ~ '^\d{6,25}$'),
  adset_name         text check (char_length(adset_name) <= 500),
  ad_name            text check (char_length(ad_name) <= 500),
  funnel_stage       text check (funnel_stage in ('TOFU', 'MOFU', 'BOFU')),
  creative_format    text check (creative_format in ('photo', 'video')),
  creative_concept   text check (char_length(creative_concept) <= 300),
  concept_key        text check (char_length(concept_key) <= 300),
  spend              numeric(12, 2) not null default 0 check (spend >= 0),
  impressions        integer not null default 0,
  reach              integer not null default 0,
  frequency          numeric(8, 4) not null default 0,
  link_clicks        integer not null default 0,
  link_ctr           numeric(8, 4) not null default 0,
  cpm                numeric(12, 2) not null default 0,
  landing_page_views integer not null default 0,
  leads_meta         integer not null default 0,
  purchases_meta     integer not null default 0,
  thruplay           integer not null default 0,
  provisional        boolean not null default false,
  updated_at         timestamptz not null default now(),
  primary key (date, ad_id)
);
create index on public.meta_ads_daily (campaign_id, date);
create index on public.meta_ads_daily (concept_key);

create table public.meta_entities (
  level             text not null check (level in ('campaign', 'adset', 'ad')),
  id                text not null check (id ~ '^\d{6,25}$'),
  name              text check (char_length(name) <= 500),
  account_id        text check (account_id ~ '^\d{6,25}$'),
  campaign_id       text check (campaign_id ~ '^\d{6,25}$'),
  adset_id          text check (adset_id = '' or adset_id ~ '^\d{6,25}$'),
  objective         text check (char_length(objective) <= 60),
  effective_status  text check (char_length(effective_status) <= 40),
  is_sac            boolean not null default false,
  daily_budget      numeric(12, 2),
  lifetime_budget   numeric(12, 2),
  learning_status   text check (char_length(learning_status) <= 20),
  reach_7d          integer,
  impressions_7d    integer,
  frequency_7d      numeric(8, 4),
  targeting_summary jsonb,
  budget_changed_at timestamptz,
  last_sig_edit_at  timestamptz,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  primary key (level, id)
);
create index on public.meta_entities (campaign_id);

-- Nội dung creative (dùng cho /audit). Không có dữ liệu khách.
create table public.meta_creatives (
  ad_id              text primary key check (ad_id ~ '^\d{6,25}$'),
  creative_id        text check (creative_id ~ '^\d{6,25}$'),
  title              text check (char_length(title) <= 1000),
  body               text check (char_length(body) <= 5000),
  link_url           text check (char_length(link_url) <= 2000),
  cta                text check (char_length(cta) <= 60),
  thumbnail_url_meta text check (char_length(thumbnail_url_meta) <= 2000),
  fetched_at         timestamptz not null default now()
);

-- Lịch sử đổi budget — KHÔNG lưu tên người sửa
create table public.meta_budget_events (
  object_id  text not null check (object_id ~ '^\d{6,25}$'),
  event_time timestamptz not null,
  event_type text not null check (char_length(event_type) <= 80),
  old_value  numeric(12, 2),
  new_value  numeric(12, 2),
  primary key (object_id, event_time, event_type)
);

create table public.sync_runs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('meta', 'meta_backfill', 'hubspot')),
  target_date date,
  status      text not null check (status in ('running', 'ok', 'rejected', 'error', 'skipped')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  date_from   date,
  date_to     date,
  rows        integer,
  problems    jsonb,
  note        text check (char_length(note) <= 1000)
);
create index on public.sync_runs (kind, started_at desc);

-- ---------- CRM (import trên máy, chỉ ID + nguồn + số) ----------
create table public.crm_imports (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects (id) on delete cascade,
  form_name         text check (char_length(form_name) <= 200),
  source            text not null default 'web' check (source in ('web', 'cli')),
  imported_at       timestamptz not null default now(),
  submissions_rows  integer not null default 0,
  deals_rows        integer not null default 0,
  tracked_pct       numeric(5, 2),
  date_from         date,
  date_to           date
);

create table public.crm_submissions (
  conversion_id text primary key check (conversion_id ~ '^[A-Za-z0-9-]{1,64}$'),
  project_id    uuid not null references public.projects (id) on delete cascade,
  form_name     text check (char_length(form_name) <= 200),
  contact_id    text check (contact_id ~ '^\d{1,25}$'),
  converted_on  date,
  ad_id         text check (ad_id ~ '^\d{6,25}$'),
  adset_id      text check (adset_id ~ '^\d{6,25}$'),
  campaign_id   text check (campaign_id ~ '^\d{6,25}$'),
  placement     text check (char_length(placement) <= 80),
  platform      text check (char_length(platform) <= 20),
  page_path     text check (char_length(page_path) <= 300 and page_path !~ '@'),
  source_hint   text not null check (source_hint in ('tracked', 'direct', 'test', 'invalid')),
  import_id     uuid references public.crm_imports (id) on delete set null
);
create index on public.crm_submissions (project_id, contact_id);
create index on public.crm_submissions (ad_id);

create table public.crm_deals (
  deal_id     text primary key check (deal_id ~ '^\d{1,25}$'),
  project_id  uuid references public.projects (id) on delete cascade,
  contact_ids text[] not null default '{}' check (array_to_string(contact_ids, ',') ~ '^(\d{1,25}(,\d{1,25})*)?$'),
  deal_stage  text check (char_length(deal_stage) <= 60),
  deal_type   text not null check (deal_type in ('seat', 'program', 'test', 'unknown')),
  amount      numeric(12, 2) not null default 0,
  created_on  date,
  closed_on   date,
  is_won      boolean not null default false,
  import_id   uuid references public.crm_imports (id) on delete set null
);
create index on public.crm_deals using gin (contact_ids);

-- Lead = 1 lượt đăng ký/contact/project: lượt có tracking sớm nhất, không có thì lượt vào thẳng sớm nhất
-- (khớp buildCrmImport first_touch của packages/core). security_invoker: áp RLS của bảng gốc.
create view public.crm_leads with (security_invoker = true) as
select distinct on (s.project_id, s.contact_id)
  s.project_id, s.contact_id, s.conversion_id, s.converted_on,
  s.ad_id, s.adset_id, s.campaign_id, s.placement, s.platform, s.source_hint
from public.crm_submissions s
where s.contact_id is not null and s.source_hint in ('tracked', 'direct')
order by s.project_id, s.contact_id, (s.source_hint = 'tracked') desc, s.converted_on asc, s.conversion_id;

-- ---------- Creative / tín hiệu / nhận định / share ----------
create table public.creative_assets (
  id            uuid primary key default gen_random_uuid(),
  scope         text not null check (scope in ('concept', 'ad')),
  concept_key   text check (char_length(concept_key) <= 300),
  ad_id         text check (ad_id ~ '^\d{6,25}$'),
  drive_url     text check (char_length(drive_url) <= 1000),
  drive_file_id text check (drive_file_id ~ '^[A-Za-z0-9_-]{10,120}$'),
  post_url      text check (char_length(post_url) <= 1000),
  notes         text check (char_length(notes) <= 1000),
  updated_at    timestamptz not null default now(),
  check ((scope = 'concept' and concept_key is not null and ad_id is null)
      or (scope = 'ad' and ad_id is not null))
);
create unique index creative_assets_concept_uq on public.creative_assets (concept_key) where scope = 'concept';
create unique index creative_assets_ad_uq on public.creative_assets (ad_id) where scope = 'ad';

create table public.signals (
  as_of       date not null,
  project_id  uuid references public.projects (id) on delete cascade,
  level       text not null check (level in ('campaign', 'adset', 'ad')),
  entity_id   text not null check (entity_id ~ '^\d{6,25}$'),
  type        text not null check (type in ('burn', 'fatigue', 'learning', 'budget_wait', 'scale', 'overreport', 'insufficient')),
  color       text not null check (color in ('red', 'yellow', 'green', 'grey')),
  action      text not null check (char_length(action) <= 60),
  numbers     jsonb not null default '{}',
  compared_to text check (compared_to in ('target', 'campaign', 'account', 'none')),
  created_at  timestamptz not null default now(),
  primary key (as_of, level, entity_id, type)
);

create table public.insights (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null check (scope in ('project', 'campaign', 'creative')),
  scope_id     text not null check (char_length(scope_id) <= 100),
  kind         text not null check (char_length(kind) <= 40),
  data_version text not null check (char_length(data_version) <= 100),
  body         text not null check (char_length(body) <= 8000),
  model        text check (char_length(model) <= 60),
  created_at   timestamptz not null default now(),
  unique (scope, scope_id, kind, data_version)
);

-- Share link: snapshot đóng băng, đọc qua route server (service_role) — anon không đọc trực tiếp
create table public.shares (
  token      text primary key check (token ~ '^[A-Za-z0-9_-]{40,128}$'),
  title      text not null check (char_length(title) <= 200),
  snapshot   jsonb not null,
  hide_money boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  view_count integer not null default 0,
  check (expires_at > created_at)
);

-- =====================================================================
-- RLS + quyền
-- =====================================================================
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
  end loop;
end $$;
revoke all on public.crm_leads from anon, authenticated, public;

-- admins: KHÔNG force RLS để is_admin() (security definer, chạy bằng chủ bảng) luôn đọc được bảng này,
-- kể cả khi role chủ bảng trên Supabase không có BYPASSRLS. anon/authenticated vẫn bị RLS chặn như thường.
alter table public.admins no force row level security;

-- admins: mỗi người chỉ thấy dòng của mình (đủ cho is_admin và màn hình tài khoản)
create policy admins_self on public.admins for select to authenticated using (user_id = (select auth.uid()));
grant select on public.admins to authenticated;

-- Bảng admin được đọc + ghi qua Web (đã đăng nhập, là admin)
do $$
declare t text;
begin
  foreach t in array array['app_config', 'projects', 'project_forms', 'project_campaigns', 'crm_imports',
                           'crm_submissions', 'crm_deals', 'creative_assets', 'insights', 'shares'] loop
    execute format('create policy admin_all on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Bảng do sync ghi: admin chỉ đọc
do $$
declare t text;
begin
  foreach t in array array['meta_ads_daily', 'meta_entities', 'meta_creatives', 'meta_budget_events', 'sync_runs', 'signals'] loop
    execute format('create policy admin_read on public.%I for select to authenticated using ((select public.is_admin()))', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
grant select on public.crm_leads to authenticated;

-- =====================================================================
-- Schema `bot`: view tổng hợp cho Bé Sugar (không có contact_id / deal_id)
-- View thuộc bot_owner (chỉ được SELECT các bảng cần thiết); bot_reader chỉ đọc view.
-- =====================================================================
create schema if not exists bot;
revoke all on schema bot from public, anon, authenticated;
grant usage on schema bot to bot_owner, bot_reader;
grant usage on schema public to bot_owner;

do $$
declare t text;
begin
  foreach t in array array['meta_ads_daily', 'meta_entities', 'signals', 'projects', 'project_campaigns',
                           'crm_submissions', 'crm_deals', 'sync_runs'] loop
    execute format('grant select on public.%I to bot_owner', t);
    execute format('create policy bot_owner_read on public.%I for select to bot_owner using (true)', t);
  end loop;
end $$;


create view bot.v_campaign_daily as
select d.date, d.campaign_id, max(d.campaign_name) as campaign_name, max(d.objective) as objective,
       coalesce(bool_or(e.is_sac), false) as is_sac,
       sum(d.spend) as spend, sum(d.impressions) as impressions, sum(d.link_clicks) as link_clicks,
       sum(d.leads_meta) as leads_meta, sum(d.purchases_meta) as purchases_meta, bool_or(d.provisional) as provisional
from public.meta_ads_daily d
left join public.meta_entities e on e.level = 'campaign' and e.id = d.campaign_id
group by d.date, d.campaign_id;

-- Lead first-touch tính lại trong schema bot (KHÔNG dùng public.crm_leads: view đó là security_invoker,
-- khi lồng trong view của bot sẽ bị kiểm quyền theo bot_reader và bị từ chối). Cùng quy tắc với crm_leads.
create view bot._leads as
select distinct on (s.project_id, s.contact_id)
  s.project_id, s.contact_id, s.ad_id, s.campaign_id, s.placement, s.converted_on, s.source_hint
from public.crm_submissions s
where s.contact_id is not null and s.source_hint in ('tracked', 'direct')
order by s.project_id, s.contact_id, (s.source_hint = 'tracked') desc, s.converted_on asc, s.conversion_id;

-- Lead + kết quả mua theo contact (nội bộ cho các view dưới, không cấp cho bot_reader)
create view bot._lead_outcomes as
select l.project_id, l.contact_id, l.ad_id, l.campaign_id, l.placement, l.converted_on, l.source_hint,
       count(*) filter (where dl.deal_type = 'seat' and dl.is_won)       as seats,
       coalesce(sum(dl.amount) filter (where dl.deal_type = 'seat' and dl.is_won), 0)    as seat_revenue,
       count(*) filter (where dl.deal_type = 'program' and dl.is_won)    as programs,
       coalesce(sum(dl.amount) filter (where dl.deal_type = 'program' and dl.is_won), 0) as program_revenue
from bot._leads l
left join public.crm_deals dl on l.contact_id = any (dl.contact_ids)
group by l.project_id, l.contact_id, l.ad_id, l.campaign_id, l.placement, l.converted_on, l.source_hint;

create view bot.v_project_master as
with spend as (
  select pc.project_id, sum(d.spend) as spend, sum(d.purchases_meta) as purchases_meta, sum(d.leads_meta) as leads_meta
  from public.project_campaigns pc join public.meta_ads_daily d on d.campaign_id = pc.campaign_id
  group by pc.project_id
), crm as (
  select project_id, count(*) as registrations, count(*) filter (where source_hint = 'tracked') as tracked,
         sum(seats) as seats, sum(seat_revenue) as seat_revenue, sum(programs) as programs, sum(program_revenue) as program_revenue
  from bot._lead_outcomes group by project_id
)
select p.id as project_id, p.slug, p.name, p.status,
       coalesce(s.spend, 0) as spend, coalesce(s.purchases_meta, 0) as purchases_meta, coalesce(s.leads_meta, 0) as leads_meta,
       coalesce(c.registrations, 0) as registrations, coalesce(c.tracked, 0) as tracked_registrations,
       coalesce(c.seats, 0) as seats, coalesce(c.seat_revenue, 0) as seat_revenue,
       coalesce(c.programs, 0) as programs, coalesce(c.program_revenue, 0) as program_revenue,
       case when coalesce(c.seats, 0) > 0 then round(s.spend / c.seats, 2) end as cpa_seat,
       case when coalesce(s.spend, 0) > 0 then round((coalesce(c.seat_revenue, 0) + coalesce(c.program_revenue, 0)) / s.spend, 2) end as cash_roas
from public.projects p
left join spend s on s.project_id = p.id
left join crm c on c.project_id = p.id;

create view bot.v_creative_perf as
with meta as (
  select pc.project_id, d.concept_key, max(d.creative_concept) as creative_concept, max(d.creative_format) as creative_format,
         sum(d.spend) as spend, sum(d.impressions) as impressions, sum(d.link_clicks) as link_clicks, sum(d.purchases_meta) as purchases_meta
  from public.project_campaigns pc join public.meta_ads_daily d on d.campaign_id = pc.campaign_id
  group by pc.project_id, d.concept_key
), ad_concept as (
  select distinct on (ad_id) ad_id, concept_key from public.meta_ads_daily order by ad_id, date desc
), crm as (
  select o.project_id, ac.concept_key, count(*) as registrations, sum(o.seats) as seats, sum(o.programs) as programs
  from bot._lead_outcomes o join ad_concept ac on ac.ad_id = o.ad_id
  group by o.project_id, ac.concept_key
)
select m.project_id, m.concept_key, m.creative_concept, m.creative_format, m.spend, m.impressions, m.link_clicks, m.purchases_meta,
       coalesce(c.registrations, 0) as registrations, coalesce(c.seats, 0) as seats, coalesce(c.programs, 0) as programs,
       case when coalesce(c.seats, 0) > 0 then round(m.spend / c.seats, 2) end as cpa_seat
from meta m left join crm c on c.project_id = m.project_id and c.concept_key = m.concept_key;

create view bot.v_signals_latest as
select s.* from public.signals s where s.as_of = (select max(as_of) from public.signals);

do $$
declare v text;
begin
  foreach v in array array['v_campaign_daily', '_leads', '_lead_outcomes', 'v_project_master', 'v_creative_perf', 'v_signals_latest'] loop
    execute format('alter view bot.%I owner to bot_owner', v);
    execute format('revoke all on bot.%I from public, anon, authenticated', v);
  end loop;
  foreach v in array array['v_campaign_daily', 'v_project_master', 'v_creative_perf', 'v_signals_latest'] loop
    execute format('grant select on bot.%I to bot_reader', v);
  end loop;
end $$;

comment on schema bot is 'View tổng hợp cho Bé Sugar. Không chứa contact_id/deal_id. Đọc bằng role bot_reader.';
