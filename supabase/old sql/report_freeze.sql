-- ============================================================
-- REPORTED = FROZEN until a moderator looks -- 28 Sep 2026 (Mike).
--
-- The moment somebody is reported (a chat report, OR a report on one of
-- their posts, cards, Loops or comments), they can't say anything anywhere
-- until Mike / Jeff / shop staff review it:
--     no messages, no chat requests, no comments, no new posts, no Loops,
--     no editing captions or card stories.
-- They can still look around, follow, add cards to their collection.
-- Whatever they try, they're told: "Your account is paused while the shop
-- reviews a report."
--
-- It lifts BY ITSELF when every open report about them is handled
-- (It's fine · clear, Take down, Turn off -- any of them). A "Turn off"
-- ban on Messages stays; the rest comes back.
--
-- Guard against a troll reporting everyone: a report only freezes someone
-- if the reporter's email is confirmed, the reporter isn't frozen, and the
-- reporter hasn't already frozen 3 people in the last 24 hours. (The report
-- still lands for the moderators either way.) Staff and moderators are
-- never frozen.
--
-- Enforced with database triggers, so it holds no matter what writes the
-- row -- the app, the Loops function, the Messages function.
--
-- Run after messenger_alerts.sql. SAFE TO RUN TWICE.
-- ============================================================

create table if not exists public.member_freeze (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete set null,
  why         text,
  at          timestamptz not null default now()
);
alter table public.member_freeze enable row level security;
drop policy if exists "moderators read freezes" on public.member_freeze;
create policy "moderators read freezes" on public.member_freeze for select to authenticated using (public.is_moderator());

create or replace function public.is_frozen(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.member_freeze where user_id = p_user); $$;
revoke all on function public.is_frozen(uuid) from public, anon;
grant execute on function public.is_frozen(uuid) to authenticated, service_role;

-- FREEZE someone (called by the report triggers)
create or replace function public.freeze_for_report(p_user uuid, p_reporter uuid, p_why text)
returns void
language plpgsql security definer set search_path = public, auth
as $$
begin
  if p_user is null or p_user = p_reporter then return; end if;
  if exists (select 1 from public.moderators where user_id = p_user)
     or exists (select 1 from public.shop_staff where user_id = p_user) then return; end if;
  if not exists (select 1 from auth.users where id = p_reporter and email_confirmed_at is not null) then return; end if;
  if exists (select 1 from public.member_freeze where user_id = p_reporter) then return; end if;
  if (select count(*) from public.member_freeze where reporter_id = p_reporter and at > now() - interval '24 hours') >= 3 then return; end if;
  insert into public.member_freeze (user_id, reporter_id, why)
  values (p_user, p_reporter, left(coalesce(p_why, 'reported'), 200))
  on conflict (user_id) do nothing;
end;
$$;
revoke all on function public.freeze_for_report(uuid, uuid, text) from public, anon, authenticated;

-- UNFREEZE when nothing about them is still open
create or replace function public.unfreeze_if_clear(p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_user is null then return; end if;
  if exists (select 1 from public.dm_reports where reported_id = p_user and handled_at is null) then return; end if;
  if exists (select 1 from public.post_reports where post_owner = p_user and handled_at is null) then return; end if;
  delete from public.member_freeze where user_id = p_user;
end;
$$;
revoke all on function public.unfreeze_if_clear(uuid) from public, anon, authenticated;

-- CHAT REPORTS: freeze (replaces the older 2-report auto-pause)
create or replace function public.dm_report_auto()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.freeze_for_report(new.reported_id, new.reporter_id, 'chat: ' || new.reason);
  return new;
exception when others then
  return new;
end;
$$;
drop trigger if exists dm_report_auto on public.dm_reports;
create trigger dm_report_auto after insert on public.dm_reports
  for each row execute function public.dm_report_auto();

-- POST REPORTS: freeze the owner + alert the moderators' phones
alter table public.post_reports add column if not exists alerted_at timestamptz;
create or replace function public.post_report_freeze()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.freeze_for_report(new.post_owner, new.reporter_id, 'post: ' || new.reason);
  begin
    perform net.http_post(
      url     := 'https://rrkyvcouxdmurwdyuugv.functions.supabase.co/push-out',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := jsonb_build_object('post_report_id', new.id)
    );
  exception when others then null;
  end;
  return new;
exception when others then
  return new;
end;
$$;
drop trigger if exists post_report_freeze on public.post_reports;
create trigger post_report_freeze after insert on public.post_reports
  for each row execute function public.post_report_freeze();

-- HANDLED -> maybe unfreeze
create or replace function public.dm_report_handled()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.handled_at is not null and old.handled_at is null then perform public.unfreeze_if_clear(new.reported_id); end if;
  return new;
end;
$$;
drop trigger if exists dm_report_handled on public.dm_reports;
create trigger dm_report_handled after update on public.dm_reports
  for each row execute function public.dm_report_handled();

create or replace function public.post_report_handled()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.handled_at is not null and old.handled_at is null then perform public.unfreeze_if_clear(new.post_owner); end if;
  return new;
end;
$$;
drop trigger if exists post_report_handled on public.post_reports;
create trigger post_report_handled after update on public.post_reports
  for each row execute function public.post_report_handled();

-- THE LOCK: every way of saying something checks the freeze
create or replace function public.block_if_frozen()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  who uuid;
  j jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
begin
  who := coalesce((j->>'sender_id')::uuid, (j->>'user_id')::uuid, (j->>'from_id')::uuid);
  if who is null or not public.is_frozen(who) then return new; end if;
  -- on an edit, only the words matter (a frozen person can still move a card, etc.)
  if tg_op = 'UPDATE' and (j->>'caption') is not distinct from (o->>'caption')
                      and (j->>'note') is not distinct from (o->>'note')
                      and (j->>'body') is not distinct from (o->>'body') then
    return new;
  end if;
  raise exception 'Your account is paused while the shop reviews a report.' using errcode = 'P0001';
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['post_comments', 'user_photos', 'user_loops', 'dm_messages', 'dm_asks'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists block_if_frozen on public.%I', t);
      execute format('create trigger block_if_frozen before insert or update on public.%I for each row execute function public.block_if_frozen()', t);
    end if;
  end loop;
  -- card stories: edits only (adding a card to your collection still works)
  execute 'drop trigger if exists block_if_frozen on public.user_cards';
  execute 'create trigger block_if_frozen before update on public.user_cards for each row execute function public.block_if_frozen()';
end $$;

-- messaging is off while frozen, too (on top of the triggers)
create or replace function public.dm_allowed(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select not public.is_frozen(p_user) and case when public.dm_is_open()
              then not exists (select 1 from public.dm_banned where user_id = p_user)
              else exists (select 1 from public.dm_access where user_id = p_user) end;
$$;
revoke all on function public.dm_allowed(uuid) from public, anon, authenticated;

-- say WHY messaging is off when frozen
create or replace function public.dm_self_why(p_user uuid)
returns text
language plpgsql stable security definer set search_path = public, auth
as $$
declare
  u record;
begin
  if public.is_frozen(p_user) then return 'frozen'; end if;
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

select 'freeze: ok' as status, (select count(*) from public.member_freeze) as frozen_now;
