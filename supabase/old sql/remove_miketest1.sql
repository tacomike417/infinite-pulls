-- REMOVE THE TEST ACCOUNT miketest1 (5 Oct 2026). Mike made it to test the fast join.
-- Only touches an account that is named miketest1 AND has the fast-join stand-in email,
-- so it cannot hit a real member. Run it once in the Supabase SQL box.
with gone as (
  delete from auth.users u
  using public.profiles p
  where p.id = u.id
    and lower(p.username) = 'miketest1'
    and u.email = 'miketest1@noemail.infinitepulls.com'
  returning u.id
)
select case when count(*) = 1 then 'miketest1 removed' else 'nothing removed (' || count(*) || ' found)' end as status from gone;
