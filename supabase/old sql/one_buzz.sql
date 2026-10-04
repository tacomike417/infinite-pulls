-- ============================================================
-- ONE BUZZ, NOT A BUNCH -- 3 Oct 2026 (Mike: "make sure the app is invasive
-- but not annoying, like Recovery Misfits").
--
-- A place to remember when a phone last made a sound. The push-out function
-- uses it to keep it to one buzz an hour and five a day per person; every
-- alert in between lands on the same card without a sound.
--
-- Run this BEFORE deploying push-out. SAFE TO RUN TWICE.
-- ============================================================

alter table public.notifications add column if not exists buzzed_at timestamptz;
create index if not exists notifications_buzzed
  on public.notifications (user_id, buzzed_at desc) where buzzed_at is not null;

-- A correct result: one row, status 'one buzz: ok'.
select case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'notifications' and column_name = 'buzzed_at')
            then 'one buzz: ok' else 'MISSING' end as status;
