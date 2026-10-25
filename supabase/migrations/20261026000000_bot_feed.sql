-- =====================================================================
-- T1.5 — Cổng đọc cho Bé Sugar (Google Apps Script)
--   • bot.v_sync_status: trạng thái sync Meta + các lần import HubSpot (không có ID khách).
--   • public.bot_read(token, view, since): hàm duy nhất anon gọi được, CHẠY BẰNG QUYỀN bot_reader
--     (security definer, owner = bot_reader) → chỉ đọc được đúng các view bot.v_* đã cấp.
--     Token bot (32 byte ngẫu nhiên) chỉ lưu dạng SHA-256 trong public.bot_tokens.
--   Lý do không dùng JWT role bot_reader: dự án Supabase mới ký JWT bằng khóa bất đối xứng,
--   không tự ký được JWT cho role tùy chỉnh. Token + hàm whitelist cho cùng mức giới hạn.
-- =====================================================================

-- ---------- Token của bot (chỉ lưu hash) ----------
create table public.bot_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  label      text not null default 'gas' check (char_length(label) <= 60),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.bot_tokens enable row level security;
alter table public.bot_tokens force row level security;
revoke all on public.bot_tokens from anon, authenticated, public;
grant select on public.bot_tokens to bot_reader;
create policy bot_reader_active on public.bot_tokens for select to bot_reader using (revoked_at is null);

-- ---------- View trạng thái sync ----------
grant usage on schema bot to bot_owner;
grant create on schema bot to bot_owner;  -- tạm, thu hồi sau khi đổi owner (giống migration init)
grant select on public.crm_imports to bot_owner;
create policy bot_owner_read on public.crm_imports for select to bot_owner using (true);

create view bot.v_sync_status as
select r.id::text as id, r.kind, r.target_date, r.status, r.started_at, r.finished_at,
       r.date_from, r.date_to, r.rows, r.problems, r.note
from public.sync_runs r
union all
select i.id::text, 'hubspot_import', null::date, 'ok', i.imported_at, i.imported_at,
       i.date_from, i.date_to, i.submissions_rows + i.deals_rows, null::jsonb, null::text
from public.crm_imports i;

alter view bot.v_sync_status owner to bot_owner;
revoke all on bot.v_sync_status from public, anon, authenticated;
grant select on bot.v_sync_status to bot_reader;
revoke create on schema bot from bot_owner;

-- ---------- Hàm đọc duy nhất cho bot ----------
grant usage on schema public to bot_reader;
grant bot_reader to current_user;            -- để đổi owner hàm sang bot_reader
grant create on schema public to bot_reader; -- tạm: Postgres yêu cầu owner mới có CREATE trên schema

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
    when 'v_sync_status'    then v_col := 'started_at'; v_order := 'started_at desc, target_date desc nulls last';
    when 'v_campaign_daily' then v_col := 'date';       v_order := 'date desc, spend desc';
    when 'v_signals_latest' then v_col := null;         v_order := 'color, type';
    when 'v_project_master' then v_col := null;         v_order := 'name';
    when 'v_creative_perf'  then v_col := null;         v_order := 'spend desc';
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
