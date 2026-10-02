-- ==========================================================
-- SHUTTING THE CATALOGUE LANDING TABLE
-- ==========================================================
--
-- Supabase's security advisor, 6 Sep 2026: "Table publicly accessible --
-- anyone with your project URL can read, edit, and delete all data in
-- this table because Row-Level Security is not enabled."
--
-- WHAT staging_cards IS, AND WHY THIS STILL MATTERS
--
-- It is the landing area for the TCGdex card CSVs -- truncated and
-- refilled on every import, and nothing reads it but the merge. So there
-- is nothing in it worth stealing: it is a copy of a public card list.
--
-- The risk is the other direction. A stranger could WRITE to it. Nobody
-- outside can run merge_staging_cards() -- that is already revoked from
-- anon and authenticated -- but the merge is run by hand from the SQL
-- editor after an import, and it does not know who put the rows there.
-- Fill this table with rubbish, wait for the next catalogue import, and
-- the rubbish lands in public.cards, which is the table every lookup,
-- every price and every collection in the app is built on.
--
-- RLS ON, NO POLICIES AT ALL. That is the whole fix. The two things that
-- legitimately touch this table both bypass RLS by design:
--   * the dashboard CSV importer, which runs as a privileged role
--   * merge_staging_cards(), which is SECURITY DEFINER
-- Nothing in any browser has any business here.
--
-- SAFE TO RUN TWICE.

alter table public.staging_cards enable row level security;

comment on table public.staging_cards is
  'Landing area for the TCGdex card CSVs. Truncated and refilled on every import; nothing reads it but the merge. RLS is ON with no policies on purpose -- the importer and merge_staging_cards() bypass it, and nothing in a browser may touch it.';
