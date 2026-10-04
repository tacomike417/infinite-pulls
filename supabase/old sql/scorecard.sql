-- ============================================================
-- SCORECARD -- 4 Oct 2026 (Mike: "idk even know how to check ... just put the
-- results on my profile for me to find").
--
-- One door for the Scorecard page (infinitepulls.com/scorecard/, the SCORECARD
-- row in MY STUFF and in the menu). MODERATORS ONLY: anybody else gets nothing.
-- It only reads. It answers: how many people joined, each day, who invited
-- them, who asked to be an affiliate, and how many TV videos are left.
--
-- SAFE TO RUN TWICE.
-- ============================================================

create or replace function public.scorecard()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare out jsonb;
begin
  if not public.is_moderator() then return null; end if;
  select jsonb_build_object(
    'people',     (select count(*) from auth.users),
    'week',       (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'today',      (select count(*) from auth.users where (created_at at time zone 'America/New_York')::date = (now() at time zone 'America/New_York')::date),
    'invited',    (select count(*) from profiles where invited_by is not null),
    'affiliates', (select count(*) from affiliates),
    'asked',      (select count(*) from affiliate_waitlist),
    'days', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'n', n) order by d desc), '[]'::jsonb) from (
               select g::date as d,
                      (select count(*) from auth.users u where (u.created_at at time zone 'America/New_York')::date = g::date) as n
                 from generate_series((now() at time zone 'America/New_York')::date - 13, (now() at time zone 'America/New_York')::date, interval '1 day') g) x),
    'newest', (select coalesce(jsonb_agg(jsonb_build_object('username', username, 'at', at, 'by', by) order by at desc), '[]'::jsonb) from (
               select p.username, u.created_at as at, i.username as by
                 from auth.users u join profiles p on p.id = u.id left join profiles i on i.id = p.invited_by
                order by u.created_at desc limit 10) x),
    'waitlist', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'username', username, 'followers', followers, 'at', created_at) order by created_at desc), '[]'::jsonb)
                   from affiliate_waitlist),
    'inviters', (select coalesce(jsonb_agg(jsonb_build_object('username', username, 'n', n) order by n desc), '[]'::jsonb) from (
               select p.username, count(*) as n from profiles c join profiles p on p.id = c.invited_by group by p.username order by 2 desc limit 10) x),
    'tv', (select coalesce(jsonb_agg(jsonb_build_object('show', show, 'waiting', waiting, 'posted', posted) order by show), '[]'::jsonb) from (
               select case when n < 2000 then 'Crazy J' when n < 3000 then 'Pulls News' else 'The Collector' end as show,
                      count(*) filter (where status = 'queued') as waiting,
                      count(*) filter (where status = 'posted') as posted
                 from house_loops group by 1) x)
  ) into out;
  return out;
end $$;

revoke all on function public.scorecard() from public, anon;
grant execute on function public.scorecard() to authenticated;

-- A correct result: one row that says 'scorecard: ok'.
select 'scorecard: ok' as status;
