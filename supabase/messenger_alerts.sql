-- ============================================================
-- MESSENGER: ALERTS + AUTOMATIC REPORT HANDLING -- 28 Sep 2026 (Mike).
--
-- CHAT REQUESTS count on the Messages icon (and send a phone alert --
-- that part is the messages function).
--
-- REPORTS, AS AUTOMATIC AS WE CAN MAKE IT:
--   * Every report sends the moderators a phone alert (messages function).
--   * AUTO-PAUSE: someone's messaging turns itself off, before anybody
--     looks, when EITHER
--       - 2 different people report them within 7 days, or
--       - they're reported AND the filters already caught them (bad words,
--         adult or scam links) in the last 30 days.
--     They're told nothing; Messages just goes away for them.
--   * The moderator's two buttons:
--       It's fine · clear  -> report closed, an automatic pause is lifted
--       Turn off           -> banned for good (dm_revoke)
--   * Open reports count on the moderators' Messages icon until handled.
--
-- Run after messenger_launch.sql. SAFE TO RUN TWICE.
-- ============================================================

create or replace function public.dm_report_auto()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  reporters int;
  flagged boolean;
begin
  if new.reported_id is null then return new; end if;
  if exists (select 1 from public.moderators where user_id = new.reported_id)
     or exists (select 1 from public.shop_staff where user_id = new.reported_id) then
    return new;
  end if;
  select count(distinct reporter_id) into reporters from public.dm_reports
   where reported_id = new.reported_id and created_at > now() - interval '7 days';
  select exists (select 1 from public.dm_flags where user_id = new.reported_id and created_at > now() - interval '30 days')
    into flagged;
  if reporters >= 2 or flagged then
    insert into public.dm_banned (user_id, why)
    values (new.reported_id, 'auto: ' || case when reporters >= 2 then reporters || ' reports in 7 days' else 'reported + caught by the filters' end)
    on conflict (user_id) do nothing;
  end if;
  return new;
exception when others then
  return new;
end;
$$;
drop trigger if exists dm_report_auto on public.dm_reports;
create trigger dm_report_auto after insert on public.dm_reports
  for each row execute function public.dm_report_auto();

-- MODERATOR: close a reported chat; lifts an automatic pause (not a real ban).
create or replace function public.dm_clear_report(p_thread uuid)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_moderator() then return 'no'; end if;
  delete from public.dm_banned b
   where b.why like 'auto:%'
     and b.user_id in (select reported_id from public.dm_reports where thread_id = p_thread and handled_at is null);
  update public.dm_reports set handled_at = now() where thread_id = p_thread and handled_at is null;
  return 'ok';
end;
$$;
grant execute on function public.dm_clear_report(uuid) to authenticated;

-- THE NUMBER ON THE MESSAGES ICON: unread messages + chat requests
-- (+ open reports, for moderators).
create or replace function public.dm_badge()
returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce(public.dm_unread(), 0)
       + (select count(*)::int from public.dm_asks q
           where q.to_id = auth.uid() and q.answered_at is null and q.created_at > now() - interval '30 days'
             and not exists (select 1 from public.user_blocks b
                              where (b.blocker_id = auth.uid() and b.blocked_id = q.from_id)
                                 or (b.blocker_id = q.from_id and b.blocked_id = auth.uid())))
       + case when public.is_moderator()
              then (select count(distinct thread_id)::int from public.dm_reports where handled_at is null)
              else 0 end;
$$;
grant execute on function public.dm_badge() to authenticated;

-- WHO GETS REPORT ALERTS (server only): moderators + shop staff.
create or replace function public.dm_mod_ids()
returns table (user_id uuid)
language sql stable security definer set search_path = public
as $$
  select m.user_id from public.moderators m
  union
  select s.user_id from public.shop_staff s;
$$;
revoke all on function public.dm_mod_ids() from public, anon, authenticated;
grant execute on function public.dm_mod_ids() to service_role;

-- "Turn off their messages" is a REAL ban even if they were auto-paused
-- first (so clearing the report afterwards can't lift it).
create or replace function public.dm_revoke(p_user uuid)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_moderator() then return 'no'; end if;
  if exists (select 1 from public.moderators where user_id = p_user) then return 'no'; end if;
  insert into public.dm_banned (user_id, why) values (p_user, 'moderator')
  on conflict (user_id) do update set why = 'moderator', at = now();
  delete from public.dm_access where user_id = p_user;
  return 'ok';
end;
$$;
grant execute on function public.dm_revoke(uuid) to authenticated;

select 'alerts: ok' as status, (select count(*) from public.dm_mod_ids()) as moderators;
