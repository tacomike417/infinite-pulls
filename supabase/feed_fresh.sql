-- ============================================================
-- FEED LEANS NEWER -- 27 Sep 2026 (Jeff).
--
-- The feed deals posts person by person so nobody hogs it. Until now the
-- ORDER of people was random, so somebody who posted ten minutes ago could
-- be forty seats down. This tells the app when each person last put
-- something up, so the most recent get their turn first:
--   * posted in the last day  -> top, newest first
--   * last week               -> next, shuffled
--   * everybody else          -> after that, shuffled (same as before)
-- A photo post counts as fresher than adding cards (cards count as if they
-- were 3 hours older), so a big import does not jump ahead of a real post.
-- Only public profiles, only a timestamp per person.
--
-- SAFE TO RUN TWICE.
-- ============================================================

create or replace function public.feed_freshness()
returns table (user_id uuid, last_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select x.user_id, max(x.at)
    from (
      select user_id, added_at as at
        from public.user_photos where added_at > now() - interval '14 days'
      union all
      select user_id, added_at - interval '3 hours'
        from public.user_cards where added_at > now() - interval '14 days'
      union all
      select user_id, earned_at - interval '3 hours'
        from public.user_reward_cards
       where claimed_at is not null and earned_at > now() - interval '14 days'
    ) x
    join public.profiles p on p.id = x.user_id and p.is_public
   group by x.user_id;
$$;

grant execute on function public.feed_freshness() to anon, authenticated;

-- A correct result: a list of people with their last post time, newest first.
select f.user_id, p.username, f.last_at
  from public.feed_freshness() f join public.profiles p on p.id = f.user_id
 order by f.last_at desc limit 15;
