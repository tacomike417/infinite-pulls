-- ==========================================================
-- TELLING JEFF SOMETHING SOLD
-- ==========================================================
--
-- Run this AFTER shop_checkout.sql and shop_receipt.sql. Safe to run
-- twice.
--
-- Everything up to here worked and still left the most important person
-- out. Somebody pays at nine at night: the stock drops, the card leaves
-- the website, the customer gets a receipt -- and the shop is told
-- nothing. A card sits in a box waiting to be posted to somebody who is
-- already wondering where it is, or a pickup order nobody has set aside.
-- An order nobody hears about is an order that never ships.
--
-- WHAT THIS IS NOT
--
-- It is not a copy of the customer's details. Their name, address, email
-- and card stay with Clover, where they belong and where they are
-- protected properly -- Clover's own Orders screen has all of it. This
-- is the shop's working list: what sold, when, whether it is being
-- posted or collected, and whether anybody has dealt with it yet.

alter table public.shop_holds add column if not exists handled_at timestamptz;

comment on column public.shop_holds.handled_at is
  'When shop staff ticked this order off as dealt with. Null means it is still waiting.';

-- Finding the waiting ones is the question this table gets asked most.
create index if not exists shop_holds_waiting
  on public.shop_holds (status, handled_at, paid_at desc);

/* THE LIST JEFF READS.
   Paid orders, newest first, waiting ones first of all -- because the
   whole point is to make the unfinished ones impossible to miss. */
create or replace function public.shop_orders(p_limit int default 40)
returns table (
  id         uuid,
  item_name  text,
  unit_price numeric,
  qty        int,
  fulfilment text,
  paid_at    timestamptz,
  handled_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_shop_staff() then
    raise exception 'Not allowed';
  end if;

  return query
  select h.id,
         coalesce(h.item_name, i.name, 'Item'),
         coalesce(h.unit_price, i.price),
         h.qty, h.fulfilment, h.paid_at, h.handled_at
  from public.shop_holds h
  left join public.shop_inventory i on i.clover_item_id = h.clover_item_id
  where h.status = 'paid'
  order by (h.handled_at is null) desc, h.paid_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 200);
end;
$$;

grant execute on function public.shop_orders(int) to authenticated;

/* HOW MANY ARE STILL WAITING.
   One number, cheap enough to ask for on every admin page load, so the
   Clover tab can carry a count and Jeff never has to go looking. */
create or replace function public.shop_orders_waiting()
returns int
language sql
security definer
set search_path = public
stable
as $$
  select case when public.is_shop_staff()
    then (select count(*)::int from public.shop_holds
           where status = 'paid' and handled_at is null)
    else 0 end
$$;

grant execute on function public.shop_orders_waiting() to authenticated;

/* TICKING ONE OFF, AND UNTICKING IT.
   Reversible on purpose: the wrong row gets tapped on a phone in a busy
   shop, and a list you cannot correct is one people stop trusting. */
create or replace function public.mark_order_handled(p_hold uuid, p_done boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_staff() then
    raise exception 'Not allowed';
  end if;
  update public.shop_holds
     set handled_at = case when p_done then now() else null end
   where id = p_hold and status = 'paid';
end;
$$;

grant execute on function public.mark_order_handled(uuid, boolean) to authenticated;
