-- Infinite Pulls — trend arrow self-test
-- =====================================
--
-- Proves the arrows are real before anybody negotiates against one.
--
-- HOW IT WORKS
--
-- It does not invent prices. It takes the rows the app ALREADY wrote today
-- and back-dates a copy of each at a fixed RATIO of today's figure. Because
-- the arrow is a percentage, the ratio decides the answer and the price
-- does not -- so every card shows the SAME number, and that number is
-- known in advance.
--
--   seed at  80% of today  ->  +25.0%  (100-80)/80
--   seed at 125% of today  ->  -20.0%  (100-125)/125
--   seed at  98% of today  ->   +2.0%  = under the 3% floor = NO arrow
--
-- Anything else on screen is a failure worth stopping for.
--
-- Run the blocks one at a time. CLEAN UP when you are done -- these rows
-- are fabricated and have no business sitting in a price history.

-- ---------------------------------------------------------------
-- 0. WHAT DID THE APP ACTUALLY RECORD TODAY?
--    Run this after opening My Collection / looking up a card.
--    Expect: rows with a real source and a matching currency.
--    cardmarket rows MUST say EUR, tcgplayer rows MUST say USD.
-- ---------------------------------------------------------------
select card_id, variant, source, currency, price, recorded_on
from public.card_price_history
where recorded_on = (now() at time zone 'utc')::date
order by card_id, source;


-- ---------------------------------------------------------------
-- 1. GREEN TEST — every arrow could read  ▲ 25%
-- ---------------------------------------------------------------
insert into public.card_price_history
  (card_id, variant, source, recorded_on, price, currency)
select card_id, variant, source, recorded_on - 8, round(price * 0.80, 2), currency
from public.card_price_history
where recorded_on = (now() at time zone 'utc')::date
on conflict do nothing;

-- >>> Reload Card Lookup, pull up a card you priced. Expect ▲ 25%.
-- >>> Then run block 4 to clean up before moving on.


-- ---------------------------------------------------------------
-- 2. RED TEST — every arrow could read  ▼ 20%
--    (run block 4 first, so the green seed is gone)
-- ---------------------------------------------------------------
insert into public.card_price_history
  (card_id, variant, source, recorded_on, price, currency)
select card_id, variant, source, recorded_on - 8, round(price * 1.25, 2), currency
from public.card_price_history
where recorded_on = (now() at time zone 'utc')::date
on conflict do nothing;

-- >>> Reload. Expect ▼ 20%. Then block 4.


-- ---------------------------------------------------------------
-- 3. THE GUARD TEST — the one that matters most.
--    Back-dates a row under the WRONG marketplace. A TCGplayer price
--    must NOT be compared against a Cardmarket one.
--    (run block 4 first)
--
--    EXPECT: NO ARROW AT ALL. An arrow here means the cross-market
--    bug is back and the feature is unsafe to ship.
-- ---------------------------------------------------------------
insert into public.card_price_history
  (card_id, variant, source, recorded_on, price, currency)
select card_id, variant,
       case when source = 'tcgplayer' then 'cardmarket' else 'tcgplayer' end,
       recorded_on - 8, round(price * 0.50, 2),
       case when source = 'tcgplayer' then 'EUR' else 'USD' end
from public.card_price_history
where recorded_on = (now() at time zone 'utc')::date
on conflict do nothing;

-- >>> Reload. Expect NOTHING. Then block 4.


-- ---------------------------------------------------------------
-- 4. CLEAN UP — removes every fabricated row, keeps today's real ones.
--    Run this after each test above, and again at the very end.
-- ---------------------------------------------------------------
delete from public.card_price_history
where recorded_on < (now() at time zone 'utc')::date;

delete from public.collection_value_snapshots
where snapshot_date < (now() at time zone 'utc')::date;


-- ---------------------------------------------------------------
-- 5. PORTFOLIO TEST — the Value number on the home page.
--    Needs My Collection to have priced at least once today.
--    Expect ▲ 25% under Value.  Clean up with block 4.
-- ---------------------------------------------------------------
insert into public.collection_value_snapshots
  (user_id, snapshot_date, total_value)
select user_id, snapshot_date - 31, round(total_value * 0.80, 2)
from public.collection_value_snapshots
where snapshot_date = (now() at time zone 'utc')::date
on conflict do nothing;
