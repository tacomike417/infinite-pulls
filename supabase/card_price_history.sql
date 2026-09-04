-- Infinite Pulls — price history, so an arrow means something
-- ==========================================================
--
-- WHY
--
-- TCGdex hands over today's price and nothing else. Every value in this
-- app was therefore a snapshot with nothing to compare against, which is
-- why nothing has ever shown whether a card is moving up or down.
--
-- This is the missing half. Whenever the app prices a card -- a Card
-- Lookup, a My Collection load -- it writes what it saw, once per card
-- per variant per day. A week later there is a real seven-day change to
-- draw an arrow from.
--
-- WHY IT IS SHARED AND NOT PER-USER
--
-- A card's market price is not personal. Two collectors looking up the
-- same Charizard see the same number, so one row serves everybody, and
-- the history fills at the speed of ALL lookups rather than each person's
-- own. Nothing here identifies who looked anything up: card, variant,
-- price, date. That is the whole row.
--
-- ONE ROW PER CARD PER DAY
--
-- The primary key enforces it. Fifty people looking up the same card on
-- the same afternoon write one row, and the upsert simply overwrites the
-- day's figure with the latest reading rather than growing the table
-- fifty times faster than it needs to.
--
-- SAFE TO RUN TWICE.

create table if not exists public.card_price_history (
  card_id      text        not null,
  variant      text        not null default 'market',
  recorded_on  date        not null default (now() at time zone 'utc')::date,
  price        numeric     not null,
  currency     text        not null default 'USD',
  source       text        not null default 'tcgplayer',
  primary key (card_id, variant, recorded_on)
);

-- The only query this table ever answers: "what was this card worth
-- around N days ago", newest first.
create index if not exists card_price_history_lookup
  on public.card_price_history (card_id, variant, recorded_on desc);

alter table public.card_price_history enable row level security;

-- READABLE BY ANYONE SIGNED IN. It is market data with no owner.
drop policy if exists "price history readable by signed-in" on public.card_price_history;
create policy "price history readable by signed-in"
  on public.card_price_history for select
  to authenticated
  using (true);

-- WRITABLE BY ANYONE SIGNED IN, because the writer IS the app pricing a
-- card in somebody's browser. There is nothing here worth falsifying that
-- is not already visible in TCGdex, and no row belongs to anybody.
drop policy if exists "price history written by signed-in" on public.card_price_history;
create policy "price history written by signed-in"
  on public.card_price_history for insert
  to authenticated
  with check (true);

drop policy if exists "price history updated by signed-in" on public.card_price_history;
create policy "price history updated by signed-in"
  on public.card_price_history for update
  to authenticated
  using (true) with check (true);

comment on table public.card_price_history is
  'One market price per card per variant per day, written by the app whenever it prices a card. Shared across all users -- market data, not personal. Feeds the up/down arrows.';


-- ==========================================================
-- PART 2 — the portfolio snapshots table
-- ==========================================================
--
-- The 30-day arrow under the Value number on the home page needs a row
-- per collector per day, the same way the card arrow needs a row per card
-- per day.
--
-- This table was designed months ago to be filled by a nightly Edge
-- Function. That function was never deployed and the schedule that calls
-- it has never once reached it, so on this project the table has never
-- been created and not a single snapshot has ever been written. The
-- Portfolio View chart has been showing "Building your value history" to
-- everybody, forever, for that reason.
--
-- So this creates it, and the app now writes to it from the browser every
-- time My Collection prices a collection. No deploy, no cron, nothing to
-- go quietly wrong at 8am. A day nobody opened the app is a day with
-- genuinely no figure, which is the honest answer and better than a
-- server-invented one.
--
-- If the nightly function is ever deployed it keeps working unchanged --
-- the service role bypasses these policies and the upsert target is the
-- same.
--
-- SAFE TO RUN TWICE, and safe to run on a project where this table
-- already exists: nothing below drops or rewrites data.

create table if not exists public.collection_value_snapshots (
  user_id        uuid        not null references auth.users(id) on delete cascade,
  snapshot_date  date        not null default (now() at time zone 'utc')::date,
  total_value    numeric     not null,
  created_at     timestamptz not null default now(),
  primary key (user_id, snapshot_date)
);

create index if not exists collection_value_snapshots_lookup
  on public.collection_value_snapshots (user_id, snapshot_date desc);

alter table public.collection_value_snapshots enable row level security;

-- OWNER ONLY, in every direction. What a person's collection is worth is
-- the most private number in this app -- it is not on a public profile,
-- it is not visible to the shop, and it is not visible to another
-- collector. Unlike card prices above, this one has an owner.
drop policy if exists "own value snapshots readable" on public.collection_value_snapshots;
create policy "own value snapshots readable"
  on public.collection_value_snapshots for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "own value snapshots insertable" on public.collection_value_snapshots;
create policy "own value snapshots insertable"
  on public.collection_value_snapshots for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "own value snapshots updatable" on public.collection_value_snapshots;
create policy "own value snapshots updatable"
  on public.collection_value_snapshots for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.collection_value_snapshots is
  'One total collection value per collector per day. Written by the browser when My Collection prices everything. Owner-only in every direction. Feeds the 30-day arrow on the home scoreboard and the Portfolio View chart.';


-- ==========================================================
-- PART 3 — the marketplace belongs in the key
-- ==========================================================
--
-- WHAT WAS WRONG
--
-- The primary key above is (card_id, variant, recorded_on). It has no
-- room for WHICH MARKET a price came from, so a card that both TCGplayer
-- and Cardmarket carry gets one row per day from whichever pass happened
-- to price it -- Card Lookup writing a TCGplayer figure, or My Collection
-- writing a Cardmarket one for a Japanese card.
--
-- A week later the arrow compares today's TCGplayer dollars against last
-- week's Cardmarket euros and draws the gap between two different markets
-- as a week of movement. Same class of error as the 46% Charizard,
-- arriving through a different door.
--
-- THE FIX
--
-- Put `source` in the key. TCGplayer and Cardmarket then keep separate
-- daily series for the same card, and the code only ever compares a
-- series against itself.
--
-- Prices are also now stored in the currency they were quoted in --
-- Cardmarket in EUR, TCGplayer in USD -- rather than converting euros to
-- dollars first. Converting made the exchange rate part of the card's
-- price history: a card that never moved would show an arrow because the
-- euro did. The arrow is a percentage, so the unit never reaches anybody.
--
-- Adding a column to a primary key only ever RELAXES it, so this cannot
-- fail on existing rows and nothing is deleted.
--
-- SAFE TO RUN TWICE.

alter table public.card_price_history
  drop constraint if exists card_price_history_pkey;

alter table public.card_price_history
  add constraint card_price_history_pkey
  primary key (card_id, variant, source, recorded_on);

drop index if exists card_price_history_lookup;
create index if not exists card_price_history_lookup
  on public.card_price_history (card_id, variant, source, recorded_on desc);

-- The handful of rows written before this change were stored as dollars
-- with no source distinction. Rather than guess which market each came
-- from, they go: it is less than a day of data, every one of them gets
-- rewritten the next time anybody prices that card, and a guessed row is
-- exactly what this whole feature refuses to draw arrows from.
delete from public.card_price_history
where recorded_on < (now() at time zone 'utc')::date;
