-- ============================================================
-- THE STORE GOES LIVE = EVERYBODY HEARS ABOUT IT -- 2 Oct 2026.
--
-- 1. When the store's own login (InfinitePullsTCG) taps GO LIVE, every
--    member gets the alert, not just followers. That is unique to that one
--    account. Everybody else's stream still only pings their followers.
--    The alert says "Infinite Pulls is live", and tapping it opens the feed.
-- 2. Approved streamers don't need a birthdate on file to see GO LIVE
--    (Mike approves each one by hand). An account that HAS a birthdate
--    under 18 is still blocked.
--
-- 3. A banned (frozen) account's stream comes off the site at once and it can't go live.
--
-- SAFE TO RUN TWICE.
-- ============================================================

create or replace function public.can_go_live()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from streamer_access where user_id = auth.uid())
     and coalesce(public.age_years(auth.uid()), 18) >= 18
     and not public.is_frozen(auth.uid());          -- a frozen (reported / banned) account can't go live
$$;

-- 3. BAN = OFF THE AIR. The moment an account is frozen, its stream comes off the site,
--    and it can't go live again until it's unfrozen. Taking somebody off the streamer
--    list does the same thing.
create or replace function public.live_off_when_out()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from live_now where user_id = coalesce(new.user_id, old.user_id);
  return null;
end $$;
drop trigger if exists live_off_on_freeze on public.member_freeze;
create trigger live_off_on_freeze after insert on public.member_freeze
  for each row execute function public.live_off_when_out();
drop trigger if exists live_off_on_unapprove on public.streamer_access;
create trigger live_off_on_unapprove after delete on public.streamer_access
  for each row execute function public.live_off_when_out();

-- To take somebody off the streamer list for good (their stream ends at once), run this
-- with their username in it:
--   delete from public.streamer_access where user_id = (select id from public.profiles where lower(username) = lower('THEIR_USERNAME'));

create or replace function public.notify_live(p_me uuid, p_platform text, p_title text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_store constant uuid := '7b229c0c-12a0-49d8-bfeb-26b55d79236e';   -- the store's login, same id as config.js
  v_name text; v_say text; v_on text; n integer := 0;
begin
  select username into v_name from profiles where id = p_me;
  if v_name is null then return 0; end if;
  v_on := case when p_platform = 'youtube' then 'YouTube' else 'Twitch' end
          || coalesce(': ' || nullif(btrim(p_title), ''), '') || '. Tap to watch.';

  if p_me = v_store then
    v_say := 'Infinite Pulls is live on ' || v_on;
    insert into notifications (user_id, actor_id, kind, detail, href)
    select p.id, p_me, 'live', v_say, '/feed-next/'
      from profiles p
     where p.id <> p_me
       and not exists (select 1 from notifications x
                        where x.user_id = p.id and x.actor_id = p_me and x.kind = 'live'
                          and x.created_at > now() - interval '3 hours');
  else
    v_say := '@' || v_name || ' is live on ' || v_on;
    insert into notifications (user_id, actor_id, kind, detail, href)
    select f.follower_id, p_me, 'live', v_say, '/feed-next/?who=' || v_name
      from follows f
     where f.followee_id = p_me and f.following and f.follower_id <> p_me
       and not exists (select 1 from notifications x
                        where x.user_id = f.follower_id and x.actor_id = p_me and x.kind = 'live'
                          and x.created_at > now() - interval '3 hours');
  end if;
  get diagnostics n = row_count;
  return n;
exception when others then
  return 0;            -- an alert that can't go out must never stop the stream
end $$;
revoke all on function public.notify_live(uuid, text, text) from public, anon, authenticated;

-- check: store_account should be InfinitePullsTCG, and members_who_would_be_told is everybody but the store
select 'store alerts ready' as status,
       (select username from public.profiles where id = '7b229c0c-12a0-49d8-bfeb-26b55d79236e') as store_account,
       (select count(*) from public.profiles where id <> '7b229c0c-12a0-49d8-bfeb-26b55d79236e') as members_who_would_be_told;
