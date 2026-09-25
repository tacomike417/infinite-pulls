-- ===========================================================================
-- "50 POKEMON DISCOVERED" STOPS BEING UNEARNABLE
--
-- It was one of two BLIND cards: the database could not see the number, so
-- the sweep skipped it and the count was worked out in
-- components/pokedex.js and handed to the RETIRED Infinite Dex system --
-- award_dex_card(), writing into user_dex_cards, a table Infinite Rewards
-- does not read. Three dead ends in a row, so nobody could earn that card,
-- however many Pokemon they actually had.
--
-- Nothing needed inventing. user_cards.dex_id has been filled at add time
-- since card_language.sql shipped; nothing was ever reading it. 62 of 65
-- rows on the busiest account carry it, and they cover 50 distinct Pokemon
-- -- so this card is already earned the moment the sweep can see it.
--
-- WHAT CHANGES
--   reward_stats()          + dex_discovered, count(distinct dex_id)
--   reward_sweep()          pokedex_50 becomes an ordinary trigger
--   award_reward_card()     no longer accepts pokedex_50 on the app's word
--   reward_card_progress()  pokedex_50 gets a real bar instead of a padlock
--
-- WHY IT IS A DROP AND NOT A REPLACE. reward_stats() gains an output
-- column, which changes its return type -- and `create or replace` refuses
-- that. The drop and the create are wrapped in one transaction so the
-- function is never missing between them; if any statement fails the whole
-- thing rolls back and the database is exactly as it was.
--
-- THE REVOKE AT THE END IS NOT OPTIONAL. Dropping a function drops its
-- grants, and a newly created function is EXECUTE-able by PUBLIC by
-- default. Without re-revoking, this would quietly open the stats function
-- to anonymous callers.
--
-- This carries forward the Well Received change you already ran -- the
-- hearts_received expression here counts HEAT and hearts, exactly as it
-- does now. Running this does not undo that.
--
-- Safe to run twice. Nothing is deleted.
-- ===========================================================================

begin;

drop function if exists public.reward_stats(uuid);

