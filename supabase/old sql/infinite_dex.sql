-- ============================================================
-- INFINITE DEX — the rewards system's tables.
--
-- Run this once in the Supabase SQL Editor. Safe to re-run: everything
-- is "if not exists" / "on conflict do nothing", and the seed rows at the
-- bottom never overwrite a card you have since edited in the admin panel.
--
-- REQUIRES schema.sql (profiles, user_cards, wishlist_cards,
-- user_collector_goals) and sealed_product.sql (user_sealed). Those are
-- what the automatic awards are checked against.
--
-- Nothing here touches user_cards. An Infinite Dex card is not a Pokémon
-- card: it never enters My Collection, never counts toward portfolio
-- value, and never appears in the Pokédex. Separate track, separate page.
-- ============================================================


-- ============================================================
-- 1. THE CARDS — the catalogue. One row per card that exists.
--
--    Everything printed on the art lives here too, because the art is a
--    picture and the app cannot read it. If it is on the card, it is a
--    column.
--
--    Two series:
--      'set'   — the numbered season set. Ten to twelve cards, fixed,
--                so the app can honestly say "6 / 12 collected".
--      'event' — Jeff's in-store cards. Open-ended, unnumbered, because
--                he will invent a new one every time something happens
--                in the shop and a fixed denominator would be wrong by
--                October.
--
--    Two ways to earn one:
--      'auto'  — the app already knows it happened. trigger_key says
--                which thing. Nothing to type.
--      'code'  — Jeff writes a word on a board in the shop and the
--                customer types it in. claim_code is that word.
-- ============================================================
create table if not exists public.infinite_dex_cards (
  id uuid primary key default gen_random_uuid(),

  -- The collector code printed bottom-left: COL-001, SCN-001, EVT-001.
  -- Unique, and the handle everything else refers to — the app awards a
  -- card by code, not by uuid, so a seed row and a hand-made row behave
  -- identically.
  code text not null unique,

  name      text not null,          -- THE COLLECTION KEEPER
  task_line text not null,          -- FIRST CARD ADDED
  flavor    text,                   -- Your collection begins.

  season text not null default 'S26',
  series text not null default 'set' check (series in ('set', 'event')),
  -- Position within the season's set (the "005" of "005/012"). Null for
  -- event cards, which are not numbered. The denominator is not stored
  -- anywhere: it is just how many enabled 'set' cards this season has,
  -- counted at read time, so adding a thirteenth card cannot leave a
  -- stale "12" printed somewhere in the app.
  number integer,

  rarity text not null default 'holo' check (rarity in ('holo', 'gold')),

  -- Full art (1060x1484, ~3 MB) and the small WebP the grid actually
  -- shows. Both are uploaded to the 'dex-art' bucket in section 5.
  -- Twelve full-size cards is 38 MB on shop wifi; the thumbnail is not
  -- a nicety.
  art_url   text,
  thumb_url text,

  award_type text not null check (award_type in ('auto', 'code')),
  -- 'code' cards only. Stored as typed; matched case-insensitively.
  claim_code text,
  -- 'auto' cards only. One of the keys in dex_trigger_met() below.
  trigger_key text,

  -- Optional window. A grand-opening card can be claimable for that
  -- weekend and dead afterwards, without anyone having to remember to
  -- go and switch it off on Monday.
  active_from  timestamptz,
  active_until timestamptz,

  enabled boolean not null default true,
  display_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A code card with no code, or an auto card with no trigger, is a card
  -- nobody can ever earn. Refuse it here rather than discovering it when
  -- a customer is standing at the counter.
  constraint infinite_dex_cards_award_shape check (
    (award_type = 'code' and claim_code   is not null and length(trim(claim_code)) > 0) or
    (award_type = 'auto' and trigger_key  is not null and length(trim(trigger_key)) > 0)
  ),
  constraint infinite_dex_cards_set_numbered check (
    series <> 'set' or number is not null
  )
);

-- Codes are typed by a customer on a phone, so GRANDOPENING,
-- grandopening and " GrandOpening " are the same code. Enforced here so
-- two cards can never claim the same word in different cases.
create unique index if not exists infinite_dex_cards_claim_code_idx
  on public.infinite_dex_cards (upper(trim(claim_code)))
  where claim_code is not null;

