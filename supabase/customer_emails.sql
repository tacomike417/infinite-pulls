-- ============================================================
-- CUSTOMER EMAILS (6 Nov 2026, Mike)
--
--     admin_customers.sql (now in old sql/) drew a line: no email
--     in the Customers tab. Its header said that if anybody ever
--     wanted email here it was a new decision for a new file.
--     This is that file.
--
--     6 Nov 2026 Mike decided: show every customer's email to
--     shop staff (Jeff and Mike), on every customer in the list.
--     Still staff only, still raises for anyone else. Still no
--     sign-in times, devices or location — email is the only
--     thing added, read from auth.users by the staff-gated
--     security-definer function.
--
--     Safe to re-run.
-- ============================================================

drop function if exists public.admin_customers(text);

create or replace function public.admin_customers(scope text default 'all')
returns table (
  user_id      uuid,
  username     text,
  avatar_url   text,
  created_at   timestamptz,
  is_public    boolean,
  cards_saved  bigint,
  cards_hunted bigint,
  goals        bigint,
  email        text
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
    (select count(*) from public.user_collector_goals g where g.user_id = p.id),
    u.email::text
  from public.profiles p
  left join auth.users u on u.id = p.id
  where case scope
          when 'new7'       then p.created_at > now() - interval '7 days'
          when 'collectors' then exists (select 1 from public.user_cards uc where uc.user_id = p.id)
          when 'hunting'    then exists (select 1 from public.wishlist_cards w where w.user_id = p.id)
          else true
        end
  order by p.created_at desc;
end;
$$;

revoke all on function public.admin_customers(text) from public;
grant execute on function public.admin_customers(text) to authenticated;
