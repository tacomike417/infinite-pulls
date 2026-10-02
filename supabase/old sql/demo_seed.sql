-- Infinite Pulls — DEMO SEED (throwaway)
-- ============================================================================
--
-- Fills tacomike417's account with the things that cause notifications, so
-- the bell can be looked at with real rows behind it.
--
-- IT SEEDS THE CAUSES, NOT THE NOTIFICATIONS. Nothing here writes a
-- notification row directly -- it adds a card, a comment, a heart, a follow,
-- a Rewards card, a finished goal, and lets the triggers do what they do in
-- production. If the bell fills up afterwards, the whole chain is proved. If
-- it does not, something is genuinely wrong and worth knowing now.
--
-- BEFORE YOU RUN IT
--
--   Supabase -> Authentication -> Users -> Add user
--     email:    fakeaccount4171123@thunkbox.com
--     password: anything
--     [x] Auto Confirm User
--
-- THE EMAIL IS WRITTEN IN ONE PLACE, the demo_email line below. Change it
-- there and in demo_undo.sql together, or the cleanup will not find what
-- the seed made.
--
-- Everything created here uses ids starting dede0000, so demo_undo.sql can
-- take out exactly what this put in and nothing else.
--
-- SAFE TO RUN TWICE.

do $$
declare
  mike  uuid;
  demo  uuid;
  card1 uuid := 'dede0000-0000-0000-0000-000000000001';
  card2 uuid := 'dede0000-0000-0000-0000-000000000002';
  cmt1  uuid := 'dede0000-0000-0000-0000-00000000000a';
  cmt2  uuid := 'dede0000-0000-0000-0000-00000000000b';
  goal1 uuid := 'dede0000-0000-0000-0000-0000000000c1';
  demo_email text := 'fakeaccount4171123@thunkbox.com';
  dexid uuid;
  tmpl  uuid;
  n     int;
begin
  -- ---- who ---------------------------------------------------------------
  select id into mike from public.profiles where lower(username) = 'tacomike417';
  if mike is null then
    raise exception 'No profile called tacomike417 — check the username and try again.';
  end if;

  select id into demo from auth.users where lower(email) = lower(demo_email);
  if demo is null then
    raise exception 'No account called % — make it first: Authentication -> Users -> Add user, Auto Confirm.', demo_email;
  end if;
  if demo = mike then
    raise exception 'The demo account and tacomike417 are the same account. Nothing would be notified, because nobody is told about their own doing.';
  end if;

  -- The demo account needs a profile or it shows as "A collector" with no
  -- face. insert ... on conflict so a second run just leaves it alone.
  insert into public.profiles (id, username)
       values (demo, 'demo_collector')
  on conflict (id) do nothing;

  raise notice 'tacomike417 = %, demo = %', mike, demo;

  -- ---- two cards of yours, so there is something to react to -------------
  insert into public.user_cards (id, user_id, card_id, card_name, set_name, variant, condition, quantity)
  values (card1, mike, 'base1-4',  'Charizard', 'Base Set', 'Holofoil',  'Near Mint', 1),
         (card2, mike, 'base1-58', 'Pikachu',   'Base Set', 'Normal',    'Near Mint', 1)
  on conflict (id) do nothing;

  -- ---- the demo account reacts -------------------------------------------
  -- Nothing in these bodies looks like a phone number or an email, because
  -- post_comments refuses those outright via comment_has_contact().
  insert into public.post_comments (id, post_key, post_owner, user_id, body)
  values (cmt1, 'c-' || card1, mike, demo, 'That is a clean copy. What did you pull it out of?'),
         (cmt2, 'c-' || card2, mike, demo, 'Been hunting this one for months.')
  on conflict (id) do nothing;

  -- a heart on a comment of YOURS, which needs one to exist first
  insert into public.post_comments (id, post_key, post_owner, user_id, body)
  values ('dede0000-0000-0000-0000-00000000000c', 'c-' || card1, mike, mike,
          'Pulled it at the shop on a Saturday.')
  on conflict (id) do nothing;

  insert into public.comment_hearts (comment_id, user_id)
  values ('dede0000-0000-0000-0000-00000000000c', demo)
  on conflict do nothing;

  insert into public.follows (follower_id, followee_id, following)
  values (demo, mike, true)
  on conflict (follower_id, followee_id) do update set following = true;

  -- heat, if post_heat.sql has been run
  if to_regclass('public.post_heat') is not null then
    insert into public.post_heat (post_key, user_id, post_owner)
    values ('c-' || card1, demo, mike),
           ('c-' || card2, demo, mike)
    on conflict do nothing;
  end if;

  -- ---- the app's own two --------------------------------------------------
  -- A Rewards card, if the season has any enabled.
  select id into dexid from public.infinite_dex_cards
   where coalesce(enabled, true) order by number nulls last limit 1;
  if dexid is not null then
    insert into public.user_dex_cards (user_id, card_id)
    values (mike, dexid)
    on conflict (user_id, card_id) do nothing;
  else
    raise notice 'No Infinite Rewards cards are enabled — skipping that one.';
  end if;

  -- A goal, added and then finished, so the trigger sees the transition
  -- rather than a row that arrived already complete.
  select id into tmpl from public.collector_goal_templates order by name limit 1;
  if tmpl is not null then
    insert into public.user_collector_goals (id, user_id, template_id)
    values (goal1, mike, tmpl)
    on conflict (id) do nothing;
    update public.user_collector_goals
       set completed_at = now()
     where id = goal1 and completed_at is null;
  else
    raise notice 'No collector goal templates — skipping that one.';
  end if;

  -- ---- what landed --------------------------------------------------------
  select count(*) into n from public.notifications where user_id = mike and read_at is null;
  raise notice '--------------------------------------------------';
  raise notice 'tacomike417 now has % unread notifications.', n;
  raise notice 'Open the feed, look at the bottom right of the bar.';
  raise notice 'Undo it all with demo_undo.sql.';
end $$;

-- What you should see, one row per kind.
select kind, count(*) as n
  from public.notifications
 where user_id = (select id from public.profiles where lower(username) = 'tacomike417')
 group by kind
 order by kind;