create or replace function public.reward_stats(p_user uuid)
returns table (
  has_profile      boolean,
  card_qty         integer,
  distinct_sets    integer,
  graded_any       boolean,
  graded_ten       boolean,
  has_reverse      boolean,
  has_holo         boolean,
  wish_count       integer,
  wish_fulfilled   boolean,
  sealed_any       boolean,
  scan_count       integer,
  comment_count    integer,
  comment_people   integer,
  comment_weeks    integer,
  hearts_given     integer,
  hearts_received  integer,
  own_photos       integer,
  photo_posts      integer,
  card_weeks       integer,
  card_months      integer,
  member_days      integer,
  coll_value       numeric,
  value_up_2       boolean,
  avatar_set       boolean,
  bio_set          boolean,
  grail_set        boolean,
  founder          boolean,
  public_profile   boolean,
  alerts_on        boolean,
  goal_picked      boolean,
  goal_done        boolean,
  cards_earned     integer,
  -- HOW MANY DIFFERENT POKEMON YOUR CARDS REPRESENT.
  -- user_cards.dex_id has been filled at add time since card_language.sql;
  -- rows older than that column are null and are simply not counted. That
  -- is the honest behaviour -- better to undercount than to guess a species
  -- out of a card name that may not even be written in English.
  dex_discovered   integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.profiles where id = p_user),

    -- Copies, not rows. Somebody with ten of the same Pikachu has ten
    -- cards and would rightly argue the point.
    coalesce((select sum(quantity) from public.user_cards where user_id = p_user), 0)::int,
    (select count(distinct set_name) from public.user_cards
      where user_id = p_user and set_name is not null and btrim(set_name) <> '')::int,

    -- Grades live in user_cards.condition as free text: 'PSA 10',
    -- 'BGS 10 black label', 'CGC 10 pristine'. It is a string match because
    -- there is no grade column, and adding one is a bigger change than
    -- these two cards are worth.
    exists (select 1 from public.user_cards
             where user_id = p_user and condition ~* '^\s*(PSA|BGS|CGC)\s*\d'),
    exists (select 1 from public.user_cards
             where user_id = p_user and condition ~* '^\s*(PSA|BGS|CGC)\s*10(\y|$)'),

    -- Same story for variant: 'reverse holo', 'Reverse Holofoil',
    -- 'holofoil', 'unlimited holo', 'normal'. Reverse is checked first and
    -- excluded from plain holo, so one card cannot earn both.
    exists (select 1 from public.user_cards
             where user_id = p_user and lower(variant) like '%reverse%'),
    exists (select 1 from public.user_cards
             where user_id = p_user
               and lower(variant) like '%holo%'
               and lower(variant) not like '%reverse%'),

    (select count(*) from public.wishlist_cards where user_id = p_user)::int,
    -- A wish became yours: the same card_id sits on both lists. If somebody
    -- tidies the wish off after buying it, this never fires for them --
    -- accepted, because the alternative is writing down every deletion.
    exists (select 1 from public.wishlist_cards w
             join public.user_cards u
               on u.user_id = w.user_id and u.card_id = w.card_id
            where w.user_id = p_user),

    exists (select 1 from public.user_sealed where user_id = p_user),

    (select count(*) from public.card_scans where user_id = p_user)::int,

    -- Hidden comments do not count toward anything. A comment Jeff took
    -- down is not a contribution.
    (select count(*) from public.post_comments
      where user_id = p_user and hidden_at is null)::int,
    (select count(distinct post_owner) from public.post_comments
      where user_id = p_user and hidden_at is null and post_owner <> p_user)::int,
    (select count(distinct date_trunc('week', created_at)) from public.post_comments
      where user_id = p_user and hidden_at is null)::int,

    -- APPRECIATION YOU GAVE, BY EITHER BUTTON. HEAT and heart are two
    -- different things in this app -- HEAT is on a post, the heart is on a
    -- comment -- and this used to count only the second one. So a person who
    -- did the thing the app puts a big button on earned nothing for it, and
    -- 04/50 sat unearned behind a mechanic nobody was pointed at. Both count
    -- now, whichever one they reached for first.
    ((select count(*) from public.comment_hearts where user_id = p_user)
   + (select count(*) from public.post_heat      where user_id = p_user))::int,
    -- APPRECIATION YOU RECEIVED, BY EITHER BUTTON.
    -- This was comments-only, and the note that used to sit here argued the
    -- case well: "this one says on your comments and means it". The label
    -- was the thing that had to give. Ten hearts on your COMMENTS means ten
    -- people found ten of your comments worth a small button -- while HEAT,
    -- the big button this app actually puts in front of everybody, counted
    -- toward nothing you could receive. The card sat at 0/10 for people who
    -- were getting heat all day.
    -- Self-marks stay out, or "ten received" is ten taps on your own thumb.
    -- The shelf's posts carry no post_owner, so heat on those still credits
    -- nobody -- right answer: a shelf is not a person.
    ((select count(*) from public.comment_hearts h
        join public.post_comments c on c.id = h.comment_id
       where c.user_id = p_user and h.user_id <> p_user and c.hidden_at is null)
   + (select count(*) from public.post_heat
       where post_owner = p_user and user_id <> p_user))::int,

    -- Your own photograph of a card you own.
    (select count(*) from public.card_photos
      where user_id = p_user and kind = 'mine')::int,
    -- A "post" is a photo you chose to put up: a standalone photo, or your
    -- own picture attached to a card. Deliberately NOT every card added --
    -- that would make "100 posts" mean "100 cards" wearing a different hat.
    ((select count(*) from public.user_photos where user_id = p_user)
     + (select count(*) from public.card_photos where user_id = p_user and kind = 'mine'))::int,

    -- The calendar spine. This is the only thing in the whole set that
    -- cannot be rushed, and it is what makes the 10% off take a season.
    (select count(distinct date_trunc('week',  added_at)) from public.user_cards
      where user_id = p_user)::int,
    (select count(distinct date_trunc('month', added_at)) from public.user_cards
      where user_id = p_user)::int,

    (select greatest(0, floor(extract(epoch from (now() - created_at)) / 86400))::int
       from public.profiles where id = p_user),

    -- Priced here, in SQL, from card_price_history -- NOT from
    -- profiles.collection_value, which the browser writes and which its own
    -- comment calls not authoritative. Two cards turn into a discount.
    coalesce((
      select sum(u.quantity * p.price)
        from public.user_cards u
        join lateral (
          select h.price from public.card_price_history h
           where h.card_id = u.card_id
           order by (h.variant = 'market') desc, h.recorded_on desc
           limit 1
        ) p on true
       where u.user_id = p_user
    ), 0)::numeric,

    -- Value up two months running: three monthly high-water marks, each
    -- higher than the last. Needs collection_value_snapshots to actually be
    -- getting written by the snapshot-collection-value Edge Function.
    (select bool_and(rising) from (
       select v > lag(v) over (order by m) as rising
         from (select date_trunc('month', snapshot_date) as m, max(total_value) as v
                 from public.collection_value_snapshots
                where user_id = p_user
                  and snapshot_date >= (current_date - interval '3 months')
                group by 1 order by 1 desc limit 3) q
     ) r where rising is not null),

    (select avatar_url     is not null from public.profiles where id = p_user),
    (select btrim(coalesce(bio, '')) <> '' from public.profiles where id = p_user),
    (select grail_card_id  is not null from public.profiles where id = p_user),
    (select verified_at    is not null from public.profiles where id = p_user),
    -- is_public DEFAULTS TO TRUE, so the flag on its own would hand this to
    -- everybody at signup, which is the opposite of the point. It wants a
    -- page worth looking at, so it wants a face on it too.
    (select coalesce(is_public, false) and avatar_url is not null
       from public.profiles where id = p_user),
    (select coalesce(price_alerts_enabled, false) from public.profiles where id = p_user),

    exists (select 1 from public.user_collector_goals where user_id = p_user),
    exists (select 1 from public.user_collector_goals
             where user_id = p_user and completed_at is not null),

    (select count(*) from public.user_reward_cards u
       join public.reward_cards c on c.id = u.card_id
      where u.user_id = p_user and c.enabled and not c.secret)::int,

    -- Distinct species, not distinct cards. Six Charizards are one Pokemon.
    (select count(distinct dex_id) from public.user_cards
      where user_id = p_user and dex_id is not null)::int;
