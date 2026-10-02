-- Infinite Pulls — HEAT COUNTS TOO
-- ============================================================================
--
-- HEAT and heart are two different things in this app, and only one of them
-- was paying a card.
--
--   HEAT  is the button on a POST      -> public.post_heat
--   heart is the little one on a COMMENT -> public.comment_hearts
--
-- All three "heart" cards read comment_hearts, so somebody who tapped the
-- big HEAT button -- the one the feed actually puts in front of them --
-- earned nothing at all, and 04/50 sat behind a mechanic nobody was pointed
-- at. The welcome panel on the feed now tells new members to heat a post, so
-- it had better be true.
--
-- WHAT CHANGES. One expression inside reward_stats: `hearts_given` becomes
-- appreciation you gave by EITHER button. Cards 04 and 23 follow from it and
-- are reworded to match.
--
-- WHAT DOES NOT. Card 37 is "ten hearts on YOUR COMMENTS" and stays comment
-- hearts only -- heat arrives on a post, which is a different sentence.
-- Nobody loses a card they already hold: this only ever counts higher.
--
-- Run AFTER infinite_rewards.sql. SAFE TO RUN TWICE.
-- ============================================================================

do $guard$
begin
  if to_regclass('public.post_heat') is null then
    raise exception 'Run post_heat.sql first — this counts its rows.';
  end if;
end $guard$;

-- ---------------------------------------------------------------------------
-- THE STATS, with one line different. Same 32 columns in the same order, so
-- reward_sweep() needs no change at all and is deliberately not touched.
-- ---------------------------------------------------------------------------
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
    -- Hearts on YOUR comments, from other people. Self-hearts excluded, or
    -- "ten hearts received" is ten taps on your own thumb.
    -- STILL COMMENTS ONLY, on purpose: this one says "on your comments" and
    -- means it. Heat arrives on a post, which is a different sentence.
    (select count(*) from public.comment_hearts h
       join public.post_comments c on c.id = h.comment_id
      where c.user_id = p_user and h.user_id <> p_user and c.hidden_at is null)::int,

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
      where u.user_id = p_user and c.enabled and not c.secret)::int;
$$;

-- ---------------------------------------------------------------------------
-- THE TWO CARDS SAY WHAT THEY NOW MEAN
-- ---------------------------------------------------------------------------
update public.reward_cards set task_line = 'FIRST POST HEATED UP'
 where code = 'S26-04' and task_line <> 'FIRST POST HEATED UP';

update public.reward_cards set task_line = 'TEN POSTS HEATED UP'
 where code = 'S26-23' and task_line <> 'TEN POSTS HEATED UP';

-- CHECK: the two cards read right, and the stat counts both buttons.
select code, card_number, name, task_line
  from public.reward_cards
 where code in ('S26-04', 'S26-23', 'S26-37')
 order by card_number;
