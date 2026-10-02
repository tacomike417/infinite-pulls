-- ============================================================
-- FREEZE AT 3 REPORTS, not 1 -- 28 Sep 2026 (Mike: "3 reports and then
-- you are done").
--
-- Every report still sends the moderators a phone alert. But someone is
-- only FROZEN (no messages, comments, posts, Loops) once 3 DIFFERENT
-- people have open reports about them in the last 30 days -- chat
-- reports and post reports counted together. Only reporters with a
-- confirmed email who aren't frozen themselves count.
-- It still lifts by itself when every open report about them is handled.
--
-- Run after report_freeze.sql. SAFE TO RUN TWICE.
-- ============================================================

create or replace function public.freeze_for_report(p_user uuid, p_reporter uuid, p_why text)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  n int;
begin
  if p_user is null or p_user = p_reporter then return; end if;
  if exists (select 1 from public.moderators where user_id = p_user)
     or exists (select 1 from public.shop_staff where user_id = p_user) then return; end if;

  select count(distinct r.who) into n
    from (
      select reporter_id as who from public.dm_reports
       where reported_id = p_user and handled_at is null and created_at > now() - interval '30 days'
      union
      select reporter_id from public.post_reports
       where post_owner = p_user and handled_at is null and created_at > now() - interval '30 days'
    ) r
    join auth.users u on u.id = r.who and u.email_confirmed_at is not null
   where r.who <> p_user
     and not exists (select 1 from public.member_freeze f where f.user_id = r.who);

  if n >= 3 then
    insert into public.member_freeze (user_id, reporter_id, why)
    values (p_user, p_reporter, left('3 reports -- latest: ' || coalesce(p_why, 'reported'), 200))
    on conflict (user_id) do nothing;
  end if;
end;
$$;
revoke all on function public.freeze_for_report(uuid, uuid, text) from public, anon, authenticated;

select 'freeze at 3: ok' as status;
