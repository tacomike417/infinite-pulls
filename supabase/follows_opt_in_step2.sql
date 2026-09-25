-- ============================================================
-- REAL FOLLOWING, STEP 2 -- 25 Sep 2026 (SOCIAL-NEXT part 6)
--
-- The numbers on the profile header. Follow rows stay private (only you
-- can read your own), so the counts come from a function that returns
-- two numbers and nothing else: nobody can use it to see WHO follows
-- whom, only how many.
--
-- Only following = true counts. The shop is not an account, so it is
-- never in these numbers; its posts are simply always in Following.
-- SAFE TO RUN TWICE.
-- ============================================================

create or replace function public.follow_counts(uid uuid)
returns table (followers bigint, following bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.follows f
       join public.profiles p on p.id = f.follower_id
      where f.followee_id = uid and f.following) as followers,
    (select count(*) from public.follows f
       join public.profiles p on p.id = f.followee_id
      where f.follower_id = uid and f.following) as following;
$$;

revoke all on function public.follow_counts(uuid) from public;
grant execute on function public.follow_counts(uuid) to anon, authenticated;

-- Check: your own numbers. Right now both are about 20.
select * from public.follow_counts(
  (select id from public.profiles where lower(username) = 'tacomike417'));
