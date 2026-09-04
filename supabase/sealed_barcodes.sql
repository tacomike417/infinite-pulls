-- Infinite Pulls — sealed product, identified by barcode
-- =====================================================
--
-- WHY A BARCODE AND NOT THE WORDS ON THE BOX
--
-- The first version of sealed scanning read the set name off the packaging
-- with OCR. That was the best available answer when text was all we had,
-- and it is the wrong answer now, because the things that matter most
-- about sealed product are invisible to text:
--
--   A Pokemon Center Elite Trainer Box and an ordinary Elite Trainer Box
--   carry the same set name, the same product type and nearly the same
--   artwork. They are different products at different prices. Their
--   BARCODES differ.
--
--   So do a reprint wave, a Japanese box beside its English twin, and a
--   warehouse bundle beside the single box inside it.
--
-- A barcode is exact, instant, and printed on everything.
--
-- WHY THIS TABLE FILLS ITSELF
--
-- There is no free database mapping Pokemon UPCs to products. Rather than
-- pay for one or do without, the shop builds its own: the first time a
-- barcode is unknown, whoever is holding the box names it once. Every scan
-- of that barcode afterwards is instant and exact.
--
-- A shop carries perhaps thirty to fifty sealed lines, so this is complete
-- within a week of ordinary use -- and it is complete for THIS shop, with
-- the products actually stocked and the prices actually charged. It costs
-- nothing, has no rate limit, and cannot 404.
--
-- THE BARCODE IS THE KEY, AND THE SET CODE IS NOT.
--
-- Deliberately following the rule that a set code identifies an expansion,
-- never a product: one set spawns booster boxes, ETBs, Pokemon Center
-- ETBs, tins, blisters and bundles, and they are different things. The
-- primary key here is the barcode, which is unique per exact variation.
--
-- SAFE TO RUN TWICE.

create table if not exists public.sealed_barcodes (
  barcode         text        primary key,

  -- What it is
  product_name    text        not null,
  product_type    text,                   -- booster box, ETB, tin, blister...
  set_name        text,
  set_code        text,
  language        text        not null default 'English',
  region          text,

  -- What separates it from the one that looks just like it
  artwork_variant text,
  print_wave      text,
  pack_count      integer,
  included_promo  text,

  -- What the shop does with it
  price           numeric,                -- the shop's price
  market_price    numeric,                -- reference, if we ever have one
  image_url       text,

  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  added_by        uuid        references auth.users(id) on delete set null,
  notes           text
);

create index if not exists sealed_barcodes_name
  on public.sealed_barcodes (product_name);

alter table public.sealed_barcodes enable row level security;

-- Readable by anyone signed in: it is a product catalogue, and the app's
-- shop page is meant to show it. Written by staff only -- a customer does
-- not get to decide what a booster box costs.
drop policy if exists "sealed barcodes readable" on public.sealed_barcodes;
create policy "sealed barcodes readable"
  on public.sealed_barcodes for select
  to authenticated using (true);

drop policy if exists "staff write sealed barcodes" on public.sealed_barcodes;
create policy "staff write sealed barcodes"
  on public.sealed_barcodes for insert
  to authenticated with check (public.is_shop_staff());

drop policy if exists "staff update sealed barcodes" on public.sealed_barcodes;
create policy "staff update sealed barcodes"
  on public.sealed_barcodes for update
  to authenticated using (public.is_shop_staff()) with check (public.is_shop_staff());

drop policy if exists "staff delete sealed barcodes" on public.sealed_barcodes;
create policy "staff delete sealed barcodes"
  on public.sealed_barcodes for delete
  to authenticated using (public.is_shop_staff());

comment on table public.sealed_barcodes is
  'The shop''s own sealed-product catalogue, keyed on the barcode because that is what distinguishes a Pokemon Center ETB from a regular one. Fills itself: an unknown barcode is named once by staff and known forever after.';
