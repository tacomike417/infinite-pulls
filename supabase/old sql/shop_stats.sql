-- ============================================================
-- SHOP STATS — the numbers already sitting in the database,
--     added up for the panel at the top of the admin.
--
--     Nothing new is collected and nothing new is stored. This
--     only counts rows that already exist because customers
--     used the app.
--
--     security definer for the same reason shop_wishlist_demand
--     is: push_subscriptions has no public select policy at all,
--     and profiles is behind RLS. This returns COUNTS ONLY —
--     never a row, a name, an endpoint or an email — so an
--     admin sees how many, never who.
--
--     Safe to re-run.
-- ============================================================
create or replace function public.shop_stats()
returns table (
  customers            bigint,
  customers_new_7d     bigint,
  customers_new_30d    bigint,
  public_pages         bigint,
  notify_devices       bigint,
  collectors_with_cards bigint,
  cards_tracked        bigint,
  different_cards      bigint,
  customers_hunting    bigint,
  cards_wanted         bigint,
  goals_being_chased   bigint,
  shop_items           bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*) from public.profiles),
    (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    (select count(*) from public.profiles where created_at > now() - interval '30 days'),
    (select count(*) from public.profiles where is_public),
    (select count(*) from public.push_subscriptions),
    (select count(distinct user_id) from public.user_cards),
    (select coalesce(sum(quantity), 0) from public.user_cards),
    (select count(distinct card_id) from public.user_cards),
    (select count(distinct user_id) from public.wishlist_cards),
    (select count(distinct card_id) from public.wishlist_cards),
    (select count(*) from public.user_collector_goals),
    (select count(*) from public.shop_inventory);
$$;

grant execute on function public.shop_stats() to authenticated;
