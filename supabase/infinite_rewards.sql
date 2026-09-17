-- ===========================================================================
-- INFINITE DEX + INFINITE REWARDS — the rebuild.
-- 16 September 2026. Run once in the Supabase SQL Editor. Safe to re-run.
--
-- WHAT CHANGED, AND WHY THIS IS A NEW FILE RATHER THAN A PATCH
--
-- The old infinite_dex.sql held one table that was trying to be two things
-- at once: a creature and a card. It also carried a whole half built around
-- Jeff running the thing from behind his counter -- claim codes written on a
-- board, event cards, active windows, an admin card creator. He is out of
-- that entirely now, so all of it goes.
--
-- What is left is two collections that happen to share art:
--
--   INFINITE DEX      25 original creatures, #001 to #025. You discover a
--                     creature by earning any card it appears on. Nothing
--                     is stored -- discovery is derived from the cards you
--                     hold, so it can never disagree with them.
--
--   INFINITE REWARDS  51 cards. 01/50 through 50/50, plus the secret 51/50.
--                     Each card names one creature and one form of it.
--                     Cards 01-25 are base forms, 26-50 are second forms,
--                     51/50 is a third form of #001 and is the whole point.
--
-- Every card is earned by something the app can see for itself. There are no
-- codes, no windows, and nothing for anybody to remember.
--
-- REQUIRES: schema.sql, sealed_product.sql, card_photos.sql, card_scans.sql,
--           comments.sql, user_photos.sql, founder_badge.sql,
--           collection_value_on_profile.sql, card_price_history.sql.
--
-- The old infinite_dex_cards / user_dex_cards / dex_reward_tiers tables are
-- deliberately NOT dropped here. Nothing in this file reads them. Drop them
-- in a separate migration once the app has been off them for a while.
-- ===========================================================================


-- ===========================================================================
-- 1. THE CREATURES — the Infinite Dex itself.
-- ===========================================================================
create table if not exists public.dex_creatures (
  id uuid primary key default gen_random_uuid(),

  -- The #001 printed on the card's identity plaque. The handle everything
  -- refers to, and stable across seasons: Glimbit is #001 forever.
  dex_number smallint not null unique check (dex_number between 1 and 999),

  name    text not null unique,     -- Glimbit
  concept text,                     -- Coral-and-cream fox/red-panda mascot

  -- The Dex portrait. Usually just the base-form card's art, cropped --
  -- there is no separate creature illustration to commission.
  art_url   text,
  thumb_url text,

  enabled boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dex_creatures enable row level security;

-- The Dex is the pitch. A signed-out visitor sees all 25, locked, because
-- "here is what you could be collecting" only works if they can see it.
drop policy if exists "public read creatures" on public.dex_creatures;
create policy "public read creatures"
  on public.dex_creatures for select
  to anon, authenticated
  using (true);


-- ===========================================================================
-- 2. THE CARDS — Infinite Rewards.
--
--    No award_type, no claim_code, no active_from/active_until. Every card
--    is automatic. That is four columns and an entire class of bug removed
--    by Jeff stepping out, and it is worth saying out loud rather than
--    quietly leaving them nullable.
-- ===========================================================================
create table if not exists public.reward_cards (
  id uuid primary key default gen_random_uuid(),

  -- S26-01 .. S26-50, S26-51. Stable, readable, and what the app awards by.
  code   text not null unique,
  season text not null default 'S26',

  -- The "01" of "01/50". 51 is the secret card and is excluded from the
  -- denominator by the `secret` flag below, not by its number -- so a set
  -- with two secrets later on does not need this rewritten.
  card_number smallint not null check (card_number > 0),
  secret      boolean  not null default false,

  name      text not null,    -- First Light
  task_line text not null,    -- YOUR OWN PHOTO OF A CARD
  flavor    text,

  -- Which creature, and which of its forms. form_name is null for a base
  -- form; 'Steadfast Form' and 'Infinite Gold Form' are the others.
  creature_id uuid not null references public.dex_creatures(id) on delete restrict,
  form_name   text,

  rarity text not null default 'holo' check (rarity in ('holo', 'gold', 'secret')),

  -- Full art is 1060x1484 and around 3 MB. Fifty-one of those is 170 MB, so
  -- the grid must never load art_url. thumb_url is not an optimization here,
  -- it is the only way the page works on shop wifi.
  art_url   text,
  thumb_url text,

  -- One of the keys in reward_trigger_met(). Not a free-text field: an
  -- unknown key earns nothing, on purpose.
  trigger_key text not null check (length(trim(trigger_key)) > 0),

  enabled boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint reward_cards_season_number unique (season, card_number)
);

create index if not exists reward_cards_creature_idx on public.reward_cards(creature_id);

alter table public.reward_cards enable row level security;

drop policy if exists "public read reward cards" on public.reward_cards;
create policy "public read reward cards"
  on public.reward_cards for select
  to anon, authenticated
  using (true);


-- ===========================================================================
-- 3. WHO HAS WHAT.
--
--    No insert, update or delete policy, deliberately. Every write goes
--    through the security-definer functions below, which check the
--    condition first. If the browser could write here, anybody could hand
--    themselves 51/50 from the console, and 51/50 is worth a discount.
-- ===========================================================================
create table if not exists public.user_reward_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.reward_cards(id) on delete cascade,
  earned_at timestamptz not null default now(),
  unique (user_id, card_id)
);

