-- ============================================================
-- MESSENGER SAFETY LANE -- 28 Sep 2026 (Mike). Step 1 of the board.
--
-- To message someone, BOTH of you need all of this:
--   * on the dm_access list (the private test: Mike and Jeff)
--   * 18 or older, birthday on file (ages.sql)
--   * email confirmed
--   * EARNED IT: account a week old AND has done something real
--     (added a card, posted, made a Loop, or commented)
--   * you FOLLOW EACH OTHER
--   * nobody has BLOCKED anybody
--
-- BLOCK: uses the same user_blocks as the rest of the app. Blocking in a
--   chat also stops them seeing you in Messages.
-- REPORT: a chat report goes in dm_reports. Moderators can read THAT chat
--   while the report is open, and no other chat, ever. Clearing the report
--   locks it again.
--
-- Run messages.sql and ages.sql first. SAFE TO RUN TWICE.
-- ============================================================

-- WHY CAN'T THIS PERSON MESSAGE? null = they can. Server only.
create or replace function public.dm_self_why(p_user uuid)
returns text
language plpgsql stable security definer set search_path = public, auth
as $$
declare
  u record;
begin
  if not exists (select 1 from public.dm_access where user_id = p_user) then return 'access'; end if;
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

-- CAN THESE TWO TALK? null = yes, otherwise the reason. Server only.
create or replace function public.dm_pair_why(p_me uuid, p_other uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  w text;
begin
  if p_me = p_other then return 'self'; end if;
  w := public.dm_self_why(p_me);
  if w is not null then return 'me:' || w; end if;
  w := public.dm_self_why(p_other);
  if w is not null then return 'them:' || w; end if;
  if exists (select 1 from public.user_blocks b
              where (b.blocker_id = p_me and b.blocked_id = p_other)
                 or (b.blocker_id = p_other and b.blocked_id = p_me)) then
    return 'blocked';
  end if;
  if not (exists (select 1 from public.follows where follower_id = p_me and followee_id = p_other and following)
      and exists (select 1 from public.follows where follower_id = p_other and followee_id = p_me and following)) then
    return 'follow';
  end if;
  return null;
end;
$$;
revoke all on function public.dm_pair_why(uuid, uuid) from public, anon, authenticated;
grant execute on function public.dm_pair_why(uuid, uuid) to service_role;

-- WHO YOU CAN MESSAGE: only people who pass every rule with you.
create or replace function public.dm_people()
returns table (id uuid, username text, avatar_url text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.username, p.avatar_url
    from public.dm_access a join public.profiles p on p.id = a.user_id
   where public.dm_can() and a.user_id <> auth.uid()
     and public.dm_pair_why(auth.uid(), a.user_id) is null
   order by p.username;
$$;
grant execute on function public.dm_people() to authenticated;

-- REPORTED CHATS
create table if not exists public.dm_reports (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.dm_threads(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_id uuid references auth.users(id) on delete cascade,
  reason      text not null check (char_length(reason) between 1 and 300),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);
create index if not exists dm_reports_open_idx on public.dm_reports (thread_id) where handled_at is null;
alter table public.dm_reports enable row level security;

drop policy if exists "moderators handle chat reports" on public.dm_reports;
create policy "moderators handle chat reports"
  on public.dm_reports for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

-- FILE A REPORT (only someone in the chat). Returns 'ok' or 'no'.
create or replace function public.dm_report(p_thread uuid, p_reason text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  t record;
begin
  select * into t from public.dm_threads where id = p_thread;
  if not found or auth.uid() is null or auth.uid() not in (t.user_a, t.user_b) then return 'no'; end if;
  if exists (select 1 from public.dm_reports where thread_id = p_thread and reporter_id = auth.uid() and handled_at is null) then
    return 'ok';
  end if;
  insert into public.dm_reports (thread_id, reporter_id, reported_id, reason)
  values (p_thread, auth.uid(), case when t.user_a = auth.uid() then t.user_b else t.user_a end,
          left(coalesce(nullif(trim(p_reason), ''), 'Reported'), 300));
  return 'ok';
end;
$$;
grant execute on function public.dm_report(uuid, text) to authenticated;

-- MODERATORS READ A CHAT ONLY WHILE IT HAS AN OPEN REPORT
drop policy if exists "moderators read reported chats" on public.dm_threads;
create policy "moderators read reported chats"
  on public.dm_threads for select to authenticated
  using (public.is_moderator() and exists (
    select 1 from public.dm_reports r where r.thread_id = dm_threads.id and r.handled_at is null));

drop policy if exists "moderators read reported messages" on public.dm_messages;
create policy "moderators read reported messages"
  on public.dm_messages for select to authenticated
  using (public.is_moderator() and exists (
    select 1 from public.dm_reports r where r.thread_id = dm_messages.thread_id and r.handled_at is null));

-- MODERATOR: turn someone's messaging off (removes them from dm_access).
create or replace function public.dm_revoke(p_user uuid)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_moderator() then return 'no'; end if;
  if exists (select 1 from public.moderators where user_id = p_user) then return 'no'; end if;
  delete from public.dm_access where user_id = p_user;
  return 'ok';
end;
$$;
grant execute on function public.dm_revoke(uuid) to authenticated;

-- A correct result: one row, 'safety: ok' and 'you and Jeff: can message'
-- (if it says something else, that word is what's missing -- send it to Claude).
select 'safety: ok' as status,
       coalesce(public.dm_pair_why(
         (select id from public.profiles where lower(username) = 'tacomike417'),
         (select id from public.profiles where lower(username) = 'jefleppard')),
         'you and Jeff: can message') as you_and_jeff;
