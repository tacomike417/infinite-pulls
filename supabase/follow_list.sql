-- ============================================================
-- FOLLOW LIST -- 27 Sep 2026.
--
-- Tapping "followers" or "following" on a profile opens the list, the way
-- it does on Instagram. The follows table stays private (only you can read
-- your own rows), so the list comes out of this one function, which hands
-- back PUBLIC profiles only -- names and faces, nothing else.
--
-- which = 'followers' -> people who follow uid
-- which = 'following' -> people uid follows
--
-- SAFE TO RUN TWICE.
-- ============================================================

create or replace function public.follow_list(uid uuid, which text)
returns table (id uuid, username text, display_name text, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.display_name, p.avatar_url
    from public.follows f
    join public.profiles p
      on p.id = case when which = 'following' then f.followee_id else f.follower_id end
   where f.following
     and coalesce(p.is_public, true)
     and case when which = 'following' then f.follower_id = uid else f.followee_id = uid end
   order by f.changed_at desc
   limit 500;
$$;

revoke all on function public.follow_list(uuid, text) from public;
grant execute on function public.follow_list(uuid, text) to anon, authenticated;

-- A correct result: a list of names (or nothing, if nobody follows you yet).
select username from public.follow_list(
  (select id from public.profiles where lower(username) = 'tacomike417'), 'followers') limit 5;
