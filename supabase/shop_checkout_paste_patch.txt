-- ==========================================================
-- SAVING THE PAYMENT SETTINGS ONE PIECE AT A TIME
-- ==========================================================
--
-- Run this AFTER shop_checkout.sql. It replaces two functions and
-- changes nothing else. Safe to run twice.
--
-- WHY IT HAD TO CHANGE
--
-- Setting payments up is not one form filled in once. It is: paste the
-- key, save, go to Clover, generate a signing secret there, come back,
-- paste the secret. Two visits, and the key cannot be read back out of
-- the database on the second one -- that is the whole point of how it is
-- stored.
--
-- The first version wanted all three values at once, so saving the
-- secret meant typing the key again from wherever it had been left
-- lying. Now a blank field means LEAVE THAT ONE ALONE, and each piece
-- can be saved on its own visit.
--
-- Disconnecting is its own function rather than "save three blanks",
-- because turning payments off is a decision and should look like one.

create or replace function public.clover_save_ecom(
  p_merchant_id    text default null,
  p_private_token  text default null,
  p_webhook_secret text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  mid text := nullif(trim(coalesce(p_merchant_id, '')), '');
  tok text := nullif(trim(coalesce(p_private_token, '')), '');
  sec text := nullif(trim(coalesce(p_webhook_secret, '')), '');
begin
  if not public.is_shop_staff() then
    raise exception 'Not allowed';
  end if;

  if mid is null and tok is null and sec is null then
    return;   -- nothing to do; not a disconnect, that has its own door
  end if;

  insert into public.clover_ecom (id, merchant_id, private_token, webhook_secret, updated_at)
  values (1, mid, tok, sec, now())
  on conflict (id) do update set
    -- COALESCE, not EXCLUDED. A blank box means "I am not changing this
    -- one", which is what lets the secret be saved on a second visit
    -- without the key having to be written down somewhere first.
    merchant_id    = coalesce(excluded.merchant_id,    public.clover_ecom.merchant_id),
    private_token  = coalesce(excluded.private_token,  public.clover_ecom.private_token),
    webhook_secret = coalesce(excluded.webhook_secret, public.clover_ecom.webhook_secret),
    updated_at     = now();
end;
$$;

grant execute on function public.clover_save_ecom(text, text, text) to authenticated;

create or replace function public.clover_disconnect_ecom()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_staff() then
    raise exception 'Not allowed';
  end if;
  delete from public.clover_ecom where id = 1;
end;
$$;

grant execute on function public.clover_disconnect_ecom() to authenticated;
