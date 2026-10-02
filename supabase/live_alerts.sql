-- ============================================================
-- LIVE ALERTS -- 2 Oct 2026.
--
-- When an approved streamer taps GO LIVE, everybody who follows them
-- gets one alert: "@them is live now". It shows in the bell and goes to
-- their phone like every other alert. Tapping it opens the streamer's
-- profile, where the LIVE box is.
--   * one alert per follower per streamer every 3 hours, so restarting
--     a stream doesn't ping people twice
--   * if the alert can't be written, going live still works
--
-- SAFE TO RUN TWICE.
-- ============================================================

-- 1. let the alerts table hold the new kind, keeping every kind it has now
do $$
declare d text;
begin
  select pg_get_constraintdef(oid) into d from pg_constraint
   where conname = 'notifications_kind_check' and conrelid = 'public.notifications'::regclass;
  if d is not null and position('''live''' in d) = 0 then
    d := replace(d, 'ARRAY[', 'ARRAY[''live''::text, ');
    alter table public.notifications drop constraint notifications_kind_check;
    execute 'alter table public.notifications add constraint notifications_kind_check ' || d;
  end if;
end $$;

-- 2. tell the followers
create or replace function public.notify_live(p_me uuid, p_platform text, p_title text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_name text; v_say text; n integer := 0;
begin
  select username into v_name from profiles where id = p_me;
  if v_name is null then return 0; end if;
  v_say := '@' || v_name || ' is live on ' || case when p_platform = 'youtube' then 'YouTube' else 'Twitch' end
           || coalesce(': ' || nullif(btrim(p_title), ''), '') || '. Tap to watch.';
  insert into notifications (user_id, actor_id, kind, detail, href)
  select f.follower_id, p_me, 'live', v_say, '/feed-next/?who=' || v_name
    from follows f
   where f.followee_id = p_me and f.following and f.follower_id <> p_me
     and not exists (select 1 from notifications x
                      where x.user_id = f.follower_id and x.actor_id = p_me and x.kind = 'live'
                        and x.created_at > now() - interval '3 hours');
  get diagnostics n = row_count;
  return n;
exception when others then
  return 0;            -- an alert that can't go out must never stop the stream
end $$;
revoke all on function public.notify_live(uuid, text, text) from public, anon, authenticated;

-- 3. GO LIVE, same as before, plus the alert at the end
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
  perform public.notify_live(me, p_platform, p_title);
end $$;
revoke all on function public.go_live(text, text, text) from public, anon;
grant execute on function public.go_live(text, text, text) to authenticated;

-- check: should say ready, and kind_allowed should be 1
select 'live alerts ready' as status,
       (select count(*) from pg_constraint
         where conname = 'notifications_kind_check'
           and position('''live''' in pg_get_constraintdef(oid)) > 0) as kind_allowed,
       (select count(*) from public.follows f join public.streamer_access s on s.user_id = f.followee_id
         where f.following) as followers_who_would_be_told;
