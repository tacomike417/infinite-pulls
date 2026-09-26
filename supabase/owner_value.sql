-- ============================================================
-- YOUR VALUE, ON A GRADED CARD.
--
-- No price source this app can reach knows what a SLAB is worth -- every
-- figure we have is raw Near Mint. So a PSA 10 Meowth ex was counting in
-- somebody's collection total at its raw $109, when PSA 10s of it were
-- selling on eBay for $230-$255. Jeff caught it looking at a customer's
-- card, 26 Sep 2026, and picked option A: the OWNER types what their slab
-- is worth, a "check eBay sold listings" link sits right under the box so
-- the number is one tap from proof, and their collection total uses it.
--
-- Nobody has to approve anything and nothing is sent to Jeff. The app just
-- asks "you sure?" when the number is more than 20x the raw price.
--
-- ONLY COUNTS ON A GRADED CARD. The app ignores this column on a raw row,
-- so moving a slab back to "Near Mint" puts it straight back on the market
-- price without anybody having to clear it.
--
-- Nullable. Null means "not set", and the card counts at raw price like
-- it always has.
--
-- The existing user_cards policies already cover it: the owner writes
-- their own rows, and everyone can read the cards of a public profile.
--
-- SAFE TO RUN TWICE.
-- ============================================================

alter table public.user_cards
  add column if not exists owner_value numeric(12,2);

comment on column public.user_cards.owner_value is
  'What the owner says this graded card is worth, in USD. Only used when the '
  'condition is a grade (PSA 10, TAG 9.5...). Null = not set.';

-- A sanity fence, not a price check: no negative numbers, and nothing a
-- typo could make absurd. The app does the "you sure?" part.
alter table public.user_cards
  drop constraint if exists user_cards_owner_value_range;
alter table public.user_cards
  add constraint user_cards_owner_value_range
  check (owner_value is null or (owner_value >= 0 and owner_value <= 1000000));

-- ============================================================
-- CHECK: should say owner_value exists (0 rows set yet is normal).
-- ============================================================
select
  count(*)                                        as cards,
  count(*) filter (where owner_value is not null) as with_your_value
from public.user_cards;
