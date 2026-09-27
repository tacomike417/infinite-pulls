-- ============================================================
-- HOT THIS WEEK -- social pack #8, 27 Sep 2026.
--
-- The photo posts getting the most love in the last 7 days, for the strip
-- at the top of the feed. Score = heat + 2 x comments, counting only other
-- people (your own heat and your own comments on your post do not count).
--
-- Runs as the person asking (security invoker), so a private profile's
-- photos stay out exactly the way they stay out of the feed.
--
-- SAFE TO RUN TWICE.
-- ============================================================

create or replace function public.hot_this_week(p_limit int default 12)
returns table (
  id uuid, user_id uuid, object_key text, caption text, added_at timestamptz,
  heat int, talk int, score int
)
language sql
stable
set search_path = public
as $$
  with h as (
    select ph.post_key, count(*)::int as n
      from public.post_heat ph
     where ph.created_at > now() - interval '7 days'
       and ph.post_key like 'p-%'
       and ph.user_id is distinct from ph.post_owner
     group by ph.post_key
  ),
  c as (
    select pc.post_key, count(*)::int as n
      from public.post_comments pc
     where pc.created_at > now() - interval '7 days'
       and pc.post_key like 'p-%'
       and pc.hidden_at is null
       and pc.user_id <> pc.post_owner
     group by pc.post_key
  )
  select up.id, up.user_id, up.object_key, up.caption, up.added_at,
         coalesce(h.n, 0), coalesce(c.n, 0),
         coalesce(h.n, 0) + 2 * coalesce(c.n, 0)
    from public.user_photos up
    left join h on h.post_key = 'p-' || up.id::text
    left join c on c.post_key = 'p-' || up.id::text
   where h.n is not null or c.n is not null
   order by 8 desc, up.added_at desc
   limit least(greatest(coalesce(p_limit, 12), 1), 20);
$$;

grant execute on function public.hot_this_week(int) to anon, authenticated;

-- A correct result: up to 12 rows (or none, if nobody gave heat this week).
select id, heat, talk, score from public.hot_this_week(12);
