-- ===========================================================================
-- S26: TEN CARDS. Six earned in the app, four earned in the shop.
-- 3 September 2026. Run once, in the Supabase SQL Editor.
--
-- WHAT THIS DOES
--   1. Parks the six season cards we are not using this year. Parked, not
--      deleted: season becomes 'PARKED' and enabled becomes false, so they
--      leave S26 entirely and stop counting toward anything. Putting one
--      back is one UPDATE.
--   2. Brings Grand Opening into the numbered set as card 07.
--   3. Adds three more in-store slots as 08, 09 and 10, switched off.
--
-- WHY THE SLOTS ARE NOT ACTUALLY EMPTY
--   infinite_dex_cards_award_shape refuses a 'code' card with no claim code
--   -- correctly, since that is a card nobody could ever earn. So each slot
--   is seeded with a placeholder code and left DISABLED. Nobody can claim a
--   disabled card, and Jeff replaces the placeholder when he names it.
--
-- Safe to run more than once.
-- ===========================================================================

begin;

-- 1. The six that sit out this year -------------------------------------
--    Kept whole, moved out of the season. The Hundredfold is the notable
--    one: it is a fine card, but with prizes at 6/8/10 a card requiring a
--    hundred Pokemon cards would put the top prize out of everyone's reach
--    but the biggest collector. It is a 2027 chase card.
update public.infinite_dex_cards
   set season = 'PARKED', enabled = false
 where code in ('COL-100', 'PDX-050', 'GOL-001', 'SLD-001', 'NTF-001', 'PRO-001');

-- 2. The six that stay, numbered 01-06 ----------------------------------
--    They already hold these numbers; stated here so this file is the whole
--    truth about the season rather than half of it.
update public.infinite_dex_cards set number = 1, display_order = 1 where code = 'ACC-001';
update public.infinite_dex_cards set number = 2, display_order = 2 where code = 'COL-001';
update public.infinite_dex_cards set number = 3, display_order = 3 where code = 'APP-001';
update public.infinite_dex_cards set number = 4, display_order = 4 where code = 'WSH-001';
update public.infinite_dex_cards set number = 5, display_order = 5 where code = 'SCN-001';
update public.infinite_dex_cards set number = 6, display_order = 6 where code = 'COL-010';

-- 3. Grand Opening becomes card 07 --------------------------------------
--    It was an 'event' card, which meant unnumbered and outside the set.
--    That existed because in-shop cards were going to be endless. Capping
--    the year at ten ended that, so the shop cards join the set and the
--    customer's progress line can honestly say "7 of 10".
update public.infinite_dex_cards
   set series = 'set', season = 'S26', number = 7, display_order = 7
 where code = 'EVT-001';

-- 4. Three slots for Jeff, 08 to 10 -------------------------------------
insert into public.infinite_dex_cards
  (code, name, task_line, season, series, number, rarity, award_type, claim_code, enabled, display_order)
values
  ('EVT-002', 'Empty slot', 'Not set up yet', 'S26', 'set',  8, 'holo', 'code', 'SLOT08', false, 8),
  ('EVT-003', 'Empty slot', 'Not set up yet', 'S26', 'set',  9, 'holo', 'code', 'SLOT09', false, 9),
  ('EVT-004', 'Empty slot', 'Not set up yet', 'S26', 'set', 10, 'holo', 'code', 'SLOT10', false, 10)
on conflict (code) do nothing;

commit;

-- What you should see: ten rows, 1 to 10, six 'auto' and four 'code'.
select number, code, name, award_type, claim_code, enabled
  from public.infinite_dex_cards
 where season = 'S26'
 order by number;