create index if not exists user_reward_cards_user_idx on public.user_reward_cards(user_id);

alter table public.user_reward_cards enable row level security;

drop policy if exists "users read their own cards" on public.user_reward_cards;
create policy "users read their own cards"
  on public.user_reward_cards for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "public reads cards of public profiles" on public.user_reward_cards;
create policy "public reads cards of public profiles"
  on public.user_reward_cards for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = user_reward_cards.user_id and p.is_public = true
    )
  );


-- ===========================================================================
-- 4. updated_at, on both catalogue tables.
-- ===========================================================================
create or replace function public.set_reward_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists dex_creatures_updated_at on public.dex_creatures;
create trigger dex_creatures_updated_at before update on public.dex_creatures
  for each row execute function public.set_reward_updated_at();

drop trigger if exists reward_cards_updated_at on public.reward_cards;
create trigger reward_cards_updated_at before update on public.reward_cards
  for each row execute function public.set_reward_updated_at();


-- ===========================================================================
-- 5. THE STATS — everything the fifty-one conditions need, worked out once.
--
--    WHY THIS EXISTS AT ALL
--
--    The old dex_sweep() looped over every unearned card and ran a separate
--    query per card, on page load and on every route change. At twelve cards
--    that was invisible. At fifty-one, a brand-new account fires fifty-one
--    subqueries every time somebody taps anything, on shop wifi.
--
--    This is one query. It is also where the sharing happens: cards_10,
--    cards_25, cards_50 and cards_100 are four cards reading ONE count, and
--    the seven calendar cards read two.
--
--    SECURITY DEFINER because it reads other people's rows (comment_hearts
--    on your comments), and it takes p_user rather than reading auth.uid()
--    so that it stays testable. It is revoked from everybody at the bottom
--    of this file -- only the two functions below may call it.
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


-- ===========================================================================
-- 6. THE SWEEP — one query, not fifty-one.
--    Returns only what changed, so the usual answer is an empty array.
--    Two blind triggers (app_installed, pokedex_50) are never awarded here;
--    only the app can assert those, through award_reward_card() below.
-- ===========================================================================
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
             -- app_installed and pokedex_50 are not visible from here.
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


-- ===========================================================================
-- 7. THE TWO BLIND ONES — app_installed and pokedex_50.
--    The browser knows; nothing is written down anywhere. Taken on the
--    app's word, on purpose, and kept as a visibly separate code path from
--    "the database decided".
-- ===========================================================================
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
     and trigger_key in ('app_installed', 'pokedex_50');

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