-- One card per slot per season, so a numbering mistake in the admin
-- panel surfaces immediately instead of showing two "005/012" cards.
create unique index if not exists infinite_dex_cards_season_number_idx
  on public.infinite_dex_cards (season, number)
  where series = 'set';

create or replace function public.set_infinite_dex_card_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists infinite_dex_cards_set_updated_at on public.infinite_dex_cards;
create trigger infinite_dex_cards_set_updated_at
  before update on public.infinite_dex_cards
  for each row
  execute function public.set_infinite_dex_card_updated_at();

alter table public.infinite_dex_cards enable row level security;

-- Everyone can read the catalogue, signed in or not — the Dex page shows
-- locked cards to signed-out visitors too, because "here is what you
-- could be collecting" is the entire pitch.
--
-- claim_code is deliberately NOT hidden from this read. It is written on
-- a board in a public shop; treating it as a secret in the database while
-- it is taped to a wall would be theatre. See section 3 for what is
-- actually protected.
drop policy if exists "public read dex cards" on public.infinite_dex_cards;
create policy "public read dex cards"
  on public.infinite_dex_cards for select
  to anon, authenticated
  using (true);

drop policy if exists "admin manage dex cards" on public.infinite_dex_cards;
create policy "admin manage dex cards"
  on public.infinite_dex_cards for all
  to authenticated
  using (true)
  with check (true);


-- ============================================================
-- 2. WHO HAS WHAT — one row per card per customer. A ledger.
--
--    There is no insert, update or delete policy on this table. That is
--    on purpose: every write goes through the two functions in section 3,
--    which check the code or the trigger first. If the app could insert
--    here directly, a customer could hand themselves the whole set from
--    the browser console, and the set is worth a real discount at the
--    counter.
-- ============================================================
create table if not exists public.user_dex_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.infinite_dex_cards(id) on delete cascade,
  earned_at timestamptz not null default now(),
  unique (user_id, card_id)
);

create index if not exists user_dex_cards_user_id_idx on public.user_dex_cards(user_id);

alter table public.user_dex_cards enable row level security;

drop policy if exists "users read their own dex cards" on public.user_dex_cards;
create policy "users read their own dex cards"
  on public.user_dex_cards for select
  to authenticated
  using (auth.uid() = user_id);

-- Same public-profile rule as user_cards and user_collector_goals, so a
-- collector page can show off someone's Dex once that gets built.
drop policy if exists "public reads dex cards of public profiles" on public.user_dex_cards;
create policy "public reads dex cards of public profiles"
  on public.user_dex_cards for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = user_dex_cards.user_id and p.is_public = true
    )
  );


-- ============================================================
-- 3. EARNING A CARD — the only two ways to write to that ledger.
--
--    Both are SECURITY DEFINER, so they run with the privileges needed
--    to insert into a table the caller cannot touch, and both start by
--    checking auth.uid() so an anonymous caller gets nothing.
-- ============================================================

