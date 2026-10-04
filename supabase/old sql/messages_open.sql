-- ============================================================
-- MESSAGES OPEN TO EVERYONE -- 3 Oct 2026 (Mike: "lets open up messages to everyone").
--
-- Flips the ONE switch messenger_launch.sql made. Nothing else changes.
-- The rules stay on: 18 or older, email confirmed, account a week old and
-- active, the two people follow each other, not blocked, not banned.
--
-- To close it again (back to Mike + Jeff only):
--     update public.dm_settings set open = false;
--
-- SAFE TO RUN TWICE.
-- ============================================================

update public.dm_settings set open = true where id = 1;

-- A correct result: one row, status 'messages: open', open = true.
select 'messages: open' as status, public.dm_is_open() as open;
