-- ============================================================
-- PRICE ALERTS ON BY DEFAULT
--
-- Run this once in the Supabase SQL Editor. Safe to re-run.
--
-- SAFE AGAINST LIVE DATA. Changes one column default and, in section 2,
-- flips existing rows. Creates nothing, drops nothing.
--
-- WHAT WAS WRONG
--
-- profiles.price_alerts_enabled was declared "not null default false", so
-- every account ever created started with price alerts off. Nothing turned
-- them off on sign-out — they were never on. Somebody who never opened My
-- Account and found the tickbox would never get a single alert, which is
-- most people.
--
-- WHAT THIS DOES NOT DO — AND CANNOT
--
-- This is the SHOP's alerts setting, not the browser's. A browser will not
-- let any site turn push notifications on by itself: permission has to be
-- granted by the person, on a tap, and no amount of SQL changes that. What
-- this settles is the question the app asks AFTER permission exists —
-- "should this person get price alerts?" — and the answer is now yes
-- unless they say otherwise.
-- ============================================================


-- ============================================================
-- 1. NEW ACCOUNTS
--    From here on, an account is created with alerts already on.
-- ============================================================
alter table public.profiles
  alter column price_alerts_enabled set default true;


-- ============================================================
-- 2. THE ACCOUNTS THAT ALREADY EXIST
--
--    Every one of them is sitting on the old default, having never been
--    asked. Turning them on is the same decision as section 1, applied
--    backwards.
--
--    ⚠ IT CANNOT TELL "never asked" FROM "asked and said no". If somebody
--      has deliberately turned their alerts off, this turns them back on.
--      Comment this statement out if that matters more than the backfill.
-- ============================================================
update public.profiles
   set price_alerts_enabled = true
 where price_alerts_enabled = false;


-- ============================================================
-- 3. CHECK
--    default_is_now_on should be true, and everybody should be counted
--    under alerts_on.
-- ============================================================
select
  (select column_default like '%true%'
     from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'profiles'
      and column_name  = 'price_alerts_enabled')          as default_is_now_on,
  count(*) filter (where price_alerts_enabled)            as alerts_on,
  count(*) filter (where not price_alerts_enabled)        as alerts_off
from public.profiles;
