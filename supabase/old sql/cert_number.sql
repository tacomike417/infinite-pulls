-- ============================================================
-- THE NUMBER ON THE SLAB.
--
-- A graded card is not just "PSA 10" -- it is ONE physical slab with a
-- number on its label, and that number is the key to the grading company's
-- own report. TAG's is the good one: scan it and you get a 3D view you can
-- rotate, eight subgrades, defect annotations, and a 360 video if the owner
-- paid for it. None of that is ours to rebuild, and none of it has to be.
-- We keep the number and link out.
--
-- OPTIONAL ON PURPOSE. Nobody is stopped from adding a card because they
-- have not got the slab in their hand, so this is nullable and nothing
-- anywhere requires it.
--
-- WHY THIS CHANGES HOW COPIES STACK. Two Near Mint commons are one row with
-- a quantity of 2. Two slabs are never that: they have two different
-- numbers. So a row carrying a cert is a row of exactly one, and the app
-- stops merging it into a stack. That rule lives in the app, not here --
-- this column just makes it possible.
--
-- SAFE TO RUN TWICE.
-- ============================================================

alter table public.user_cards
  add column if not exists cert_number text;

comment on column public.user_cards.cert_number is
  'The certification number printed on a graded slab, as the owner typed it. '
  'Null on raw cards and on graded cards nobody bothered to enter. A row with '
  'a cert is one physical slab, so it never merges with another row.';

-- Length only. NOT a format check: every grading company numbers its slabs
-- differently, TAG mixes a letter in with the digits, and a constraint that
-- guesses at the shape of a number is a constraint that rejects a real card
-- somebody is holding.
alter table public.user_cards
  drop constraint if exists user_cards_cert_number_len;
alter table public.user_cards
  add constraint user_cards_cert_number_len
  check (cert_number is null or char_length(btrim(cert_number)) between 3 and 24);

-- Finding a slab by its number, and catching the same slab entered twice.
create index if not exists user_cards_cert_idx
  on public.user_cards (cert_number)
  where cert_number is not null;

-- ============================================================
-- CHECK
-- ============================================================
select
  count(*)                                      as cards,
  count(*) filter (where cert_number is not null) as with_a_cert
from public.user_cards;