-- ===========================================================================
-- 8. PROGRESS — one call for the whole page. Cards on top, creatures below.
--    A creature is discovered if you hold ANY card it appears on, so the
--    Dex can never disagree with the cards.
-- ===========================================================================
create or replace function public.reward_progress()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'cards_earned', (
      select count(*) from public.user_reward_cards u
        join public.reward_cards c on c.id = u.card_id
       where u.user_id = auth.uid() and c.enabled and not c.secret),
    'cards_total', (
      select count(*) from public.reward_cards where enabled and not secret),
    'has_secret', exists (
      select 1 from public.user_reward_cards u
        join public.reward_cards c on c.id = u.card_id
       where u.user_id = auth.uid() and c.secret),
    'dex_found', (
      select count(distinct c.creature_id) from public.user_reward_cards u
        join public.reward_cards c on c.id = u.card_id
       where u.user_id = auth.uid() and c.enabled),
    'dex_total', (
      select count(*) from public.dex_creatures where enabled)
  );
$$;


-- The stats function is the check, not the door.
revoke all on function public.reward_stats(uuid) from public, anon, authenticated;
grant execute on function public.reward_sweep()            to authenticated;
grant execute on function public.award_reward_card(text)   to authenticated;
grant execute on function public.reward_progress()         to authenticated, anon;


-- ===========================================================================
-- 9. THE SEED — 25 creatures, then 51 cards.
--    Art is uploaded separately; art_url/thumb_url fill in then.
--    "on conflict do nothing" so a re-run never overwrites an edit.
-- ===========================================================================
insert into public.dex_creatures (dex_number, name, concept) values
  (1, 'Glimbit', 'Coral-and-cream fox/red-panda mascot'),
  (2, 'Voxwing', 'Cobalt electric eagle with sound-lightning rings'),
  (3, 'Prismadon', 'Emerald dinosaur with living magenta crystal armor'),
  (4, 'Heartail', 'Pink river otter with a heart-shaped tail of light'),
  (5, 'Snapsnout', 'Lime scanner crocodile with orange goggles'),
  (6, 'Vaultusk', 'Indigo armored elephant guarding a card vault'),
  (7, 'Mimikin', 'Lavender identity-shifting creature with a luminous mask'),
  (8, 'Wishwhisk', 'Midnight constellation cat'),
  (9, 'Heraldillo', 'Copper messenger armadillo with a signal ribbon'),
  (10, 'Nimblip', 'Tiny blue beginner adventurer stepping through a portal'),
  (11, 'Grailfang', 'Treasure-hunting wolf with a golden tooth'),
  (12, 'Portoad', 'Cosmic frog that opens glowing doorways'),
  (13, 'Buzzlet', 'Fuzzy alert-bat with enormous radar ears'),
  (14, 'Talequill', 'Porcupine whose quills write glowing stories'),
  (15, 'Sealonix', 'Ancient stone seal guarding unopened treasures'),
  (16, 'Wishquill', 'Little bird that collects wishes in its feathers'),
  (17, 'Tenfold', 'Ten-horned baby titan that grows with collections'),
  (18, 'Hoardillo', 'Cheerful armadillo with a vault-like shell'),
  (19, 'Scopeye', 'Falcon-lizard that never misses a hidden detail'),
  (20, 'Mirrormane', 'Silver lion whose mane reflects rainbow light'),
  (21, 'Quartzilla', 'Chunky young monster empowered by every 25 finds'),
  (22, 'Holowl', 'Holographic owl that shimmers between colors'),
  (23, 'Kindclaw', 'Generous golden bear that shares its energy'),
  (24, 'Mapaconda', 'Explorer serpent with living maps across its scales'),
  (25, 'Flashbuck', 'Camera-loving deer whose antlers fire brilliant flashes')
