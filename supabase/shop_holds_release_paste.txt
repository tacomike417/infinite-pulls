-- ==========================================================
-- GIVING A CARD BACK THE MOMENT SOMEBODY WALKS AWAY
-- ==========================================================
--
-- Run this AFTER shop_checkout.sql. Safe to run twice.
--
-- WHAT WENT WRONG
--
-- A hold is taken before the customer ever sees a payment page, which is
-- correct -- it is the only thing standing between two people and the
-- same one-of-one card. But the only way a hold ended was PAID or twenty
-- minutes of silence. So anybody who looked at the Clover page and
-- changed their mind took the card off the shelf for twenty minutes, and
-- the next person to want it was told it was gone. Found the first time
-- this was tested: three trips to the payment page, no purchase, and the
-- card unbuyable.
--
-- Clover sends the customer back to a cancel URL when they back out. All
-- this needs is a door for the page to say "they left, put it back".
--
-- WHY release_shop_hold() TAKES AN ID AND CHECKS NOTHING ELSE
--
-- The id is a random uuid handed to one browser and stored nowhere a
-- stranger can reach. Guessing one is not a realistic attack, and the
-- worst it would do is put a card back on sale a few minutes early --
-- which is the safe direction to fail in. It cannot release a hold that
-- has been PAID, which is the one that would matter.

create or replace function public.release_shop_hold(p_hold uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.shop_holds
     set status = 'released'
   where id = p_hold
     and status = 'held';       -- never a paid one
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- The shopper's own browser calls this, so anon needs it. It can only
-- ever free something up, never take anything.
grant execute on function public.release_shop_hold(uuid) to anon, authenticated;

/* FIFTEEN MINUTES, NOT TWENTY.
   A Clover checkout session expires after 15, so a hold outliving it by
   five was five minutes of holding a card for a payment page that had
   already died. Matched to the thing it is actually waiting for. */
create or replace function public.claim_shop_item(
  p_item_id    text,
  p_qty        int  default 1,
  p_fulfilment text default 'pickup'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  have   int;
  held   int;
  new_id uuid;
begin
  if coalesce(p_qty, 0) < 1 then return null; end if;

  select i.stock_count into have
  from public.shop_inventory i
  where i.clover_item_id = p_item_id
  for update;

  if have is null then return null; end if;

  select coalesce(sum(h.qty), 0) into held
  from public.shop_holds h
  where h.clover_item_id = p_item_id
    and (h.status = 'paid' or (h.status = 'held' and h.expires_at > now()));

  if have - held < p_qty then return null; end if;

  insert into public.shop_holds (clover_item_id, qty, fulfilment, expires_at)
  values (p_item_id, p_qty,
          case when p_fulfilment = 'ship' then 'ship' else 'pickup' end,
          now() + interval '15 minutes')
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.claim_shop_item(text, int, text) from public, anon, authenticated;

/* A BUTTON FOR WHOEVER IS STANDING THERE.
   Testing leaves holds behind, and so will the first odd afternoon in
   the shop. Rather than somebody needing the SQL editor to unstick a
   card, staff can clear every live hold from the admin panel. */
create or replace function public.release_all_shop_holds()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare n bigint;
begin
  if not public.is_shop_staff() then
    raise exception 'Not allowed';
  end if;
  update public.shop_holds set status = 'released' where status = 'held';
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.release_all_shop_holds() to authenticated;
