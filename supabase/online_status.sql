-- ============================================================
-- ONLINE DOTS -- 27 Sep 2026 (Mike).
--
-- A green dot on somebody's picture when they have used the app in the
-- last few minutes, and "Active 12m ago" on their profile -- with a switch
-- to turn it off ("Show when I'm active", on by default).
--
-- WHY A SEPARATE TABLE. profiles is readable by everyone, so a last-seen
-- time kept there would be readable even by somebody who switched the dot
-- off. user_seen has row security switched on and NO policies, so nobody
-- can read it directly; the two functions below are the only way in, and
-- seen_status() only ever answers for people who have the switch on.
--
-- SAFE TO RUN TWICE.
-- ============================================================

alter table public.profiles
  add column if not exists show_active boolean not null default true;

create table if not exists public.user_seen (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table public.user_seen enable row level security;

-- "I'm here." Called by the app every couple of minutes while it is open.
-- Writes at most once a minute per person, however often it is called.
create or replace function public.touch_seen()
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_seen (user_id, last_seen_at)
  select auth.uid(), now()
  where auth.uid() is not null
  on conflict (user_id) do update
    set last_seen_at = excluded.last_seen_at
    where public.user_seen.last_seen_at < now() - interval '1 minute';
$$;

-- When were these people last here? Only people who are public AND have
-- the switch on, and only within the last week (older than that is not
-- "active" anything).
create or replace function public.seen_status(ids uuid[])
returns table (id uuid, last_seen_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id, s.last_seen_at
    from public.user_seen s
    join public.profiles p on p.id = s.user_id
   where s.user_id = any(ids[1:200])
     and p.show_active
     and coalesce(p.is_public, true)
     and s.last_seen_at > now() - interval '7 days';
$$;

revoke all on function public.touch_seen() from public;
grant execute on function public.touch_seen() to authenticated;
grant execute on function public.seen_status(uuid[]) to anon, authenticated;

-- A correct result: one row, 'ok'.
select case when exists (select 1 from information_schema.columns
                          where table_name = 'profiles' and column_name = 'show_active')
             and exists (select 1 from pg_proc where proname = 'seen_status')
            then 'ok' else 'MISSING' end as online_status;