$$;

create or replace function public.reward_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_out  jsonb := '[]'::jsonb;
  v_got  integer;
  v_need integer;
begin
  if v_user is null then
    return v_out;
  end if;

  with s as (select * from public.reward_stats(v_user)),
  won as (
    insert into public.user_reward_cards (user_id, card_id)
    select v_user, c.id
      from public.reward_cards c cross join s
     where c.enabled
       and not c.secret
       and not exists (
             select 1 from public.user_reward_cards u
              where u.user_id = v_user and u.card_id = c.id)
       and case c.trigger_key
             when 'account_created'   then s.has_profile
             when 'card_1'            then s.card_qty >= 1
             when 'cards_10'          then s.card_qty >= 10
             when 'cards_25'          then s.card_qty >= 25
             when 'cards_50'          then s.card_qty >= 50
             when 'cards_100'         then s.card_qty >= 100
             when 'sets_5'            then s.distinct_sets >= 5
             when 'sets_10'           then s.distinct_sets >= 10
             when 'graded_any'        then s.graded_any
             when 'graded_ten'        then s.graded_ten
             when 'reverse_holo'      then s.has_reverse
             when 'holo'              then s.has_holo
             when 'wish_1'            then s.wish_count >= 1
             when 'wishes_5'          then s.wish_count >= 5
             when 'wish_fulfilled'    then s.wish_fulfilled
             when 'sealed_1'          then s.sealed_any
             when 'scan_1'            then s.scan_count >= 1
             when 'scans_10'          then s.scan_count >= 10
             when 'scans_25'          then s.scan_count >= 25
             when 'comment_1'         then s.comment_count >= 1
             when 'comments_10'       then s.comment_count >= 10
             when 'comments_25'       then s.comment_count >= 25
             when 'comment_people_10' then s.comment_people >= 10
             when 'comment_weeks_4'   then s.comment_weeks >= 4
             when 'heart_given_1'     then s.hearts_given >= 1
             when 'hearts_given_10'   then s.hearts_given >= 10
             when 'hearts_received_10'then s.hearts_received >= 10
             when 'own_photo_1'       then s.own_photos >= 1
             when 'own_photos_5'      then s.own_photos >= 5
             when 'posts_5'           then s.photo_posts >= 5
             when 'posts_15'          then s.photo_posts >= 15
             when 'posts_100'         then s.photo_posts >= 100
             when 'card_weeks_4'      then s.card_weeks >= 4
             when 'card_weeks_8'      then s.card_weeks >= 8
             when 'card_months_3'     then s.card_months >= 3
             when 'member_30'         then s.member_days >= 30
             when 'member_90'         then s.member_days >= 90
             when 'value_100'         then s.coll_value >= 100
             when 'value_1000'        then s.coll_value >= 1000
             when 'value_up_2'        then coalesce(s.value_up_2, false)
             when 'avatar_set'        then s.avatar_set
             when 'bio_set'           then s.bio_set
             when 'grail_set'         then s.grail_set
             when 'founder_badge'     then s.founder
             when 'collection_public' then s.public_profile
             when 'alerts_on'         then s.alerts_on
             when 'goal_picked'       then s.goal_picked
             when 'goal_done'         then s.goal_done
             -- POKEDEX_50 IS NO LONGER BLIND. It used to sit here with
             -- app_installed because the database could not see it -- the
             -- count was worked out in components/pokedex.js and handed to
             -- the RETIRED Infinite Dex system, so it reached nothing and
             -- the card could never be earned by anybody, however many
             -- cards they added. user_cards.dex_id was already being filled
             -- at add time; nothing was reading it.
             when 'pokedex_50'        then s.dex_discovered >= 50
             -- app_installed is still not visible from here. It is the only
             -- one left, and award_reward_card() is where it comes in.
             -- An unknown key is a typo, not a card anybody earned.
             else false
           end
    on conflict (user_id, card_id) do nothing
    returning card_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'card_id',   c.id,
           'code',      c.code,
           'number',    c.card_number,
           'name',      c.name,
           'task_line', c.task_line,
           'creature',  d.name,
           'dex',       d.dex_number,
           'form',      c.form_name,
           'rarity',    c.rarity,
           'art_url',   c.art_url,
           'thumb_url', c.thumb_url
         ) order by c.card_number), '[]'::jsonb)
    into v_out
    from won
    join public.reward_cards  c on c.id = won.card_id
    join public.dex_creatures d on d.id = c.creature_id;

  -- The secret card is checked AFTER, in its own statement. An INSERT..SELECT
  -- sees one snapshot, so a sweep that awards card 50 cannot also see that
  -- 51 just became reachable -- and making somebody wait for the next page
  -- load is the wrong moment for the biggest card in the set.
  select count(*) into v_got
    from public.user_reward_cards u
    join public.reward_cards c on c.id = u.card_id
   where u.user_id = v_user and c.enabled and not c.secret;

  select count(*) into v_need
    from public.reward_cards where enabled and not secret;

  if v_got >= v_need and v_need > 0 then
    with won2 as (
      insert into public.user_reward_cards (user_id, card_id)
      select v_user, c.id
        from public.reward_cards c
       where c.enabled and c.secret
         and not exists (select 1 from public.user_reward_cards u
                          where u.user_id = v_user and u.card_id = c.id)
      on conflict (user_id, card_id) do nothing
      returning card_id
    )
    select v_out || coalesce(jsonb_agg(jsonb_build_object(
             'card_id',   c.id,
             'code',      c.code,
             'number',    c.card_number,
             'name',      c.name,
             'task_line', c.task_line,
             'creature',  d.name,
             'dex',       d.dex_number,
             'form',      c.form_name,
             'rarity',    c.rarity,
             'art_url',   c.art_url,
             'thumb_url', c.thumb_url,
             'secret',    true
           )), '[]'::jsonb)
      into v_out
      from won2
      join public.reward_cards  c on c.id = won2.card_id
      join public.dex_creatures d on d.id = c.creature_id;
  end if;

  return v_out;
