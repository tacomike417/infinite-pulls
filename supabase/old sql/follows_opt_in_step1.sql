-- ============================================================
-- REAL FOLLOWING, STEP 1 -- 25 Sep 2026 (SOCIAL-NEXT part 6)
--
-- Until now "no row" meant "following" (everybody follows everybody).
-- Mike's call: switch to real, opt-in following like Instagram, but keep
-- every CURRENT member following every other current member, exactly as
-- they see it today. New people start out following only the shop.
--
-- This step only WRITES the rows that make today's picture explicit:
-- one following=true row for every pair of current members that has no
-- row yet. The one existing unfollow is left alone -- it stays an
-- unfollow. Nothing on the site changes when this runs; the app still
-- reads "no row" as following until the new feed code ships.
--
-- SAFE TO RUN TWICE: on conflict do nothing.
-- ============================================================

insert into public.follows (follower_id, followee_id, following, changed_at)
select a.id, b.id, true, now()
  from public.profiles a
  join public.profiles b on a.id <> b.id
on conflict (follower_id, followee_id) do nothing;

-- Check: every pair now has a row, and the one unfollow is still there.
select
  (select count(*) from public.profiles)                          as members,
  (select count(*) from public.profiles) * ((select count(*) from public.profiles) - 1) as pairs_expected,
  (select count(*) from public.follows)                           as rows_now,
  (select count(*) from public.follows where following = false)   as unfollows;
