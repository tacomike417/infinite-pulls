-- ============================================================
-- PHONE ALERT WHEN SOMETHING SELLS ON THE WEBSITE -- 29 Sep 2026 (Mike).
--
-- The moment an online order is marked paid (a whole basket or a single
-- card), every shop staff phone with notifications on gets:
--
--     🛒 Sold online: $54.00
--     Charizard ex, Pikachu +1 more · SHIP IT · address in Clover
--
-- Tapping it opens the admin panel's Clover tab, where the order list is.
-- One alert per order (alerted_at), however many cards were in it and
-- however many times Clover repeats itself.
--
-- The customer's name and address stay in Clover (never copied here).
-- Run AFTER deploying push-out (the steps say so). SAFE TO RUN TWICE.
-- ============================================================

alter table public.shop_holds add column if not exists alerted_at timestamptz;

create or replace function public.shop_hold_paid_alert()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and new.alerted_at is null then
    begin
      perform net.http_post(
        url     := 'https://rrkyvcouxdmurwdyuugv.functions.supabase.co/push-out',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body    := jsonb_build_object('shop_order', coalesce(new.order_ref::text, new.id::text))
      );
    exception when others then null;   -- an alert that can't go out never stops a sale
    end;
  end if;
  return new;
end;
$$;
drop trigger if exists shop_hold_paid_alert on public.shop_holds;
create trigger shop_hold_paid_alert after update of status on public.shop_holds
  for each row execute function public.shop_hold_paid_alert();

-- Who will get it: staff, and whether their phone has notifications on.
select p.username, s.label, (select count(*) from public.push_subscriptions ps where ps.user_id = s.user_id) as phones_with_alerts
  from public.shop_staff s left join public.profiles p on p.id = s.user_id
 order by 1;
