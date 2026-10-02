-- Infinite Pulls — API keys, kept out of the browser
-- =================================================
--
-- WHY THIS IS NOT JUST ANOTHER SETTINGS FIELD
--
-- Store name, opening hours and the announcement live in store_info,
-- which every visitor's browser reads. That is correct for those: they
-- are meant to be public.
--
-- A Ximilar token is not a setting, it is money. Whoever holds it can
-- spend the scanning budget. So this table is built the opposite way
-- round from every other table in this project:
--
--   NOBODY CAN READ IT. Not a customer, not staff, not the admin panel.
--   There is no select policy, and RLS is on, which means the value
--   column is unreachable over the REST API by anybody at all. The only
--   thing that ever sees it is the scan-card Edge Function, which runs
--   with the service role on Supabase's own servers.
--
--   ONLY SHOP STAFF CAN WRITE IT, through a function that checks
--   is_shop_staff() -- the same list that guards the admin panel.
--
-- WHAT THE PANEL SHOWS INSTEAD
--
-- Whether a key is set, its last four characters, and when it changed.
-- Enough for Jeff to confirm his key went in and to tell his apart from
-- Mike's in November, and useless to anybody who steals it.
--
-- SAFE TO RUN TWICE.

create table if not exists public.app_secrets (
  name        text        primary key,
  value       text        not null,
  hint        text,                      -- last 4 characters, safe to show
  updated_at  timestamptz not null default now(),
  updated_by  uuid        references auth.users(id) on delete set null
);

-- RLS on, and DELIBERATELY NO POLICIES. Postgres denies everything when a
-- table has RLS enabled and no policy grants otherwise, so this table is
-- invisible over the API. The functions below are security definer and
-- run as the owner, which is how staff reach it without it being exposed.
alter table public.app_secrets enable row level security;

-- Belt and braces: revoke the REST role's table rights outright, so the
-- protection does not rest on the policy list staying empty.
revoke all on public.app_secrets from anon, authenticated;


-- ---------------------------------------------------------------
-- WRITING A KEY — staff only
-- ---------------------------------------------------------------
create or replace function public.set_app_secret(p_name text, p_value text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v text;
begin
  if not public.is_shop_staff() then
    raise exception 'Only shop staff can change API keys.';
  end if;

  v := btrim(coalesce(p_value, ''));

  -- An empty box means "take the key out", not "save a blank key" -- so a
  -- mis-tap cannot silently disable the scanner with an unusable value.
  if v = '' then
    delete from public.app_secrets where name = p_name;
    return null;
  end if;

  insert into public.app_secrets (name, value, hint, updated_at, updated_by)
  values (p_name, v, right(v, 4), now(), auth.uid())
  on conflict (name) do update
    set value = excluded.value,
        hint = excluded.hint,
        updated_at = now(),
        updated_by = excluded.updated_by;

  return right(v, 4);
end;
$$;


-- ---------------------------------------------------------------
-- READING THE STATUS — staff only, and never the key itself.
-- Note what is NOT selected below. That is the whole point of this file.
-- ---------------------------------------------------------------
create or replace function public.app_secret_status()
returns table (name text, hint text, updated_at timestamptz, updated_by_email text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_staff() then
    raise exception 'Only shop staff can view API key status.';
  end if;

  return query
    select s.name, s.hint, s.updated_at, u.email::text
      from public.app_secrets s
      left join auth.users u on u.id = s.updated_by
     order by s.name;
end;
$$;

revoke all on function public.set_app_secret(text, text) from anon;
revoke all on function public.app_secret_status() from anon;
grant execute on function public.set_app_secret(text, text) to authenticated;
grant execute on function public.app_secret_status() to authenticated;

comment on table public.app_secrets is
  'Paid API keys. No select policy and no REST grants on purpose -- only the service role inside an Edge Function ever reads the value. Staff write through set_app_secret() and see only the last four characters through app_secret_status().';
