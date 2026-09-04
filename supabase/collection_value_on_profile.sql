-- Infinite Pulls — the collection's value, kept on the account
-- ============================================================
--
-- WHY
--
-- The home page opens on a scoreboard: Pokemon, Cards, Value. The first
-- two are counted from the collection itself and are right the moment
-- somebody signs in, anywhere. Value was not: it was worked out by My
-- Collection and kept only in that browser, so signing in on a phone
-- after building the collection on a desktop showed a dash, and clearing
-- site data wiped it. Both look like a broken app on the one screen the
-- whole thing opens with.
--
-- This puts the same number on the visitor's own profile row, so it
-- follows the account rather than the browser.
--
-- WHY NOT collection_value_snapshots
--
-- That table is the value-over-time HISTORY, written once a day by an
-- Edge Function. This is "what is it worth right now", written every time
-- My Collection prices a collection. Different question, different
-- lifetime, and this one must not depend on a cron job being deployed.
--
-- SAFE TO RUN TWICE. Both columns are added only if missing, and no
-- existing row or policy is touched -- profiles already allows a signed-in
-- visitor to update their OWN row, which is what the app uses for bio,
-- tags and the grail card, so there is no new policy to write.

alter table public.profiles
  add column if not exists collection_value    numeric,
  add column if not exists collection_value_at timestamptz;

comment on column public.profiles.collection_value is
  'Total estimated value of this collector''s cards + sealed, as last worked out by My Collection. A cached figure for the home page scoreboard, not a running total and not authoritative.';

comment on column public.profiles.collection_value_at is
  'When collection_value was last written. The home page compares this against its local copy and the newest snapshot, and shows whichever is most recent.';
