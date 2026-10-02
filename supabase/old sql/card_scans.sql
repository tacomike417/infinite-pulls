-- Infinite Pulls — card scan log
-- =============================
--
-- WHY THIS EXISTS
--
-- Ximilar will not tell us what a scan costs. Their docs give a credit
-- price for tagging a photo and for removing a background, but nothing
-- for identifying a trading card, and support would have to be asked. We
-- are not going to run a paid scanner on a number nobody knows.
--
-- So we measure it. Their account endpoint reports `credits_counter` --
-- the credits left on the account. This table records that figure
-- alongside every single scan. The DIFFERENCE between one row and the
-- next is what that scan actually cost, in credits, observed rather than
-- quoted. After twenty scans the true price is known exactly.
--
-- The same rows answer the other open question. Nobody publishes accuracy
-- figures worth trusting either, so every scan records whether it matched,
-- what it thought the card was, and whether that resolved to a real card
-- in our own database. A week of Jeff scanning at the counter is a better
-- accuracy report than any vendor page.
--
-- WHAT IS NOT IN HERE
--
-- The photograph. It is sent to Ximilar, identified, and dropped. Storing
-- customers' card photos would mean a storage bill, a retention policy and
-- a much more serious privacy conversation, to answer a question -- "did
-- the scanner work" -- that the text fields below already answer.
--
-- SAFE TO RUN TWICE.

create table if not exists public.card_scans (
  id              bigint generated always as identity primary key,
  user_id         uuid        references auth.users(id) on delete set null,
  scanned_at      timestamptz not null default now(),
  service         text        not null default 'ximilar',

  -- What came back
  matched         boolean     not null default false,
  card_name       text,
  set_name        text,
  set_code        text,
  card_number     text,
  alternatives    int,          -- how many other cards it thought were close
  resolved_id     text,         -- the TCGdex card we managed to map it to
  
  -- What it cost, and how long it took
  credits_after   bigint,       -- credits_counter AFTER this scan
  duration_ms     int,
  error           text
);

create index if not exists card_scans_recent
  on public.card_scans (scanned_at desc);
create index if not exists card_scans_by_user
  on public.card_scans (user_id, scanned_at desc);

alter table public.card_scans enable row level security;

-- Rows are written by the Edge Function using the service role, which
-- bypasses RLS entirely. Nothing in the browser writes here, so there is
-- no insert policy: a scan log somebody can forge is not a scan log.
drop policy if exists "own scans readable" on public.card_scans;
create policy "own scans readable"
  on public.card_scans for select
  to authenticated
  using (auth.uid() = user_id);

comment on table public.card_scans is
  'One row per card scan. credits_after holds Ximilar''s remaining-credit figure, so the gap between consecutive rows is the observed cost of a scan. Also the accuracy record: matched, what it identified, and whether it mapped to a real card.';


-- ---------------------------------------------------------------
-- THE TWO QUESTIONS THIS TABLE EXISTS TO ANSWER.
-- Run these after a few dozen scans.
-- ---------------------------------------------------------------

-- 1. WHAT DOES A SCAN ACTUALLY COST?
--    The gap between consecutive credit readings. Ignore the first row
--    and any row where the counter went up (a top-up, not a scan).
--
-- select round(avg(cost), 2) as avg_credits_per_scan, min(cost), max(cost), count(*)
-- from (
--   select credits_after - lead(credits_after) over (order by scanned_at desc) as cost
--   from public.card_scans where credits_after is not null
-- ) t where cost > 0;

-- 2. IS IT ANY GOOD?
--    Hit rate, and how often a match still failed to map to a real card.
--
-- select
--   count(*)                                             as scans,
--   count(*) filter (where matched)                      as identified,
--   count(*) filter (where resolved_id is not null)      as usable,
--   round(100.0 * count(*) filter (where resolved_id is not null) / nullif(count(*),0), 1) as usable_pct,
--   round(avg(duration_ms))                              as avg_ms
-- from public.card_scans
-- where scanned_at > now() - interval '30 days';
