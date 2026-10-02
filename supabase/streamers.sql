-- ============================================================
-- INFINITE PULLS: STREAMERS + GO LIVE. 2 Oct 2026 (Mike + Jeff).
-- Run in the INFINITE PULLS Supabase project. SAFE TO RUN TWICE.
--
-- "If you are a streamer, you would come in, fill out these things, and when
-- necessary you go live and your profile will be the live stream box up top."
-- "I want to integrate Infinite Pulls in with all these services and be the hub."
--
-- 1. THREE MORE PROFILE BUTTONS: Twitch, YouTube, Discord (next to Instagram,
--    TikTok, Whatnot, Collectr, Dex). Handles only, never a link, same as the
--    others: the app builds the address, so a Twitch button can only go to Twitch.
--    Discord holds the invite code (the end of a discord.gg link).
-- 2. WHO CAN GO LIVE: only people on streamer_access (Mike: "anyone you approve").
--    To approve somebody:
--      insert into public.streamer_access (user_id) select id from public.profiles where username = 'TheirName' on conflict do nothing;
--    To take it back:
--      delete from public.streamer_access where user_id = (select id from public.profiles where username = 'TheirName');
-- 3. LIVE NOW: one row per person who is live. Twitch (their channel) or YouTube
--    (the live video). It plays in the box at the top of the feed for everyone.
--    A stream shuts itself off here after 4 hours, or when they tap END.
--    18+ only, same line as Messages.
-- ============================================================

-- ---------- 1. the profile buttons ----------
alter table public.profiles add column if not exists twitch  text;
alter table public.profiles add column if not exists youtube text;
alter table public.profiles add column if not exists discord text;

alter table public.profiles drop constraint if exists profiles_twitch_handle;
alter table public.profiles add constraint profiles_twitch_handle
  check (twitch is null or twitch ~ '^[A-Za-z0-9_]{3,25}$');
alter table public.profiles drop constraint if exists profiles_youtube_handle;
alter table public.profiles add constraint profiles_youtube_handle
  check (youtube is null or youtube ~ '^[A-Za-z0-9._-]{3,30}$');
alter table public.profiles drop constraint if exists profiles_discord_invite;
alter table public.profiles add constraint profiles_discord_invite
  check (discord is null or discord ~ '^[A-Za-z0-9-]{2,32}$');

-- ---------- 2. who can go live ----------
create table if not exists public.streamer_access (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.streamer_access enable row level security;      -- no policies: nobody reads it from the app
revoke all on public.streamer_access from anon, authenticated;

insert into public.streamer_access (user_id)
select id from public.profiles where lower(username) in ('tacomike417', 'jefleppard')
on conflict do nothing;

create or replace function public.can_go_live()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from streamer_access where user_id = auth.uid())
     and not public.is_minor(auth.uid());
$$;

-- ---------- 3. live now ----------
create table if not exists public.live_now (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  platform   text not null check (platform in ('twitch', 'youtube')),
  ref        text not null check (char_length(ref) between 3 and 25),
  title      text check (title is null or char_length(title) <= 60),
  started_at timestamptz not null default now(),
  ends_at    timestamptz not null
);
alter table public.live_now enable row level security;
revoke all on public.live_now from anon, authenticated;
grant select on public.live_now to anon, authenticated;
drop policy if exists "anyone sees who is live" on public.live_now;
create policy "anyone sees who is live" on public.live_now for select to anon, authenticated
  using (ends_at > now());

-- go live: Twitch = the channel name; YouTube = the 11-character id of the live video
create or replace function public.go_live(p_platform text, p_ref text, p_title text default null)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r text := btrim(coalesce(p_ref, ''));
begin
  if not public.can_go_live() then raise exception 'Going live isn''t turned on for your account yet.' using errcode = 'P0001'; end if;
  if p_platform = 'twitch' then
    if r !~ '^[A-Za-z0-9_]{3,25}$' then raise exception 'That doesn''t look like a Twitch channel name.' using errcode = 'P0001'; end if;
  elsif p_platform = 'youtube' then
    if r !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'Paste the link to your YouTube live stream.' using errcode = 'P0001'; end if;
  else
    raise exception 'Pick Twitch or YouTube.' using errcode = 'P0001';
  end if;
  delete from live_now where ends_at <= now();
  insert into live_now (user_id, platform, ref, title, started_at, ends_at)
  values (me, p_platform, r, nullif(left(btrim(coalesce(p_title, '')), 60), ''), now(), now() + interval '4 hours')
  on conflict (user_id) do update set platform = excluded.platform, ref = excluded.ref, title = excluded.title,
                                      started_at = excluded.started_at, ends_at = excluded.ends_at;
end $$;

create or replace function public.end_live()
returns void language sql security definer set search_path = public as $$
  delete from live_now where user_id = auth.uid();
$$;

revoke all on function public.can_go_live(), public.go_live(text, text, text), public.end_live() from public, anon;
grant execute on function public.can_go_live(), public.go_live(text, text, text), public.end_live() to authenticated;

-- check: should say ready, and streamers_approved should be 2 (tacomike417 and Jefleppard)
select 'streamers ready' as status,
       (select count(*) from public.streamer_access) as streamers_approved,
       (select count(*) from public.live_now where ends_at > now()) as live_right_now;
