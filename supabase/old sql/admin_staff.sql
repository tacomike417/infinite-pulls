-- ============================================================
-- WHO CAN RUN THE SHOP
--
-- Run this in the Supabase SQL Editor whenever the staff list needs to
-- change. Safe to re-run as often as you like.
--
-- WHAT HAPPENED
--
-- admin_lockdown.sql shipped with one email in its list — mnasvadi@gmail.com
-- — and locking the panel to that list is exactly what it did. The shop's
-- own account was never on it, so it lost the admin panel the moment that
-- file ran. Nothing is broken; it simply was not told about Jeff.
--
-- This file exists so that never needs editing again. Add a name here,
-- run it, done.
--
-- ⚠ AN ACCOUNT HAS TO EXIST BEFORE IT CAN BE MADE STAFF. Staff are
--   matched by email against accounts that have already signed up. If an
--   email below has never been used to make an account, section 3 will
--   say so by name rather than failing quietly.
-- ============================================================


-- ============================================================
-- 1. THE STAFF LIST
--    Everyone who should be able to run the shop. This ADDS — it never
--    takes anybody off, so running it cannot lock the shop out.
--    Removing somebody is section 4, on purpose.
-- ============================================================
insert into public.shop_staff (user_id, label)
select u.id, u.email
  from auth.users u
 where lower(u.email) in (
   -- ⚠ EDIT THIS LIST ⚠  lower case, one per line, comma between them
   'infinitepullstcg@gmail.com',      -- the shop
   'mnasvadi@gmail.com'               -- Mike
 )
on conflict (user_id) do nothing;


-- ============================================================
-- 2. WHO IS STAFF NOW
--    This is the answer to "is Jeff back?". Every row here can open the
--    admin panel and save changes.
-- ============================================================
select s.label            as staff_email,
       u.email            as account_email,
       (u.email_confirmed_at is not null) as can_sign_in,
       u.last_sign_in_at,
       s.user_id
  from public.shop_staff s
  join auth.users u on u.id = s.user_id
 order by s.label;


-- ============================================================
-- 3. ANYTHING IN THE LIST THAT DID NOT MATCH AN ACCOUNT
--
--    Empty is what you want. A row here means that email has no account
--    yet — the address is misspelled, or the account was made with a
--    different one. Have them sign up first, then run this file again.
--    Nothing else needs doing.
-- ============================================================
with wanted(email) as (
  values
    ('infinitepullstcg@gmail.com'),
    ('mnasvadi@gmail.com')
)
select w.email as no_account_for_this_email
  from wanted w
 where not exists (select 1 from auth.users u where lower(u.email) = w.email);


-- ============================================================
-- 4. TAKING SOMEBODY OFF
--
--    Uncomment, put the email in, run it. The guard underneath refuses to
--    leave the staff list empty, because an empty list means nobody can
--    ever open the admin panel again and the only way back is SQL.
-- ============================================================
-- delete from public.shop_staff s
--  using auth.users u
--  where u.id = s.user_id
--    and lower(u.email) = 'someone@example.com';

do $$
declare n integer;
begin
  select count(*) into n from public.shop_staff;
  if n = 0 then
    raise exception 'The staff list is empty — nobody could open the admin panel. Nothing was committed.';
  end if;
  raise notice 'Staff list: % account(s).', n;
end $$;
