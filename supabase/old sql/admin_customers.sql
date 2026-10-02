-- ============================================================
-- CUSTOMERS — the named lists behind the four numbers on
--     The Shop at a Glance.
--
--     WHAT CHANGED, AND WHY IT IS A DECISION AND NOT A TWEAK
--
--     shop_stats() returns counts only. Its header says so in as
--     many words: "an admin sees how many, never who." That was
--     deliberate and it stays exactly as it is — that function is
--     untouched by this file.
--
--     6 Sep 2026 the shop asked to see who. A shop owner looking
--     at his own customers is ordinary and legitimate, so these
--     functions exist. They are a SEPARATE, deliberately narrow
--     door, not a loosening of the old one:
--
--       * staff only. Every function raises if the caller is not
--         in shop_staff. Not "returns nothing" — raises, so a
--         mistake is loud rather than an empty screen.
--       * NO EMAIL, NO CONTACT DETAILS, EVER. Everything here
--         comes from public.profiles and the customer's own card
--         rows. auth.users is never touched. If somebody ever
--         wants email in this panel, that is a new decision and
--         it belongs in a new file with its own argument.
--       * counts and card rows only. No sign-in times, no device
--         endpoints, no location, no behaviour log.
--
--     security definer because profiles is behind RLS. The staff
--     check is what makes that safe, so do not remove it.
--
--     Safe to re-run.
-- ============================================================


-- ============================================================
-- 1. THE LIST
--    scope: 'all' | 'new7' | 'collectors' | 'hunting'
--    Those four are the four tiles, in the order they appear.
-- ============================================================
create or replace function public.admin_customers(scope text default 'all')
returns table (
  user_id      uuid,
  username     text,
  avatar_url   text,
  created_at   timestamptz,
  is_public    boolean,
  cards_saved  bigint,
  cards_hunted bigint,
  goals        bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_shop_staff() then
    raise exception 'Customers is staff only.' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.username,
    p.avatar_url,
    p.created_at,
    coalesce(p.is_public, false),
    (select coalesce(sum(uc.quantity), 0) from public.user_cards uc where uc.user_id = p.id),
    (select count(*) from public.wishlist_cards w where w.user_id = p.id),
    (select count(*) from public.user_collector_goals g where g.user_id = p.id)
  from public.profiles p
  where case scope
          when 'new7'       then p.created_at > now() - interval '7 days'
          when 'collectors' then exists (select 1 from public.user_cards uc where uc.user_id = p.id)
          when 'hunting'    then exists (select 1 from public.wishlist_cards w where w.user_id = p.id)
          else true
        end
  order by p.created_at desc;
end;
$$;

grant execute on function public.admin_customers(text) to authenticated;


-- ============================================================
-- 2. ONE CUSTOMER'S COLLECTION
-- ============================================================
create or replace function public.admin_customer_cards(uid uuid)
returns table (
  card_id   text,
  card_name text,
  set_name  text,
  image_url text,
  variant   text,
  condition text,
  quantity  integer,
  added_at  timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_shop_staff() then
    raise exception 'Customers is staff only.' using errcode = '42501';
  end if;

  return query
  select uc.card_id, uc.card_name, uc.set_name, uc.image_url,
         uc.variant, uc.condition, uc.quantity, uc.added_at
    from public.user_cards uc
   where uc.user_id = uid
   order by uc.added_at desc;
end;
$$;

grant execute on function public.admin_customer_cards(uuid) to authenticated;


-- ============================================================
-- 3. ONE CUSTOMER'S WISH LIST
--    The commercially useful one: what somebody standing in the
--    shop is actually chasing.
-- ============================================================
create or replace function public.admin_customer_wishlist(uid uuid)
returns table (
  card_id   text,
  card_name text,
  set_name  text,
  image_url text,
  variant   text,
  condition text,
  quantity  integer,
  added_at  timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_shop_staff() then
    raise exception 'Customers is staff only.' using errcode = '42501';
  end if;

  return query
  select w.card_id, w.card_name, w.set_name, w.image_url,
         w.variant, w.condition, w.quantity, w.added_at
    from public.wishlist_cards w
   where w.user_id = uid
   order by w.added_at desc;
end;
$$;

grant execute on function public.admin_customer_wishlist(uuid) to authenticated;
