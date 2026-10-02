-- ============================================================
-- SUGGESTED PEOPLE TO FOLLOW -- 27 Sep 2026.
--
-- Built now, OFF until the site has 50 public members; then it turns on by
-- itself (Mike). Shop staff can preview it early with p_preview => true.
--
-- Who can be suggested: public members you do not already follow, with a
-- profile picture, not blocked either way, and ACTIVE in the last 14 days
-- (posted, commented, or added cards). Inactive people never show (Mike:
-- a suggestion that leads to a dead profile is a wasted follow).
--
-- Ranked by how active they are, with mutual follows as a boost:
--   photo posts x3 + comments x2 + days they added cards x1
--   + 4 for each person you follow who follows them
-- Reason line: "Followed by @jeff", else "Posted 3 times this week",
-- else "Active this week".
--
-- SAFE TO RUN TWICE.
-- ============================================================

create or replace function public.suggested_follows(p_limit int default 12, p_preview boolean default false)
returns table (id uuid, username text, avatar_url text, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then return; end if;
  if (select count(*) from public.profiles where is_public) < 50
     and not (p_preview and public.is_shop_staff()) then
    return;                                   -- not switched on yet
  end if;

  return query
  with mine as (                              -- who I follow
    select followee_id from public.follows where follower_id = v_me and following
  ),
  photos as (
    select user_id as id, count(*)::int as n14,
           count(*) filter (where added_at > now() - interval '7 days')::int as n7
      from public.user_photos where added_at > now() - interval '14 days'
     group by user_id
  ),
  talk as (
    select user_id as id, count(*)::int as n
      from public.post_comments
     where created_at > now() - interval '14 days' and hidden_at is null
     group by user_id
  ),
  carddays as (
    select user_id as id, count(distinct (added_at at time zone 'America/New_York')::date)::int as n
      from public.user_cards where added_at > now() - interval '14 days'
     group by user_id
  ),
  mutual as (
    select f.followee_id as id, count(*)::int as n, min(pr.username) as one
      from public.follows f
      join mine m on m.followee_id = f.follower_id
      join public.profiles pr on pr.id = f.follower_id
     where f.following
     group by f.followee_id
  ),
  cand as (
    select p.id, p.username, p.avatar_url,
           coalesce(ph.n14, 0) * 3 + coalesce(t.n, 0) * 2 + coalesce(cd.n, 0) as act,
           coalesce(ph.n7, 0) as week_posts,
           coalesce(mu.n, 0) as mut, mu.one
      from public.profiles p
      left join photos ph on ph.id = p.id
      left join talk t on t.id = p.id
      left join carddays cd on cd.id = p.id
      left join mutual mu on mu.id = p.id
     where p.is_public and p.id <> v_me
       and coalesce(p.avatar_url, '') <> '' and p.username is not null
       and not exists (select 1 from mine where followee_id = p.id)
       and not exists (select 1 from public.user_blocks b
                        where (b.blocker_id = v_me and b.blocked_id = p.id)
                           or (b.blocker_id = p.id and b.blocked_id = v_me))
  )
  select c.id, c.username, c.avatar_url,
         case when c.mut > 1 then 'Followed by @' || c.one || ' and ' || (c.mut - 1) || ' more'
              when c.mut = 1 then 'Followed by @' || c.one
              when c.week_posts > 1 then 'Posted ' || c.week_posts || ' times this week'
              when c.week_posts = 1 then 'Posted this week'
              else 'Active this week' end
    from cand c
   where c.act > 0                            -- active in the last 14 days, or not at all
   order by c.act + c.mut * 4 desc, random()
   limit least(greatest(coalesce(p_limit, 12), 1), 30);
end;
$$;

grant execute on function public.suggested_follows(int, boolean) to authenticated;

-- A correct result: one row with how many public members there are (it
-- turns on at 50).
select count(*) as public_members, (count(*) >= 50) as suggestions_on
  from public.profiles where is_public;
