-- MARKET PRICES ARE PUBLIC INFORMATION. Let anybody read them.
--
-- WHY THIS EXISTS
--
-- card_price_history holds one row per card, per printing, per day: the
-- market price sync-prices pulled off TCGdex that morning. It is not
-- anybody's data. It says nothing about who owns what. It is the same
-- number TCGplayer and Cardmarket publish on a page with no login on it.
--
-- It had a policy for `authenticated` and none for `anon`, and row level
-- security denies by default, so:
--
--   * a signed-out visitor in the app saw no price history on any card
--   * tools/build-post-pages.mjs, which reads with the public anon key in
--     a GitHub action, got zero rows -- so every shared card page went out
--     with no value on it and no way to say whether the card had moved
--
-- Both of those looked like missing data. Neither was: the rows were there
-- the whole time and the reader was not allowed to see them.
--
-- WHAT THIS GRANTS
--
-- SELECT, to anon, on market prices. Nothing else. Writes stay with the
-- service role, which is what sync-prices runs as.
--
-- RUN IT: paste the whole file into the Supabase SQL Editor and press Run.
-- Safe to run more than once.

alter table public.card_price_history enable row level security;

drop policy if exists "card prices are public" on public.card_price_history;

create policy "card prices are public"
  on public.card_price_history
  for select
  to anon, authenticated
  using (true);

grant select on public.card_price_history to anon, authenticated;

-- The builder asks for one card's readings at a time, newest last. Without
-- this every page build is a sequential scan of the whole table.
create index if not exists card_price_history_card_recorded_idx
  on public.card_price_history (card_id, source, recorded_on);
