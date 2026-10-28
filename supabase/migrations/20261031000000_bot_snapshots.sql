-- =====================================================================
-- Phase 4 — dữ liệu cho Bé Sugar nhận lệnh (/campaigns /report /ryg /analyze /audit)
--   • bot_snapshots: báo cáo theo mục tiêu Project, TÍNH SẴN bằng code của Web (core) ở phía có quyền
--     (sync trên máy Nguyên / Web admin). Chỉ chứa payload tổng hợp đã quét PII: không contact_id, deal_id, email, SĐT.
--     Bot không đọc được lead/deal nên không thể tự tính số theo bước CRM; đọc bản chụp này thay vào đó.
--   • bot.v_project_snapshot, bot.v_campaigns, bot.v_ad_creatives: view chỉ đọc cho bot.
--   • public.bot_read: thêm 3 view vào whitelist (vẫn chạy bằng quyền bot_reader, cần token bot).
-- =====================================================================

create table public.bot_snapshots (
  slug         text not null check (slug ~ '^[a-z0-9-]{2,60}$'),
  range_key    text not null check (range_key in ('7d', '30d', 'all')),
  project_id   uuid references public.projects (id) on delete cascade,
  as_of        date not null,
  built_at     timestamptz not null default now(),
  data_version text not null check (data_version ~ '^[0-9a-f]{8,64}$'),
  payload      jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 60000),
  primary key (slug, range_key)
);

alter table public.bot_snapshots enable row level security;
alter table public.bot_snapshots force row level security;
revoke all on public.bot_snapshots from anon, authenticated, public;
-- Web admin đọc + ghi (làm mới sau khi import HubSpot); sync ghi bằng service role
create policy admin_all on public.bot_snapshots for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.bot_snapshots to authenticated;

-- ---------- Quyền đọc cho chủ view của bot ----------
grant select on public.bot_snapshots, public.meta_creatives to bot_owner;
create policy bot_owner_read on public.bot_snapshots for select to bot_owner using (true);
create policy bot_owner_read on public.meta_creatives for select to bot_owner using (true);

grant usage on schema bot to bot_owner;
grant create on schema bot to bot_owner;  -- tạm, thu hồi sau khi đổi owner (giống migration init)

create view bot.v_project_snapshot as
select s.slug, coalesce(p.name, 'Toàn tài khoản') as name, s.range_key, s.as_of, s.built_at, s.data_version, s.payload
from public.bot_snapshots s
left join public.projects p on p.id = s.project_id;

-- Campaign + trạng thái + Project chứa nó + chi tiêu 7/30 ngày gần nhất (tính từ ngày có số mới nhất)
create view bot.v_campaigns as
with latest as (select max(date) as d from public.meta_ads_daily),
spend as (
  select m.campaign_id,
         sum(m.spend) filter (where m.date > (select d from latest) - 7)  as spend_7d,
         sum(m.spend) filter (where m.date > (select d from latest) - 30) as spend_30d,
         sum(m.spend) filter (where m.date = (select d from latest))      as spend_latest,
         max(m.date) as last_spend_date
  from public.meta_ads_daily m group by m.campaign_id
)
select e.id as campaign_id, e.name, e.objective, e.effective_status, e.is_sac, e.daily_budget, e.lifetime_budget,
       p.slug as project_slug, p.name as project_name,
       coalesce(s.spend_7d, 0) as spend_7d, coalesce(s.spend_30d, 0) as spend_30d, coalesce(s.spend_latest, 0) as spend_latest, s.last_spend_date
from public.meta_entities e
left join spend s on s.campaign_id = e.id
left join public.project_campaigns pc on pc.campaign_id = e.id
left join public.projects p on p.id = pc.project_id
where e.level = 'campaign';

-- Nội dung ad cho /audit: copy, link đích, targeting (tóm tắt, chỉ tên) và cờ SAC. Không có dữ liệu khách.
create view bot.v_ad_creatives as
with spend as (
  select m.ad_id, sum(m.spend) filter (where m.date > (select max(date) from public.meta_ads_daily) - 30) as spend_30d
  from public.meta_ads_daily m group by m.ad_id
)
select a.id as ad_id, a.name as ad_name, a.effective_status, a.adset_id, s.name as adset_name, a.campaign_id, c.name as campaign_name,
       c.objective, coalesce(c.is_sac, false) as is_sac, s.targeting_summary,
       cr.title, cr.body, cr.link_url, cr.cta, coalesce(sp.spend_30d, 0) as spend_30d
from public.meta_entities a
left join public.meta_entities s on s.level = 'adset' and s.id = a.adset_id
left join public.meta_entities c on c.level = 'campaign' and c.id = a.campaign_id
left join public.meta_creatives cr on cr.ad_id = a.id
left join spend sp on sp.ad_id = a.id
where a.level = 'ad';

do $$
declare v text;
begin
  foreach v in array array['v_project_snapshot', 'v_campaigns', 'v_ad_creatives'] loop
    execute format('alter view bot.%I owner to bot_owner', v);
    execute format('revoke all on bot.%I from public, anon, authenticated', v);
    execute format('grant select on bot.%I to bot_reader', v);
  end loop;
end $$;
revoke create on schema bot from bot_owner;

-- ---------- bot_read: thêm view vào whitelist (tạo lại hàm, cùng cách phân quyền với migration bot_feed) ----------
drop function public.bot_read(text, text, date);
grant bot_reader to current_user;
grant create on schema public to bot_reader;

create function public.bot_read(p_token text, p_view text, p_since date default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_col   text;
  v_order text;
  v_out   jsonb;
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 200 or not exists (
    select 1 from public.bot_tokens t
    where t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and t.revoked_at is null
  ) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  -- Whitelist: view → cột ngày để lọc p_since + thứ tự trả về
  case p_view
    when 'v_sync_status'      then v_col := 'started_at'; v_order := 'started_at desc, target_date desc nulls last';
    when 'v_campaign_daily'   then v_col := 'date';       v_order := 'date desc, spend desc';
    when 'v_signals_latest'   then v_col := null;         v_order := 'color, type';
    when 'v_project_master'   then v_col := null;         v_order := 'name';
    when 'v_creative_perf'    then v_col := null;         v_order := 'spend desc';
    when 'v_project_snapshot' then v_col := null;         v_order := 'slug, range_key';
    when 'v_campaigns'        then v_col := null;         v_order := 'spend_30d desc, name';
    when 'v_ad_creatives'     then v_col := null;         v_order := 'spend_30d desc, ad_id';
    else raise exception 'unknown_view' using errcode = '22023';
  end case;

  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from bot.%I %s order by %s limit 2000) t',
    p_view,
    case when v_col is not null and p_since is not null then format('where %I >= %L', v_col, p_since) else '' end,
    v_order
  ) into v_out;
  return v_out;
end $$;

alter function public.bot_read(text, text, date) owner to bot_reader;
revoke all on function public.bot_read(text, text, date) from public, anon, authenticated;
grant execute on function public.bot_read(text, text, date) to anon;
revoke create on schema public from bot_reader;

comment on function public.bot_read(text, text, date) is
  'Cổng đọc của Bé Sugar: cần token bot; chạy bằng quyền bot_reader; chỉ đọc view bot.v_* trong whitelist.';
comment on table public.bot_snapshots is 'Báo cáo tổng hợp theo Project × khoảng ngày cho Bé Sugar. Payload đã quét PII, không có ID khách.';
