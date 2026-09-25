-- ===========================================================================
-- PART 1  card 37 "Well Received" counts BOTH buttons
-- PART 2  the three answers needed before card 35 can be fixed
--
-- Safe to run twice. Nothing is deleted.
--
-- PART 1 IS THE REAL reward_stats(), COPIED OUT OF infinite_rewards.sql WITH
-- ONE EXPRESSION CHANGED. Not retyped from memory -- this function decides
-- every card in the set, and one wrong column name in a rewrite would stop
-- all fifty of them. The diff against what is live is 23 lines, all of them
-- inside the hearts_received expression and its comment.
--
-- Same name, same arguments, same returns-table, so this REPLACES the
-- function rather than stacking an overload beside it. (An overload is what
-- broke the REWARDS tile two days ago; it only happens when the shape
-- changes, and nothing here changes shape.)
-- ===========================================================================

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
  cards_earned     integer
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
    (select coalesce(btrim(display_name), '') <> '' from public.profiles where id = p_user),  -- "grail_set" now means NAME ADDED (25 Sep 2026)
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
      where u.user_id = p_user and c.enabled and not c.secret)::int;
$$;

-- It names both buttons, because it now counts both.
update public.reward_cards set task_line = 'TEN HEATS AND HEARTS'
 where trigger_key = 'hearts_received_10';


-- ===========================================================================
-- PART 2 -- WHAT I NEED BEFORE FIXING "50 POKEMON DISCOVERED"
--
-- public.cards does NOT carry pokedex_numbers. staging_cards has the column
-- and the insert into public.cards deliberately left it out -- which is why
-- that card is blind and unearnable rather than merely unearned. The count
-- is worked out in components/pokedex.js and handed to the RETIRED Infinite
-- Dex system, so nothing it decides ever reaches reward_cards.
--
-- Giving the number to the database means adding the column and backfilling
-- it. These three answers decide how. Paste all three back.
-- ===========================================================================

-- 1. IS THE STAGING TABLE STILL LOADED? If rows_in_staging is 0 the import
--    data is gone and the backfill has to come from the source file.
select count(*) as rows_in_staging,
       count(*) filter (where coalesce(pokedex_numbers, '') <> '') as with_dex_numbers
  from public.staging_cards;

-- 2. WHAT SHAPE IS THE COLUMN? One number, a list, JSON, brackets? The
--    parser depends entirely on this.
select pokedex_numbers, count(*) as how_many
  from public.staging_cards
 where coalesce(pokedex_numbers, '') <> ''
 group by pokedex_numbers
 order by how_many desc
 limit 15;

-- 3. WOULD IT REACH REAL CARDS? For whoever owns the most cards: how many
--    of their rows find a matching row in the index to hang a dex number on.
--    A high no_index_row means the join is the problem, not the column.
select count(*)                                    as their_card_rows,
       count(*) filter (where c.tcgdex_id is null) as no_index_row,
       count(distinct u.card_id)                   as distinct_cards
  from public.user_cards u
  left join lateral (
    select tcgdex_id from public.cards
     where tcgdex_id = u.card_id limit 1
  ) c on true
 where u.user_id = (select user_id from public.user_cards
                     group by user_id order by count(*) desc limit 1);