end;
$$;

create or replace function public.award_reward_card(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_card public.reward_cards%rowtype;
  v_dex  public.dex_creatures%rowtype;
begin
  if v_user is null then
    return jsonb_build_object('status', 'unknown');
  end if;

  select * into v_card from public.reward_cards
   where code = p_code and enabled
     -- ONLY app_installed NOW. pokedex_50 became an ordinary swept card the
     -- moment the database could count it, and leaving it assertable would
     -- mean the app could still hand it over on its own word -- a hole with
     -- nothing on the other side of it worth keeping.
     and trigger_key = 'app_installed';

  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;

  select * into v_dex from public.dex_creatures where id = v_card.creature_id;

  insert into public.user_reward_cards (user_id, card_id)
  values (v_user, v_card.id)
  on conflict (user_id, card_id) do nothing;

  if not found then
    return jsonb_build_object('status', 'already', 'code', v_card.code);
  end if;

  return jsonb_build_object(
    'status', 'awarded', 'card_id', v_card.id, 'code', v_card.code,
    'number', v_card.card_number, 'name', v_card.name,
    'task_line', v_card.task_line, 'creature', v_dex.name,
    'dex', v_dex.dex_number, 'form', v_card.form_name,
    'rarity', v_card.rarity, 'art_url', v_card.art_url,
    'thumb_url', v_card.thumb_url
  );
end;
$$;

-- Dropping the function dropped its grants. Put them back exactly as
-- infinite_rewards.sql sets them: the stats function is the check, not the
-- door, and nothing outside these two functions may call it.
revoke all on function public.reward_stats(uuid) from public, anon, authenticated;

commit;


-- ===========================================================================
-- THE PROGRESS BAR. Its own file's drop/create, run after the commit above
-- so it is reading the new reward_stats().
-- ===========================================================================

-- ===========================================================================
-- FIX FIRST: remove the colliding overload this file created on its first run
--
-- infinite_rewards.sql already owns public.reward_progress() -> jsonb: the
-- page summary behind the REWARDS tile (cards_earned, dex_found, totals).
-- The first version of this file used the same name with a uuid argument,
-- which Postgres kept as a SECOND function rather than replacing anything.
-- A no-argument call then matched both and failed 42725 "not unique".
--
-- The per-card function is renamed reward_card_progress. The drop below
-- names the uuid signature explicitly, so it can only remove the one this
-- file created. The jsonb one is not touched and keeps working.
-- ===========================================================================
drop function if exists public.reward_progress(uuid);

-- ===========================================================================
-- HOW CLOSE AM I TO THAT CARD
--
-- Jeff wants a progress bar on the reward cards. This is the number behind
-- it. Nothing new is stored and nothing new is written: reward_stats()
-- already returns every figure the triggers compare against, so progress is
-- the same comparison read as a fraction instead of a yes.
--
-- ONE QUERY FOR THE WHOLE SET, not one per card. dex_sweep() was built the
-- other way -- a query per unearned card on every route change -- and it is
-- already noted as something that will not survive 50 cards. This does the
-- whole board in a single pass so the bars cost one round trip.
--
-- THREE KINDS OF CARD, and only one of them gets a bar:
--
--   count   32 cards. 'cards_25' is card_qty >= 25, so 12/25 is real and a
--           bar means something.
--
--   yesno   16 cards. Set an avatar. Write a bio. Own one holo. There is no
--           halfway -- a bar on these would sit at 0% while the person is
--           one tap from done, which reads as further away than it is.
--           Returned with need = 1 and have = 0 or 1 so the UI can show a
--           tick rather than a bar. DO NOT draw these as bars.
--
--   blind    1 card. app_installed is not visible from
--           the database at all. have is null -- not zero. Zero would be a
--           claim we cannot support, and the arrows already refuse to call
--           a card steady without a reading; same rule here.
--
-- Safe to run twice. Reads only -- no inserts, no updates, no deletes.
-- ===========================================================================

create or replace function public.reward_card_progress(p_user uuid default null)
returns table (
  card_id     uuid,
  code        text,
  card_number integer,
  name        text,
  task_line   text,
  trigger_key text,
  kind        text,      -- 'count' | 'yesno' | 'blind'
  have        numeric,   -- null when kind = 'blind'
  need        numeric,
  pct         integer,   -- 0..100, null when blind
  earned      boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with v_user as (
    select coalesce(p_user, auth.uid()) as id
  ),
  s as (
    select * from public.reward_stats((select id from v_user))
  ),
  mine as (
    select card_id from public.user_reward_cards
     where user_id = (select id from v_user)
  ),
  raw as (
    select
      c.id, c.code, c.card_number, c.name, c.task_line, c.trigger_key,
      case c.trigger_key
        when 'card_1'             then s.card_qty
        when 'cards_10'           then s.card_qty
        when 'cards_25'           then s.card_qty
        when 'cards_50'           then s.card_qty
        when 'cards_100'          then s.card_qty
        when 'sets_5'             then s.distinct_sets
        when 'sets_10'            then s.distinct_sets
        when 'wish_1'             then s.wish_count
        when 'wishes_5'           then s.wish_count
        when 'scan_1'             then s.scan_count
        when 'scans_10'           then s.scan_count
        when 'scans_25'           then s.scan_count
        when 'comment_1'          then s.comment_count
        when 'comments_10'        then s.comment_count
        when 'comments_25'        then s.comment_count
        when 'comment_people_10'  then s.comment_people
        when 'comment_weeks_4'    then s.comment_weeks
        when 'heart_given_1'      then s.hearts_given
        when 'hearts_given_10'    then s.hearts_given
        when 'hearts_received_10' then s.hearts_received
        when 'own_photo_1'        then s.own_photos
        when 'own_photos_5'       then s.own_photos
        when 'posts_5'            then s.photo_posts
        when 'posts_15'           then s.photo_posts
        when 'posts_100'          then s.photo_posts
        when 'card_weeks_4'       then s.card_weeks
        when 'card_weeks_8'       then s.card_weeks
        when 'card_months_3'      then s.card_months
        when 'member_30'          then s.member_days
        when 'member_90'          then s.member_days
        when 'value_100'          then s.coll_value
        when 'value_1000'         then s.coll_value
        -- No longer blind: reward_stats() counts it now. 43/50 is a far
        -- better thing to show somebody than a padlock.
        when 'pokedex_50'         then s.dex_discovered
        else null
      end::numeric as have_count,
      case c.trigger_key
        when 'card_1' then 1 when 'cards_10' then 10 when 'cards_25' then 25
        when 'cards_50' then 50 when 'cards_100' then 100
        when 'sets_5' then 5 when 'sets_10' then 10
        when 'wish_1' then 1 when 'wishes_5' then 5
        when 'scan_1' then 1 when 'scans_10' then 10 when 'scans_25' then 25
        when 'comment_1' then 1 when 'comments_10' then 10 when 'comments_25' then 25
        when 'comment_people_10' then 10 when 'comment_weeks_4' then 4
        when 'heart_given_1' then 1 when 'hearts_given_10' then 10
        when 'hearts_received_10' then 10
        when 'pokedex_50' then 50
        when 'own_photo_1' then 1 when 'own_photos_5' then 5
        when 'posts_5' then 5 when 'posts_15' then 15 when 'posts_100' then 100
        when 'card_weeks_4' then 4 when 'card_weeks_8' then 8
        when 'card_months_3' then 3
        when 'member_30' then 30 when 'member_90' then 90
        when 'value_100' then 100 when 'value_1000' then 1000
        else null
      end::numeric as need_count,
      -- the sixteen that are simply done or not
      case c.trigger_key
        when 'account_created'   then s.has_profile
        when 'graded_any'        then s.graded_any
        when 'graded_ten'        then s.graded_ten
        when 'reverse_holo'      then s.has_reverse
        when 'holo'              then s.has_holo
        when 'wish_fulfilled'    then s.wish_fulfilled
        when 'sealed_1'          then s.sealed_any
        when 'value_up_2'        then coalesce(s.value_up_2, false)
        when 'avatar_set'        then s.avatar_set
        when 'bio_set'           then s.bio_set
        when 'grail_set'         then s.grail_set
        when 'founder_badge'     then s.founder
        when 'collection_public' then s.public_profile
        when 'alerts_on'         then s.alerts_on
        when 'goal_picked'       then s.goal_picked
        when 'goal_done'         then s.goal_done
        else null
      end as yes_no,
      (m.card_id is not null) as is_mine
    from public.reward_cards c
    cross join s
    left join mine m on m.card_id = c.id
    where c.enabled and not c.secret
  )
  select
    r.id, r.code, r.card_number, r.name, r.task_line, r.trigger_key,
    case
      when r.need_count is not null then 'count'
      when r.yes_no is not null     then 'yesno'
      else 'blind'
    end as kind,
    case
      when r.need_count is not null then least(r.have_count, r.need_count)
      when r.yes_no is not null     then (case when r.yes_no then 1 else 0 end)::numeric
      else null
    end as have,
    coalesce(r.need_count, 1) as need,
    case
      when r.need_count is not null then
        least(100, greatest(0, floor(100 * r.have_count / nullif(r.need_count,0))))::int
      when r.yes_no is not null then (case when r.yes_no then 100 else 0 end)
      else null
    end as pct,
    r.is_mine
  from raw r
  order by r.card_number;
$$;

revoke all on function public.reward_card_progress(uuid) from public;
grant execute on function public.reward_card_progress(uuid) to authenticated;

comment on function public.reward_card_progress(uuid) is
  'One row per reward card with how close this person is. kind=count gets a '
  'real bar; kind=yesno is done-or-not and must NOT be drawn as a bar; '
  'kind=blind cannot be measured and returns have = null, never 0.';

-- ===========================================================================
-- WHAT IT LOOKS LIKE — run this after, it changes nothing
-- ===========================================================================
select kind, count(*) as cards
  from public.reward_card_progress()
 group by kind order by kind;

-- Your own board, closest-to-done first among the ones with a real bar.
select card_number, name, task_line, have, need, pct, earned
  from public.reward_card_progress()
 where kind = 'count' and not earned
 order by pct desc
 limit 12;


-- ===========================================================================
-- WHAT A CORRECT RESULT LOOKS LIKE
--
-- 1. ONE row per function name. Two means an overload stacked and calls
--    will fail with 42725.
-- 2. Your dex_discovered, straight out of the stats function. It should
--    read 50.
-- 3. The card's own progress row: kind must now be 'count', not 'blind',
--    and have/need should read 50 / 50 with earned = true once the sheet
--    has been opened and the sweep has run.
-- ===========================================================================

select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('reward_stats','reward_sweep','award_reward_card',
                     'reward_card_progress','reward_progress')
 order by p.proname, args;

select dex_discovered, cards_earned, hearts_received
  from public.reward_stats(
    (select user_id from public.user_cards
      group by user_id order by count(*) desc limit 1));

select code, name, task_line, kind, have, need, pct, earned
  from public.reward_card_progress()
 where code = 'S26-35';
