-- ==========================================================
-- A RECEIPT THE CUSTOMER CAN ACTUALLY READ
-- ==========================================================
--
-- Run this AFTER shop_checkout.sql. Safe to run twice.
--
-- Paying used to end on Clover's own generic confirmation screen: a
-- number, a total, and no idea whose shop it was, where to collect it, or
-- what happens next. For a pickup order that is the one screen that
-- actually matters -- it is the one telling somebody to get in a car.
--
-- WHY THE NAME AND PRICE ARE COPIED ONTO THE HOLD
--
-- A receipt has to keep saying the same thing next week. shop_inventory
-- is a mirror of the till and gets rewritten on every sync -- prices
-- change, and a sold-out line can disappear from it entirely. Reading a
-- receipt through a live join would quietly rewrite history, or show a
-- blank where the card used to be. So what was bought, and what was paid
-- for it, are written down at the moment of sale and never touched
-- again.

alter table public.shop_holds add column if not exists item_name text;
alter table public.shop_holds add column if not exists unit_price numeric;

comment on column public.shop_holds.item_name is
  'The item name as it was at the moment of sale. Copied, not joined -- a receipt has to keep saying the same thing after the catalogue moves on.';

/* WHAT THE THANK-YOU PAGE IS ALLOWED TO SEE.
   The hold id is a random uuid handed to exactly one browser. There is
   nothing personal in a hold -- no name, no address, no card, none of it
   ever touches this database -- so the worst a guessed id could reveal is
   that somebody, somewhere, bought a $4 Funko. */
create or replace function public.shop_order_summary(p_hold uuid)
returns table (
  item_name  text,
  unit_price numeric,
  qty        int,
  fulfilment text,
  status     text,
  placed_at  timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    coalesce(h.item_name, i.name, 'Your order'),
    coalesce(h.unit_price, i.price),
    h.qty,
    h.fulfilment,
    h.status,
    h.created_at
  from public.shop_holds h
  left join public.shop_inventory i on i.clover_item_id = h.clover_item_id
  where h.id = p_hold
$$;

grant execute on function public.shop_order_summary(uuid) to anon, authenticated;

/* Set by create-checkout the moment the hold is taken, so the receipt is
   complete before the customer has even seen a payment page. */
create or replace function public.stamp_hold_item(
  p_hold  uuid,
  p_name  text,
  p_price numeric
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.shop_holds
     set item_name  = coalesce(nullif(trim(p_name), ''), item_name),
         unit_price = coalesce(p_price, unit_price)
   where id = p_hold
$$;

revoke all on function public.stamp_hold_item(uuid, text, numeric) from public, anon, authenticated;
