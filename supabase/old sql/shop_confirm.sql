-- ==========================================================
-- MARKING AN ORDER PAID WHEN THE CUSTOMER COMES BACK
-- ==========================================================
--
-- Run this AFTER shop_checkout.sql, shop_receipt.sql and shop_orders.sql.
-- Safe to run twice.
--
-- WHY THIS EXISTS INSTEAD OF THE WEBHOOK
--
-- The webhook is set up, Clover verified the URL green in its own
-- dashboard, and it has never once been called on a real payment. Stock
-- drops, the money lands, the customer gets sent to the thank-you page --
-- and nothing arrives. So the only reliable signal we actually have is
-- the customer's browser being redirected to the success URL.
--
-- WHAT THIS TRUSTS, AND WHAT IT CANNOT DO
--
-- It trusts a browser, which is weaker than a signed webhook, so it is
-- fenced in hard:
--
--   * it only ever moves a hold from `held` to `paid` -- it cannot create
--     an order, cannot change an amount, cannot touch anything else
--   * the hold must be less than 30 minutes old, so an id kept from last
--     week is worthless
--   * it needs the hold's random uuid, which was handed to one browser
--
-- The worst somebody can do by faking it is mark THEIR OWN held item as
-- sold -- which takes it off the shelf, gains them nothing, and costs
-- them the thing they were trying to buy. No money moves here; Clover's
-- Sales activity is the record of what was actually paid, and Jeff can
-- cross-check any row against it in seconds.
--
-- The webhook path is left in place and is idempotent. If Clover ever
-- starts calling, it simply confirms what this already recorded.

create or replace function public.confirm_order(p_hold uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.shop_holds
     set status  = 'paid',
         paid_at = coalesce(paid_at, now())
   where id = p_hold
     and status = 'held'
     and created_at > now() - interval '30 minutes';
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

grant execute on function public.confirm_order(uuid) to anon, authenticated;
