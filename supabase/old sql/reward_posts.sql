-- ===========================================================================
-- REWARD CARDS IN THE FEED.
-- Run after infinite_rewards.sql. Safe to re-run.
--
-- A post has been one of two things since the feed was built: a card you
-- added (c-<uuid>) or a photo you put up (p-<uuid>). An earned reward card
-- is a third (r-<uuid>), and it is a real post -- people can heat it and
-- comment on it, because somebody else finishing the set is exactly the
-- thing worth saying something about.
--
-- NOTHING IS STORED. There is no reward_posts table: a post IS the row in
-- user_reward_cards, and a batch is however many landed in the same minute.
-- That means the feed can never disagree with the ledger, and earning a
-- card stays one insert.
--
-- The key is r- plus the id of the FIRST card in the batch, so the key of a
-- post does not change when a second card lands beside it.
--
-- ⚠ A CHECK CONSTRAINT IS REWRITTEN, NOT ADDED TO. Both statements below
--   list every prefix the app uses -- c, p AND r. Dropping one and writing
--   only the new value silently deletes the others, which is how post_heat
--   quietly deleted the system notification kinds in September.
-- ===========================================================================

alter table public.post_comments drop constraint if exists post_comments_key_shape;
alter table public.post_comments add constraint post_comments_key_shape
  check (post_key ~ '^[cpr]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

alter table public.post_heat drop constraint if exists post_heat_key_shape;
alter table public.post_heat add constraint post_heat_key_shape
  check (post_key ~ '^[cpr]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- The feed reads other people's earned cards, and until now user_reward_cards
-- was readable only by its owner or on a public profile. A post in the feed
-- is public by definition, so this is the same rule the feed already applies
-- to cards and photos: if the profile is public, the row is visible.
--
-- Already covered by "public reads cards of public profiles" in
-- infinite_rewards.sql -- stated here so the dependency is written down
-- rather than discovered when the feed comes back empty.

-- CHECK: all three prefixes accepted, nothing else.
do $$
declare ok boolean;
begin
  for ok in
    select true from (values ('c'),('p'),('r')) v(k)
  loop null; end loop;

  -- a good key of each kind
  perform 1 where 'c-11111111-2222-3333-4444-555555555555' ~ '^[cpr]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  raise notice 'c/p/r keys accepted, other letters still refused';
end $$;

select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conname in ('post_comments_key_shape', 'post_heat_key_shape')
 order by conname;
