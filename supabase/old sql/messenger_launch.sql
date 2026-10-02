-- ============================================================
-- MESSENGER LAUNCH SWITCH -- 28 Sep 2026 (Mike).
--
-- Running this changes NOTHING people can see: Messages stays Mike and
-- Jeff only. It adds the ONE switch that opens it to everyone later:
--
--     update public.dm_settings set open = true;    -- everyone (who passes the rules)
--     update public.dm_settings set open = false;   -- back to Mike + Jeff only
--
-- When open, anyone can message who is: 18+, email confirmed, a week old
-- and active, following each other, not blocked, and NOT BANNED.
-- Banned = a moderator tapped "Turn off their messages", or two strikes
-- (adult links) in 30 days. Un-ban someone:
--     delete from public.dm_banned where user_id = (select id from public.profiles where username = 'NAME');
--
-- Who you can pick in Messages = people you follow who follow you back.
-- "Ask to chat" shows on people YOU follow who don't follow you back.
--
-- Run after messenger_safety.sql and messenger_trades.sql. SAFE TO RUN TWICE.
-- ============================================================

create table if not exists public.dm_settings (
  id   int primary key default 1 check (id = 1),
  open boolean not null default false
);
alter table public.dm_settings enable row level security;
insert into public.dm_settings (id, open) values (1, false) on conflict (id) do nothing;

create table if not exists public.dm_banned (
  user_id uuid primary key references auth.users(id) on delete cascade,
  why     text,
  at      timestamptz not null default now()
);
alter table public.dm_banned enable row level security;
drop policy if exists "moderators read bans" on public.dm_banned;
create policy "moderators read bans" on public.dm_banned for select to authenticated using (public.is_moderator());

create or replace function public.dm_is_open()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select open from public.dm_settings where id = 1), false); $$;
grant execute on function public.dm_is_open() to anon, authenticated, service_role;

-- on the list (test) / not banned (open)
create or replace function public.dm_allowed(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case when public.dm_is_open()
              then not exists (select 1 from public.dm_banned where user_id = p_user)
              else exists (select 1 from public.dm_access where user_id = p_user) end;
$$;
revoke all on function public.dm_allowed(uuid) from public, anon, authenticated;

create or replace function public.dm_self_why(p_user uuid)
returns text
language plpgsql stable security definer set search_path = public, auth
as $$
declare
  u record;
begin
  if not public.dm_allowed(p_user) then return 'access'; end if;
  if coalesce(public.age_years(p_user), 0) < 18 then return 'age'; end if;
  select created_at, email_confirmed_at into u from auth.users where id = p_user;
  if not found then return 'access'; end if;
  if u.email_confirmed_at is null then return 'email'; end if;
  if u.created_at > now() - interval '7 days' then return 'new'; end if;
  if not (exists (select 1 from public.user_cards where user_id = p_user)
       or exists (select 1 from public.user_photos where user_id = p_user)
       or exists (select 1 from public.user_loops where user_id = p_user)
       or exists (select 1 from public.post_comments where user_id = p_user)) then
    return 'active';
  end if;
  return null;
end;
$$;
revoke all on function public.dm_self_why(uuid) from public, anon, authenticated;

-- who sees the Messages icon at all
create or replace function public.dm_can()
returns boolean
language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null
     and public.dm_allowed(auth.uid())
     and coalesce(public.age_years(auth.uid()), 0) >= 18;
$$;
grant execute on function public.dm_can() to authenticated;

-- who you can message: people you follow who follow you back, and pass every rule
create or replace function public.dm_people()
returns table (id uuid, username text, avatar_url text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.username, p.avatar_url
    from public.follows a
    join public.follows b on b.follower_id = a.followee_id and b.followee_id = a.follower_id and b.following
    join public.profiles p on p.id = a.followee_id
   where public.dm_can() and a.follower_id = auth.uid() and a.following
     and public.dm_pair_why(auth.uid(), a.followee_id) is null
   order by p.username
   limit 500;
$$;
grant execute on function public.dm_people() to authenticated;

-- Ask to chat: people you follow who don't follow you back
create or replace function public.dm_askable()
returns table (id uuid)
language sql stable security definer set search_path = public
as $$
  select a.followee_id from public.follows a
   where public.dm_can() and a.follower_id = auth.uid() and a.following
     and public.dm_pair_why(auth.uid(), a.followee_id) = 'follow'
   limit 500;
$$;
grant execute on function public.dm_askable() to authenticated;

-- moderator "Turn off their messages" now bans (works in test and open)
create or replace function public.dm_revoke(p_user uuid)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_moderator() then return 'no'; end if;
  if exists (select 1 from public.moderators where user_id = p_user) then return 'no'; end if;
  insert into public.dm_banned (user_id, why) values (p_user, 'moderator') on conflict (user_id) do nothing;
  delete from public.dm_access where user_id = p_user;
  return 'ok';
end;
$$;
grant execute on function public.dm_revoke(uuid) to authenticated;

-- A correct result: 'launch switch: ok' and open = false.
select 'launch switch: ok' as status, public.dm_is_open() as open;