on conflict (dex_number) do nothing;


insert into public.reward_cards
  (code, season, card_number, secret, name, task_line, creature_id, form_name, rarity, trigger_key)
values
  ('S26-01', 'S26', 1, false, 'First Light', 'YOUR OWN PHOTO OF A CARD',
   (select id from public.dex_creatures where dex_number = 1), null, 'holo', 'own_photo_1'),
  ('S26-02', 'S26', 2, false, 'First Word', 'FIRST COMMENT LEFT',
   (select id from public.dex_creatures where dex_number = 2), null, 'holo', 'comment_1'),
  ('S26-03', 'S26', 3, false, 'Infinite Original', 'FOUNDING BADGE CLAIMED',
   (select id from public.dex_creatures where dex_number = 3), null, 'holo', 'founder_badge'),
  ('S26-04', 'S26', 4, false, 'Open Heart', 'FIRST POST HEATED UP',
   (select id from public.dex_creatures where dex_number = 4), null, 'holo', 'heart_given_1'),
  ('S26-05', 'S26', 5, false, 'Snapsnout', 'FIRST CARD SCANNED',
   (select id from public.dex_creatures where dex_number = 5), null, 'holo', 'scan_1'),
  ('S26-06', 'S26', 6, false, 'The Collection Keeper', 'FIRST CARD ADDED',
   (select id from public.dex_creatures where dex_number = 6), null, 'holo', 'card_1'),
  ('S26-07', 'S26', 7, false, 'The Face', 'PROFILE PICTURE SET',
   (select id from public.dex_creatures where dex_number = 7), null, 'holo', 'avatar_set'),
  ('S26-08', 'S26', 8, false, 'The Goalsetter', 'A COLLECTOR GOAL PICKED',
   (select id from public.dex_creatures where dex_number = 8), null, 'holo', 'goal_picked'),
  ('S26-09', 'S26', 9, false, 'The Herald', 'COLLECTION MADE PUBLIC',
   (select id from public.dex_creatures where dex_number = 9), null, 'holo', 'collection_public'),
  ('S26-10', 'S26', 10, false, 'The Initiate', 'ACCOUNT CREATED',
   (select id from public.dex_creatures where dex_number = 10), null, 'holo', 'account_created'),
  ('S26-11', 'S26', 11, false, 'The Namer', 'GRAIL CARD NAMED',
   (select id from public.dex_creatures where dex_number = 11), null, 'holo', 'grail_set'),
  ('S26-12', 'S26', 12, false, 'The Portal Opens', 'APP INSTALLED',
   (select id from public.dex_creatures where dex_number = 12), null, 'holo', 'app_installed'),
  ('S26-13', 'S26', 13, false, 'The Signal', 'ALERTS TURNED ON',
   (select id from public.dex_creatures where dex_number = 13), null, 'holo', 'alerts_on'),
  ('S26-14', 'S26', 14, false, 'The Storyteller', 'BIO WRITTEN',
   (select id from public.dex_creatures where dex_number = 14), null, 'holo', 'bio_set'),
  ('S26-15', 'S26', 15, false, 'The Unbroken Seal', 'FIRST SEALED PRODUCT',
   (select id from public.dex_creatures where dex_number = 15), null, 'holo', 'sealed_1'),
  ('S26-16', 'S26', 16, false, 'The Wishfinder', 'FIRST WISH SAVED',
   (select id from public.dex_creatures where dex_number = 16), null, 'holo', 'wish_1'),
  ('S26-17', 'S26', 17, false, 'The Tenfold Titan', '10 CARDS COLLECTED',
   (select id from public.dex_creatures where dex_number = 17), null, 'holo', 'cards_10'),
  ('S26-18', 'S26', 18, false, 'The Wishlist Keeper', 'FIVE WISHES SAVED',
   (select id from public.dex_creatures where dex_number = 18), null, 'holo', 'wishes_5'),
  ('S26-19', 'S26', 19, false, 'Sharp Eye', '10 CARDS SCANNED',
   (select id from public.dex_creatures where dex_number = 19), null, 'holo', 'scans_10'),
  ('S26-20', 'S26', 20, false, 'The Mirror', 'A REVERSE HOLO',
   (select id from public.dex_creatures where dex_number = 20), null, 'holo', 'reverse_holo'),
  ('S26-21', 'S26', 21, false, 'The Quarter', '25 CARDS COLLECTED',
   (select id from public.dex_creatures where dex_number = 21), null, 'holo', 'cards_25'),
  ('S26-22', 'S26', 22, false, 'The Shiny', 'A HOLO IN YOUR COLLECTION',
   (select id from public.dex_creatures where dex_number = 22), null, 'holo', 'holo'),
  ('S26-23', 'S26', 23, false, 'Open Handed', 'TEN POSTS HEATED UP',
   (select id from public.dex_creatures where dex_number = 23), null, 'holo', 'hearts_given_10'),
  ('S26-24', 'S26', 24, false, 'The Cartographer', 'CARDS FROM FIVE SETS',
   (select id from public.dex_creatures where dex_number = 24), null, 'holo', 'sets_5'),
  ('S26-25', 'S26', 25, false, 'The Portrait Set', 'FIVE OF YOUR OWN PHOTOS',
   (select id from public.dex_creatures where dex_number = 25), null, 'holo', 'own_photos_5'),
  ('S26-26', 'S26', 26, false, 'The Regular', 'TEN COMMENTS',
   (select id from public.dex_creatures where dex_number = 1), 'Steadfast Form', 'holo', 'comments_10'),
  ('S26-27', 'S26', 27, false, 'The Showcase', 'FIVE PHOTO POSTS',
   (select id from public.dex_creatures where dex_number = 2), 'Spotlight Form', 'holo', 'posts_5'),
  ('S26-28', 'S26', 28, false, 'The Appraiser', 'COLLECTION WORTH $100',
   (select id from public.dex_creatures where dex_number = 3), 'Gilded Form', 'holo', 'value_100'),
  ('S26-29', 'S26', 29, false, 'The Archivist', '25 CARDS SCANNED',
   (select id from public.dex_creatures where dex_number = 4), 'Archive Form', 'holo', 'scans_25'),
  ('S26-30', 'S26', 30, false, 'The Half', '50 CARDS COLLECTED',
   (select id from public.dex_creatures where dex_number = 5), 'Overdrive Form', 'holo', 'cards_50'),
  ('S26-31', 'S26', 31, false, 'The Hunter', 'A WISH BECAME YOURS',
   (select id from public.dex_creatures where dex_number = 6), 'Hunter Form', 'holo', 'wish_fulfilled'),
  ('S26-32', 'S26', 32, false, 'The Atlas', 'CARDS FROM TEN SETS',
   (select id from public.dex_creatures where dex_number = 7), 'Worldface Form', 'holo', 'sets_10'),
  ('S26-33', 'S26', 33, false, 'The Graded', 'A GRADED CARD',
   (select id from public.dex_creatures where dex_number = 8), 'Slabstar Form', 'holo', 'graded_any'),
  ('S26-34', 'S26', 34, false, 'The Conversationalist', 'COMMENTED ON TEN PEOPLE',
   (select id from public.dex_creatures where dex_number = 9), 'Echo Form', 'holo', 'comment_people_10'),
  ('S26-35', 'S26', 35, false, 'The Dexwarden', '50 POKEMON DISCOVERED',
   (select id from public.dex_creatures where dex_number = 10), 'Warden Form', 'holo', 'pokedex_50'),
  ('S26-36', 'S26', 36, false, 'The Voice', 'TWENTY-FIVE COMMENTS',
   (select id from public.dex_creatures where dex_number = 11), 'Resonant Form', 'holo', 'comments_25'),
  ('S26-37', 'S26', 37, false, 'Well Received', 'TEN HEARTS ON YOUR COMMENTS',
   (select id from public.dex_creatures where dex_number = 12), 'Heartgate Form', 'holo', 'hearts_received_10'),
  ('S26-38', 'S26', 38, false, 'The Curator', 'FIFTEEN PHOTO POSTS',
   (select id from public.dex_creatures where dex_number = 13), 'Gallery Form', 'holo', 'posts_15'),
  ('S26-39', 'S26', 39, false, 'The Faithful', 'COMMENTED IN FOUR WEEKS',
   (select id from public.dex_creatures where dex_number = 14), 'Faithful Form', 'holo', 'comment_weeks_4'),
  ('S26-40', 'S26', 40, false, 'The Return', 'CARDS ADDED IN FOUR WEEKS',
   (select id from public.dex_creatures where dex_number = 15), 'Returned Form', 'holo', 'card_weeks_4'),
  ('S26-41', 'S26', 41, false, 'The Oathkeeper', 'A COLLECTOR GOAL COMPLETED',
   (select id from public.dex_creatures where dex_number = 16), 'Oathbound Form', 'holo', 'goal_done'),
  ('S26-42', 'S26', 42, false, 'The Perfect Ten', 'A CARD GRADED 10',
   (select id from public.dex_creatures where dex_number = 17), 'Perfect Form', 'gold', 'graded_ten'),
  ('S26-43', 'S26', 43, false, 'The Thirty', 'THIRTY DAYS A MEMBER',
   (select id from public.dex_creatures where dex_number = 18), 'Thirty-Day Form', 'holo', 'member_30'),
  ('S26-44', 'S26', 44, false, 'The Hundredfold', '100 CARDS COLLECTED',
   (select id from public.dex_creatures where dex_number = 19), 'Hundredfold Form', 'gold', 'cards_100'),
  ('S26-45', 'S26', 45, false, 'The Seasoned', 'CARDS ADDED IN EIGHT WEEKS',
   (select id from public.dex_creatures where dex_number = 20), 'Seasoned Form', 'holo', 'card_weeks_8'),
  ('S26-46', 'S26', 46, false, 'The Climber', 'VALUE UP TWO MONTHS RUNNING',
   (select id from public.dex_creatures where dex_number = 21), 'Ascendant Form', 'holo', 'value_up_2'),
  ('S26-47', 'S26', 47, false, 'Three Months Running', 'CARDS ADDED IN THREE MONTHS',
   (select id from public.dex_creatures where dex_number = 22), 'Triseason Form', 'gold', 'card_months_3'),
  ('S26-48', 'S26', 48, false, 'The Ninety', 'NINETY DAYS A MEMBER',
   (select id from public.dex_creatures where dex_number = 23), 'Ninety Form', 'gold', 'member_90'),
  ('S26-49', 'S26', 49, false, 'The Chronicler', 'ONE HUNDRED PHOTO POSTS',
   (select id from public.dex_creatures where dex_number = 24), 'Chronicle Form', 'gold', 'posts_100'),
  ('S26-50', 'S26', 50, false, 'The Thousand', 'COLLECTION WORTH $1,000',
   (select id from public.dex_creatures where dex_number = 25), 'Thousandstar Form', 'gold', 'value_1000'),
  ('S26-51', 'S26', 51, true, 'The Dex Complete', 'ALL FIFTY CARDS EARNED',
   (select id from public.dex_creatures where dex_number = 1), 'Infinite Gold Form', 'secret', 'all_fifty')
on conflict (code) do nothing;


-- What you should see: 25 creatures, 51 cards, 50 of them countable.
select (select count(*) from public.dex_creatures)                  as creatures,
       (select count(*) from public.reward_cards)                   as cards,
       (select count(*) from public.reward_cards where not secret)  as countable;
