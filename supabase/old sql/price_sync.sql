-- Infinite Pulls — the weekly price run
-- ====================================
--
-- WHAT THIS IS FOR
--
-- Once a week, every one of the 36,771 cards gets priced and the price
-- gets written down. Thirty days of that is kept. That is the whole idea.
--
-- Everything downstream is made of it: the red and green arrows on a card,
-- a movers-and-shakers list, a ticker, a badge for five cards that all
-- went up 25% in a week. None of those can be computed from today's price,
-- because today's price has nothing to be compared against.
--
-- WHY 30 DAYS IS THE RIGHT AMOUNT TO KEEP
--
-- The card arrow asks for the newest reading at least 7 days old
-- (CARD_DAYS in components/price-trend.js). Logging weekly and keeping 30
-- days leaves four or five readings per card at all times, so there is
-- always one on the far side of that 7-day line no matter which day of the
-- week somebody looks. Keeping more would answer no question anybody is
-- asking; keeping less would leave a hole every Sunday morning.
--
-- WHAT IT COSTS
--
--   English cards  23,548  about 1.5 TCGplayer printings + 1 Cardmarket
--   Japanese cards 13,223  Cardmarket only -- TCGplayer is null on all of
--                          them, checked against the live API
--   ------------------------------------------------------------------
--   roughly 72,000 rows per weekly run
--   x 4.3 runs held at once (30 days)  =  about 310,000 rows
--   at ~100 bytes a row plus its index =  about 50-60 MB
--
-- Against a 500 MB free tier that is a tenth of the space, and it stops
-- growing -- the prune below holds it flat forever.
--
-- SAFE TO RUN TWICE. Every statement is guarded.
--
-- ==========================================================
-- BEFORE YOU RUN THIS
-- ==========================================================
-- card_price_history must already have `source` in its primary key.
-- That is Part 3 of supabase/card_price_history.sql. Without it, storing
-- a TCGplayer price and a Cardmarket price for the same card on the same
-- day is a key collision and one silently overwrites the other. The check
-- at the very bottom of this file tells you whether it is in place.


-- ==========================================================
-- PART 1 — where the run keeps its place
-- ==========================================================
--
-- One row, id = 1. A run is a walk through public.cards in dataset_id
-- order, and `cursor` is how far it got. That is what makes the run
-- resumable: the function does a few hundred cards, saves the cursor, and
-- the next cron firing two minutes later picks up from there.

create table if not exists public.price_sync_state (
  id             smallint    primary key default 1,
  cursor         text        not null default '',
  running        boolean     not null default false,
  run_started_at timestamptz,
  run_day        date,
  cards_done     integer     not null default 0,
  rows_written   integer     not null default 0,
  card_errors    integer     not null default 0,
  finished_at    timestamptz,
  constraint price_sync_state_single_row check (id = 1)
);

insert into public.price_sync_state (id) values (1) on conflict (id) do nothing;

-- NOBODY CAN READ OR WRITE THIS FROM A BROWSER. RLS on with no policy at
-- all means exactly that. The Edge Function uses the service role, which
-- goes around RLS -- so the job works and the public cannot touch the
-- job's bookkeeping.
alter table public.price_sync_state enable row level security;

comment on table public.price_sync_state is
  'Bookkeeping for the weekly price run: how far through public.cards it has walked, and how it went. Service role only.';


-- ==========================================================
-- PART 2 — keeping exactly 30 days
-- ==========================================================
--
-- Runs daily. Deletes readings older than 30 days and returns how many
-- went, so the cron job's history in cron.job_run_details is readable.

create or replace function public.prune_price_history()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  gone integer;
begin
  delete from public.card_price_history
  where recorded_on < ((now() at time zone 'utc')::date - 30);
  get diagnostics gone = row_count;
  return gone;
end;
$$;

revoke all on function public.prune_price_history() from public, anon, authenticated;

comment on function public.prune_price_history() is
  'Drops price readings older than 30 days. Scheduled daily. Returns the number deleted.';


-- ==========================================================
-- PART 3 — the schedules
-- ==========================================================
--
-- The project ref in the URLs below is already filled in. It is the same
-- one that has always sat in config.js, which ships to every visitor's
-- browser -- a project ref is an address, not a secret.
--
-- Three jobs, and it is worth knowing why it is three:
--
--   START    Sunday 06:00 UTC. Resets the cursor and opens a run.
--   WORKER   every 2 minutes, Sundays 06:00-23:59 UTC. Does one slice of
--            400 cards and stops. About 92 slices to get through the
--            catalogue, so it finishes around 09:05 UTC. Every firing
--            after that costs one cheap read and returns {"idle":true}.
--   PRUNE    every day 05:30 UTC. Half an hour before the run, so the
--            week's oldest readings are gone before new ones arrive.
--
-- The worker is a separate job from the start on purpose. If a slice dies
-- -- TCGdex having a bad minute, a timeout -- the next firing picks up
-- from the saved cursor two minutes later and no one has to notice.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('infinite-pulls-price-sync-start')  where exists (select 1 from cron.job where jobname = 'infinite-pulls-price-sync-start');
select cron.unschedule('infinite-pulls-price-sync-worker') where exists (select 1 from cron.job where jobname = 'infinite-pulls-price-sync-worker');
select cron.unschedule('infinite-pulls-price-history-prune') where exists (select 1 from cron.job where jobname = 'infinite-pulls-price-history-prune');

select cron.schedule(
  'infinite-pulls-price-sync-start',
  '0 6 * * 0',   -- Sundays, 06:00 UTC (about 1-2am US Eastern)
  $$
  select net.http_post(
    url := 'https://rrkyvcouxdmurwdyuugv.functions.supabase.co/sync-prices?start=1',
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  $$
);

select cron.schedule(
  'infinite-pulls-price-sync-worker',
  '*/2 6-23 * * 0',   -- every 2 minutes on Sunday, from 06:00 UTC
  $$
  select net.http_post(
    url := 'https://rrkyvcouxdmurwdyuugv.functions.supabase.co/sync-prices',
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  $$
);

select cron.schedule(
  'infinite-pulls-price-history-prune',
  '30 5 * * *',   -- every day, 05:30 UTC
  $$ select public.prune_price_history(); $$
);


-- ==========================================================
-- PART 4 — how to see what it is doing
-- ==========================================================

-- Where the current run is up to.
--   running = true  and cards_done climbing  -> it is working
--   running = false and finished_at set      -> last week's run completed
--   card_errors                              -> cards TCGdex would not
--                                               serve; a few dozen is
--                                               normal, thousands is not
select * from public.price_sync_state;

-- What has actually been stored, per source and per day.
-- After the FIRST run this shows one date. Arrows appear 7 days later.
select source, recorded_on, count(*) as readings, count(distinct card_id) as cards
from public.card_price_history
group by source, recorded_on
order by recorded_on desc, source;

-- What it is costing on disk. Watch this settle rather than climb once
-- four weekly runs are in.
select pg_size_pretty(pg_total_relation_size('public.card_price_history')) as price_history_size;

-- THE PREREQUISITE CHECK. Expect FOUR rows: card_id, variant, source,
-- recorded_on. If `source` is missing, stop and run Part 3 of
-- supabase/card_price_history.sql first -- otherwise every Cardmarket
-- price will quietly overwrite that card's TCGplayer price for the day.
select a.attname as primary_key_column
from pg_index i
join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
where i.indrelid = 'public.card_price_history'::regclass and i.indisprimary;