-- Is this automatic card actually earned?
--
-- Returns true (earned), false (not yet), or NULL — meaning "this app
-- knows, but the database cannot see it".
--
-- Three of the twelve are NULL, and it is worth being clear about why
-- rather than pretending otherwise:
--
--   app_installed       — the browser knows it is running as an installed
--                         PWA. Nothing is written down anywhere.
--   first_card_scanned  — scanning happens entirely in the browser, by
--                         design. There is no scan log to count.
--   pokedex_50          — the Pokédex is derived live from National Dex
--                         numbers that user_cards does not store.
--
-- Those three are taken on the app's word. Someone determined can give
-- themselves three cards. They still cannot give themselves the other
-- nine, and the discount is handed over by Jeff, who can look at their
-- Dex. That is the right amount of security for a card shop.
create or replace function public.dex_trigger_met(p_user uuid, p_trigger text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  case p_trigger

    when 'account_created' then
      select exists (select 1 from public.profiles where id = p_user) into v_ok;

    when 'first_card_added' then
      select exists (select 1 from public.user_cards where user_id = p_user) into v_ok;

    -- "Cards collected" counts copies, not rows — somebody with ten of
    -- the same Pikachu has ten cards, and would rightly argue the point.
    when 'cards_10' then
      select coalesce(sum(quantity), 0) >= 10 into v_ok from public.user_cards where user_id = p_user;

    when 'cards_100' then
      select coalesce(sum(quantity), 0) >= 100 into v_ok from public.user_cards where user_id = p_user;

    when 'first_wish_saved' then
      select exists (select 1 from public.wishlist_cards where user_id = p_user) into v_ok;

    when 'first_goal_completed' then
      select exists (
        select 1 from public.user_collector_goals
        where user_id = p_user and completed_at is not null
      ) into v_ok;

    when 'first_sealed_added' then
      select exists (select 1 from public.user_sealed where user_id = p_user) into v_ok;

    when 'alerts_enabled' then
      select coalesce(price_alerts_enabled, false) into v_ok from public.profiles where id = p_user;

    -- is_public DEFAULTS TO TRUE in schema.sql, so checking that flag on
    -- its own would hand this card to everybody the moment they signed
    -- up — which is exactly the opposite of what it is for. What we
    -- actually want to reward is a page worth looking at, so it also
    -- wants an avatar on it. If the card's task line ends up reading
    -- "PROFILE COMPLETED" rather than "COLLECTION MADE PUBLIC", this is
    -- why.
    when 'collection_public' then
      select (coalesce(is_public, false) and avatar_url is not null)
        into v_ok from public.profiles where id = p_user;

    -- Not visible from here. See the note above.
    when 'app_installed', 'first_card_scanned', 'pokedex_50' then
      v_ok := null;

    else
      -- An unknown trigger is a typo in the admin panel, not a card
      -- somebody has earned. Refuse it.
      v_ok := false;

  end case;

  return v_ok;
end;
$$;


-- Award an automatic card. The app calls this by code when it notices
-- something happened; the database decides whether it really did.
--
-- Returns { status, code, name, ... }. status is one of:
--   'awarded'   — new card, show the toast
--   'already'   — they had it. Not an error; the app calls this freely.
--   'not_yet'   — the trigger says no
--   'unknown'   — no such enabled auto card
--   'closed'    — outside its active window
create or replace function public.award_dex_card(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_card public.infinite_dex_cards%rowtype;
  v_met  boolean;
begin
  if v_user is null then
    return jsonb_build_object('status', 'unknown');
  end if;

  select * into v_card
    from public.infinite_dex_cards
   where code = p_code and enabled = true and award_type = 'auto';

  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;

  if (v_card.active_from  is not null and now() < v_card.active_from)
  or (v_card.active_until is not null and now() > v_card.active_until) then
    return jsonb_build_object('status', 'closed', 'code', v_card.code);
  end if;

  v_met := public.dex_trigger_met(v_user, v_card.trigger_key);
  -- NULL means the database cannot see it, so the app's word stands.
  if v_met is false then
    return jsonb_build_object('status', 'not_yet', 'code', v_card.code);
  end if;

  insert into public.user_dex_cards (user_id, card_id)
  values (v_user, v_card.id)
  on conflict (user_id, card_id) do nothing;

  if not found then
    return jsonb_build_object('status', 'already', 'code', v_card.code);
  end if;

  return jsonb_build_object(
    'status', 'awarded',
    'card_id', v_card.id,
    'code', v_card.code,
    'name', v_card.name,
    'task_line', v_card.task_line,
    'flavor', v_card.flavor,
    'rarity', v_card.rarity,
    'art_url', v_card.art_url,
    'thumb_url', v_card.thumb_url
  );
end;
$$;


-- Claim a card by typing the code off the board in the shop.
--
-- Returns the same shape. status is one of 'awarded', 'already',
-- 'closed', or 'invalid'.
--
-- A wrong code and a disabled card both return 'invalid', identically,
-- so that guessing at codes tells you nothing about which ones exist.
create or replace function public.claim_dex_card(p_claim_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_card public.infinite_dex_cards%rowtype;
begin
  if v_user is null or p_claim_code is null or length(trim(p_claim_code)) = 0 then
    return jsonb_build_object('status', 'invalid');
  end if;

  select * into v_card
    from public.infinite_dex_cards
   where enabled = true
     and award_type = 'code'
     and upper(trim(claim_code)) = upper(trim(p_claim_code));

  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  if (v_card.active_from  is not null and now() < v_card.active_from)
  or (v_card.active_until is not null and now() > v_card.active_until) then
    return jsonb_build_object('status', 'closed', 'code', v_card.code);
  end if;

  insert into public.user_dex_cards (user_id, card_id)
  values (v_user, v_card.id)
  on conflict (user_id, card_id) do nothing;

  if not found then
    return jsonb_build_object('status', 'already', 'code', v_card.code);
  end if;

  return jsonb_build_object(
    'status', 'awarded',
    'card_id', v_card.id,
    'code', v_card.code,
    'name', v_card.name,
    'task_line', v_card.task_line,
    'flavor', v_card.flavor,
    'rarity', v_card.rarity,
    'art_url', v_card.art_url,
    'thumb_url', v_card.thumb_url
  );
end;
$$;

-- Never callable from the browser: it is the check, not the door.
revoke all on function public.dex_trigger_met(uuid, text)  from public;
grant execute on function public.award_dex_card(text)      to authenticated;
grant execute on function public.claim_dex_card(text)      to authenticated;


-- ============================================================
-- 4. THE REWARDS — what a pile of cards is worth, and who has
--    already been given it.
-- ============================================================
create table if not exists public.dex_reward_tiers (
  id uuid primary key default gen_random_uuid(),
  cards_required integer not null unique check (cards_required > 0),
  -- What he actually hands over. Free text on purpose: Jeff writes
  -- "10% off a booster pack" or "a free sleeve" and neither the app nor
  -- this schema needs to understand what that means.
  reward text not null,
  description text,
  enabled boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_dex_reward_tier_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists dex_reward_tiers_set_updated_at on public.dex_reward_tiers;
create trigger dex_reward_tiers_set_updated_at
  before update on public.dex_reward_tiers
  for each row
  execute function public.set_dex_reward_tier_updated_at();

alter table public.dex_reward_tiers enable row level security;

drop policy if exists "public read dex reward tiers" on public.dex_reward_tiers;
create policy "public read dex reward tiers"
  on public.dex_reward_tiers for select
  to anon, authenticated
  using (true);

drop policy if exists "admin manage dex reward tiers" on public.dex_reward_tiers;
create policy "admin manage dex reward tiers"
  on public.dex_reward_tiers for all
  to authenticated
  using (true)
  with check (true);


-- One row the moment Jeff hands something over. The unique constraint is
-- the thing that stops the same reward being claimed twice, and it is a
-- database constraint rather than a check in the admin panel because the
-- admin panel is a web page on a phone behind a shop counter.
create table if not exists public.dex_reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tier_id uuid not null references public.dex_reward_tiers(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  -- Who was behind the counter, and anything worth remembering. Both
  -- free text, both optional.
  redeemed_by text,
  note text,
  unique (user_id, tier_id)
);

create index if not exists dex_reward_redemptions_user_id_idx
  on public.dex_reward_redemptions(user_id);

alter table public.dex_reward_redemptions enable row level security;

-- A customer can see what they have already been given, so the app can
-- say "claimed" instead of offering it again.
drop policy if exists "users read their own redemptions" on public.dex_reward_redemptions;
create policy "users read their own redemptions"
  on public.dex_reward_redemptions for select
  to authenticated
  using (auth.uid() = user_id);

-- The admin panel needs to look up any customer and record a redemption.
-- This follows the same "signed in means staff" rule as every other admin
-- section here — the panel is behind a Supabase Auth login and that login
-- is the gate.
drop policy if exists "admin read redemptions" on public.dex_reward_redemptions;
create policy "admin read redemptions"
  on public.dex_reward_redemptions for select
  to authenticated
  using (true);

drop policy if exists "admin record redemptions" on public.dex_reward_redemptions;
create policy "admin record redemptions"
  on public.dex_reward_redemptions for insert
  to authenticated
  with check (true);

-- Deliberately no update and no delete policy. A redemption is a record
-- of something that happened in the real world; it should not be
-- editable from a browser at all. Undoing one is a job for the Supabase
-- dashboard, which is exactly the amount of friction it deserves.


-- ============================================================
-- 5. CARD ART STORAGE — public bucket, admin writes.
--    Card art is meant to be looked at by anyone; only a signed-in
--    admin can put files in it.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('dex-art', 'dex-art', true)
on conflict (id) do nothing;

drop policy if exists "public read dex art" on storage.objects;
create policy "public read dex art"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'dex-art');

drop policy if exists "admin manage dex art" on storage.objects;
create policy "admin manage dex art"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'dex-art')
  with check (bucket_id = 'dex-art');


-- ============================================================
-- 6. THE SEASON — S26, twelve cards.
--
--    Seeded with no art. The admin panel uploads that in chunk 2, and
--    art_url/thumb_url fill in then. Everything else — the codes, the
--    names, the task lines, the flavour, the triggers — is already
--    correct here, so the Dex page has real content to render the day it
--    is built instead of an empty grid.
--
--    "on conflict (code) do nothing" means re-running this never
--    overwrites a card that has since been edited in the panel.
-- ============================================================
insert into public.infinite_dex_cards
  (code, name, task_line, flavor, season, series, number, rarity, award_type, trigger_key, display_order)
values
  ('ACC-001', 'The Initiate',          'ACCOUNT CREATED',      'Welcome, collector.',      'S26', 'set',  1, 'holo', 'auto', 'account_created',      1),
  ('COL-001', 'The Collection Keeper', 'FIRST CARD ADDED',     'Your collection begins.',  'S26', 'set',  2, 'holo', 'auto', 'first_card_added',     2),
  ('APP-001', 'The Portal Opens',      'APP INSTALLED',        'Your journey is live.',    'S26', 'set',  3, 'holo', 'auto', 'app_installed',        3),
  ('WSH-001', 'The Wishfinder',        'FIRST WISH SAVED',     'The hunt begins.',         'S26', 'set',  4, 'holo', 'auto', 'first_wish_saved',     4),
  ('SCN-001', 'Snapsnout',             'FIRST CARD SCANNED',   'Found it!',                'S26', 'set',  5, 'holo', 'auto', 'first_card_scanned',   5),
  ('COL-010', 'The Tenfold Titan',     '10 CARDS COLLECTED',   'Your vault is growing.',   'S26', 'set',  6, 'holo', 'auto', 'cards_10',             6),
  ('COL-100', 'The Hundredfold',       '100 CARDS COLLECTED',  'The vault has awakened.',  'S26', 'set',  7, 'gold', 'auto', 'cards_100',            7),
  ('PDX-050', 'The Dexwarden',         '50 POKÉMON DISCOVERED','The dex remembers.',       'S26', 'set',  8, 'holo', 'auto', 'pokedex_50',           8),
  ('GOL-001', 'The Oathkeeper',        'FIRST GOAL COMPLETED', 'You said you would.',      'S26', 'set',  9, 'holo', 'auto', 'first_goal_completed', 9),
  ('SLD-001', 'The Unbroken Seal',     'FIRST SEALED PRODUCT', 'Still shrink-wrapped.',    'S26', 'set', 10, 'holo', 'auto', 'first_sealed_added',  10),
  ('NTF-001', 'The Signal',            'ALERTS TURNED ON',     'You''ll know first.',      'S26', 'set', 11, 'holo', 'auto', 'alerts_enabled',      11),
  ('PRO-001', 'The Herald',            'COLLECTION MADE PUBLIC','Now the world sees.',     'S26', 'set', 12, 'holo', 'auto', 'collection_public',   12)
on conflict (code) do nothing;

-- Jeff's first event card, seeded DISABLED and with no art, so that
-- chunk 2 and chunk 3 have a real code card to build and test against
-- without any chance of a customer claiming a card that does not exist
-- yet. Turn it on from the admin panel once the art is uploaded and the
-- wording is his.
--
-- The window runs the length of the day of the grand opening, in
-- Eastern time. Change it in the panel if the event runs longer.
insert into public.infinite_dex_cards
  (code, name, task_line, flavor, season, series, number, rarity,
   award_type, claim_code, active_from, active_until, enabled, display_order)
values
  ('EVT-001', 'Grand Opening', 'SHOW UP SEPTEMBER 12TH', 'You were there.',
   'S26', 'event', null, 'holo',
   'code', 'GRANDOPENING',
   '2026-09-12 00:00:00-04', '2026-09-13 03:00:00-04',
   false, 100)
on conflict (code) do nothing;
