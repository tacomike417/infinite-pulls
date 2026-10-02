-- Infinite Pulls — cards scanned into inventory, waiting to reach Clover
-- =====================================================================
--
-- WHAT JEFF ASKED FOR
--
-- Scan a card at the counter, and have it end up in his POS inventory.
--
-- WHY IT GOES IN A TABLE FIRST INSTEAD OF STRAIGHT TO CLOVER
--
-- Clover's REST API refuses every token this account can generate --
-- confirmed against all four regions, both auth styles, and a token with
-- every permission ticked, all 401. Clover staff have said in their own
-- community that merchant-generated tokens cannot do this. So the API leg
-- is not available and is not something we can fix from here.
--
-- What IS available is Clover's bulk import: Inventory -> the three dots
-- -> Import Inventory, from a spreadsheet. So the scanning, the pricing
-- and the stacking all happen here, and the last step is a file he
-- imports in a few clicks.
--
-- This is deliberately NOT throwaway. The day a Clover token works, the
-- last step changes from "download a file" to "push these rows through
-- clover-add-item", which is already written and deployed. Everything
-- before it stays exactly as it is.
--
-- WHY IT IS NOT shop_inventory
--
-- shop_inventory is a MIRROR of what Clover says is on the shelf, wiped
-- and rewritten by the sync. This is a queue of things on their way TO
-- Clover. Mixing the two would mean the next successful sync silently
-- deleted a stack of cards nobody had imported yet.
--
-- SAFE TO RUN TWICE.

create table if not exists public.shop_scan_queue (
  id            uuid        primary key default gen_random_uuid(),
  scanned_at    timestamptz not null default now(),
  scanned_by    uuid        references auth.users(id) on delete set null,

  -- What the card is
  card_id       text,                    -- TCGdex id, so the row can be re-priced later
  name          text        not null,
  set_name      text,
  card_number   text,
  image_url     text,
  variant       text,

  -- What he is selling it for
  sku           text,
  price         numeric,                 -- his price, editable
  market_price  numeric,                 -- what it was worth when scanned, for reference
  quantity      integer     not null default 1,

  -- Where it has got to
  exported_at   timestamptz,             -- included in a downloaded sheet
  pushed_at     timestamptz              -- sent to Clover by API, if that ever works
);

create index if not exists shop_scan_queue_open
  on public.shop_scan_queue (scanned_at desc) where exported_at is null;

alter table public.shop_scan_queue enable row level security;

-- Shop staff only, in every direction. This is the shop's stock list and
-- its prices; no customer has any business reading or writing it.
drop policy if exists "staff read scan queue" on public.shop_scan_queue;
create policy "staff read scan queue"
  on public.shop_scan_queue for select
  to authenticated using (public.is_shop_staff());

drop policy if exists "staff write scan queue" on public.shop_scan_queue;
create policy "staff write scan queue"
  on public.shop_scan_queue for insert
  to authenticated with check (public.is_shop_staff());

drop policy if exists "staff update scan queue" on public.shop_scan_queue;
create policy "staff update scan queue"
  on public.shop_scan_queue for update
  to authenticated using (public.is_shop_staff()) with check (public.is_shop_staff());

drop policy if exists "staff delete scan queue" on public.shop_scan_queue;
create policy "staff delete scan queue"
  on public.shop_scan_queue for delete
  to authenticated using (public.is_shop_staff());

comment on table public.shop_scan_queue is
  'Cards scanned in the admin panel on their way into Clover inventory. Exported as a spreadsheet for Clover bulk import today; pushed through clover-add-item if the API ever accepts a token. Staff only.';
