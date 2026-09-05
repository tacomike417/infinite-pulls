-- ===========================================================================
-- PROVE THE RESOLVER'S QUESTION BEFORE TRUSTING ITS ANSWER
--
-- components/collection.js now asks public.cards for a scanned card before
-- it asks TCGdex. Every query below is the SAME question the app asks, in
-- the same order, with the same filters. If these five return what the
-- comments say they should, the app's lookup is sound.
--
-- Paste the whole file into the Supabase SQL editor and run it.
-- Nothing here writes anything.
-- ===========================================================================


-- 1 ------------------------------------------------------------------------
-- The scan that started all this: a card printed "082/198".
-- The app normalises 082 -> 82 and asks for number_norm.
-- EXPECT: exactly one row, Iron Thorns ex or whatever sv3 082 is —
-- one card, not a page of near misses.
select tcgdex_id, set_id, collector_number, set_total, name_english
from public.cards
where language = 'en'
  and number_norm = '82'
  and set_total = '198';


-- 2 ------------------------------------------------------------------------
-- The same number with NO set total — the manual-search case.
-- EXPECT: a count in the dozens. This is why the app has a ceiling of 8:
-- above it, fetching each card one at a time is slower than the old
-- substring search, so the old path runs instead.
select count(*) as english_cards_numbered_82
from public.cards
where language = 'en' and number_norm = '82';


-- 3 ------------------------------------------------------------------------
-- A JAPANESE card. This is the one TCGdex cannot answer well, because its
-- Japanese database has no English names at all.
-- EXPECT: rows with name_native in Japanese AND name_english filled in.
-- Those English names come from here and nowhere else.
select tcgdex_id, set_id, collector_number, set_total,
       name_native, name_english, translation_status
from public.cards
where language = 'ja' and number_norm = '82'
limit 10;


-- 4 ------------------------------------------------------------------------
-- How much of the Japanese half can actually show an English name.
-- EXPECT: two or three rows totalling 13,223. The 'have_english' number is
-- how many Japanese scans can name the card in English today.
select translation_status,
       count(*) as cards,
       count(name_english) filter (where name_english <> '') as have_english
from public.cards
where language = 'ja'
group by translation_status
order by cards desc;


-- 5 ------------------------------------------------------------------------
-- THE ONE THAT MATTERS FOR SPEED. Both indexed lookups, explained.
-- EXPECT: "Index Scan using cards_lookup_number" (or cards_lookup_set_number).
-- If either says "Seq Scan", the index is missing and every scan will read
-- all 36,771 rows — still correct, just slow.
explain analyze
select tcgdex_id from public.cards
where language = 'en' and number_norm = '82';

explain analyze
select tcgdex_id from public.cards
where language = 'ja' and set_id = 'SV3' and number_norm = '82';
