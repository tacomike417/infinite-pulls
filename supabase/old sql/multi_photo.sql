-- ============================================================
-- MORE THAN ONE PICTURE PER POST -- 27 Sep 2026.
--
-- A photo post keeps its first picture in object_key, exactly as before,
-- and up to 9 more in extra_keys (so 10 in all, like Instagram). Nothing
-- about existing posts changes: they simply have no extras.
--
-- SAFE TO RUN TWICE.
-- ============================================================

alter table public.user_photos
  add column if not exists extra_keys text[] not null default '{}';

alter table public.user_photos drop constraint if exists user_photos_extra_keys_max;
alter table public.user_photos add constraint user_photos_extra_keys_max
  check (cardinality(extra_keys) <= 9);

-- A correct result: one row, 'ok'.
select case when exists (select 1 from information_schema.columns
                          where table_name = 'user_photos' and column_name = 'extra_keys')
            then 'ok' else 'MISSING' end as multi_photo;
