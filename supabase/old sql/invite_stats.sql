-- ============================================================
-- INFINITE PULLS: AFFILIATES + MY INVITE STATS. 2 Oct 2026 (Mike).
-- Run in the INFINITE PULLS Supabase project. SAFE TO RUN TWICE.
-- Run affiliate_waitlist.sql before this one (it reads that table).
--
-- "They have a little stats page on how many sign ups they've given. Once in
-- the affiliate program, all people who upgrade their account start making
-- them money."  /  "Make me an affiliate."
--
-- 1. WHO IS AN AFFILIATE: the affiliates table. Being on the waiting list does
--    NOT make somebody an affiliate; being in this table does. Mike is the
--    first one in. To make somebody an affiliate:
--      insert into public.affiliates (user_id) select id from public.profiles where username = 'TheirName' on conflict do nothing;
--    To take it back:
--      delete from public.affiliates where user_id = (select id from public.profiles where username = 'TheirName');
-- 2. invite_stats() answers, for whoever is signed in (only their own numbers):
--      total            everybody who joined from their link, ever
--      is_affiliate     are they in the program, and since when
--      in_queue         are they on the waiting list, and since when
--      since_start      sign-ups since they got in the queue (or became an affiliate, if earlier)
--      recent           the last 20 people who joined from their link
--      upgraded/earned  0 for now: there is nothing to upgrade to until 2027
-- ============================================================

create table if not exists public.affiliates (
  user_id uuid primary key references auth.users(id) on delete cascade,
  since   timestamptz not null default now()
);
alter table public.affiliates enable row level security;      -- no policies: nobody reads it from the app
revoke all on public.affiliates from anon, authenticated;

insert into public.affiliates (user_id)
select id from public.profiles where lower(username) = 'tacomike417'
on conflict do nothing;

create or replace function public.invite_stats()
returns json language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); uname text; q timestamptz; a timestamptz; start_at timestamptz; total int; since int; recent json;
begin
  if me is null then return null; end if;
  select username into uname from profiles where id = me;
  select min(w.created_at) into q from affiliate_waitlist w
   where w.user_id = me or (uname is not null and lower(w.username) = lower(uname));
  select f.since into a from affiliates f where f.user_id = me;
  start_at := least(q, a);                         -- least() skips the one that is null
  select count(*)::int into total from profiles where invited_by = me;
  select count(*)::int into since from profiles p join auth.users u on u.id = p.id
   where p.invited_by = me and start_at is not null and u.created_at >= start_at;
  select coalesce(json_agg(r), '[]'::json) into recent from (
    select p.username, u.created_at as joined_at
      from profiles p join auth.users u on u.id = p.id
     where p.invited_by = me order by u.created_at desc limit 20) r;
  return json_build_object('total', total, 'is_affiliate', a is not null, 'affiliate_since', a,
                           'in_queue', q is not null, 'queue_at', q, 'start_at', start_at,
                           'since_start', coalesce(since, 0), 'since_queue', coalesce(since, 0),
                           'recent', recent, 'upgraded', 0, 'earned', 0);
end $$;

revoke all on function public.invite_stats() from public, anon;
grant execute on function public.invite_stats() to authenticated;

-- check: should say ready, with affiliates at 1 (tacomike417)
select 'invite stats ready' as status, (select count(*) from public.affiliates) as affiliates;
