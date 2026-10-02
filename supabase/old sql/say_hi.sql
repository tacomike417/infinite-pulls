-- ============================================================
-- SAY HI -- 27 Sep 2026 (Mike).
--
-- The last step of the profile score: a hello post made for the new
-- member (their photo, @name, tagline, first card and profile QR). This
-- marks those posts so the feed can show a NEW MEMBER tag and a one-tap
-- "Say welcome" button, and so the step knows it is done.
--
-- SAFE TO RUN TWICE.
-- ============================================================

alter table public.user_photos
  add column if not exists is_intro boolean not null default false;

-- A correct result: one row, 'ok'.
select case when exists (select 1 from information_schema.columns
                          where table_name = 'user_photos' and column_name = 'is_intro')
            then 'ok' else 'MISSING' end as say_hi;
