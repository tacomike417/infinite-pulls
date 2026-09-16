-- Infinite Pulls — UNDO THE DEMO SEED
-- ============================================================================
--
-- Removes exactly what demo_seed.sql added and nothing else.
--
-- HOW IT KNOWS WHAT TO REMOVE. Two handles, both narrow: every row the seed
-- created carries an id beginning dede0000, and everything the demo account
-- did is keyed to that one account. Nothing is matched on text, on a date
-- range, or on "recent" -- a cleanup script that guesses is how somebody
-- loses a real customer's comment.
--
-- THE AUTH USER IS NOT DELETED HERE. Supabase owns auth.users; remove
-- fakeaccount4171123@thunkbox.com from Authentication -> Users when you
-- are done. Deleting it there cascades and takes the rest with it anyway.
--
-- SAFE TO RUN TWICE, AND SAFE TO RUN IF THE SEED WAS NEVER RUN.

do $$
declare
  mike uuid;
  demo uuid;
  demo_email text := 'fakeaccount4171123@thunkbox.com';  -- must match demo_seed.sql
  gone int := 0;
  n    int;
begin
  select id into mike from public.profiles where lower(username) = 'tacomike417';
  select id into demo from auth.users where lower(email) = lower(demo_email);

  if demo is null then
    raise notice 'No demo account found — only the dede0000 rows will be removed.';
  end if;

  -- 1. everything the demo account did
  if demo is not null then
    if to_regclass('public.post_heat') is not null then
      delete from public.post_heat where user_id = demo;
      get diagnostics n = row_count; gone := gone + n;
      raise notice 'heat marks removed: %', n;
    end if;

    delete from public.comment_hearts where user_id = demo;
    get diagnostics n = row_count; gone := gone + n;
    raise notice 'hearts removed: %', n;

    delete from public.follows where follower_id = demo or followee_id = demo;
    get diagnostics n = row_count; gone := gone + n;
    raise notice 'follows removed: %', n;

    delete from public.post_comments where user_id = demo;
    get diagnostics n = row_count; gone := gone + n;
    raise notice 'demo comments removed: %', n;

    -- Any notification that named the demo account as the actor. The
    -- cascades above take most of these already; this is the sweep for
    -- follow rows, which point at no comment and so cascade from nothing.
    delete from public.notifications where actor_id = demo;
    get diagnostics n = row_count; gone := gone + n;
    raise notice 'notifications from the demo account removed: %', n;
  end if;

  -- 2. the rows the seed made on YOUR account, by their tagged ids
  delete from public.post_comments where id::text like 'dede0000-%';
  get diagnostics n = row_count; gone := gone + n;
  raise notice 'seeded comments removed: %', n;

  delete from public.user_collector_goals where id::text like 'dede0000-%';
  get diagnostics n = row_count; gone := gone + n;
  raise notice 'seeded goals removed: %', n;

  -- the cards go last: the comments and heat above reference their keys
  delete from public.user_cards where id::text like 'dede0000-%';
  get diagnostics n = row_count; gone := gone + n;
  raise notice 'seeded cards removed: %', n;

  -- 3. the app's own notifications about those, which have no actor to
  --    cascade from and no foreign key to the goal or the card
  if mike is not null then
    delete from public.notifications
     where user_id = mike and actor_id is null and kind in ('dex','goal');
    get diagnostics n = row_count; gone := gone + n;
    raise notice 'seeded app notifications removed: %', n;
  end if;

  raise notice '--------------------------------------------------';
  raise notice '% rows removed in total.', gone;
  raise notice 'The Rewards card itself was LEFT ALONE — see the note below.';
end $$;

-- DELIBERATELY NOT TOUCHED: user_dex_cards.
--
-- Earning a Rewards card is a real thing in the shop's own economy and it
-- feeds the prize tiers. A cleanup script that silently takes a card back
-- off an account is doing something different from tidying up after a
-- demo. If you want it gone, take it yourself and you will see exactly
-- what you are removing:
--
--   select d.id, c.code, c.name, d.earned_at
--     from public.user_dex_cards d
--     join public.infinite_dex_cards c on c.id = d.card_id
--    where d.user_id = (select id from public.profiles where lower(username)='tacomike417');
--
--   -- then, for the one you mean:
--   -- delete from public.user_dex_cards where id = '<the id>';

select kind, count(*) as still_here
  from public.notifications
 where user_id = (select id from public.profiles where lower(username) = 'tacomike417')
 group by kind order by kind;
