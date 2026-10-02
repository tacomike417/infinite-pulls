-- ============================================================
-- INFINITE PULLS: MY INVITE STATS. 2 Oct 2026 (Mike).
-- Run in the INFINITE PULLS Supabase project. SAFE TO RUN TWICE.
-- Run affiliate_waitlist.sql before this one (it reads that table).
--
-- "They have a little stats page on how many sign ups they've given. Once in
-- the affiliate program, all people who upgrade their account start making
-- them money."
--
-- invite_stats() answers, for whoever is signed in:
--   total        everybody who joined from their link, ever
--   in_queue     are they in the affiliate queue
--   queue_at     the day they got in the queue (that's when their count starts)
--   since_queue  how many joined from their link since that day
--   recent       the last 20 people who joined from their link
--   upgraded / earned   0 for now: there is nothing to upgrade to until 2027
-- Only your own numbers. Nobody can ask for somebody else's.
-- ============================================================

create or replace function public.invite_stats()
returns json language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); uname text; q timestamptz; total int; since int; recent json;
begin
  if me is null then return null; end if;
  select username into uname from profiles where id = me;
  select min(w.created_at) into q from affiliate_waitlist w
   where w.user_id = me or (uname is not null and lower(w.username) = lower(uname));
  select count(*)::int into total from profiles where invited_by = me;
  select count(*)::int into since from profiles p join auth.users u on u.id = p.id
   where p.invited_by = me and q is not null and u.created_at >= q;
  select coalesce(json_agg(r), '[]'::json) into recent from (
    select p.username, u.created_at as joined_at
      from profiles p join auth.users u on u.id = p.id
     where p.invited_by = me order by u.created_at desc limit 20) r;
  return json_build_object('total', total, 'in_queue', q is not null, 'queue_at', q,
                           'since_queue', coalesce(since, 0), 'recent', recent, 'upgraded', 0, 'earned', 0);
end $$;

revoke all on function public.invite_stats() from public, anon;
grant execute on function public.invite_stats() to authenticated;

-- check: should say ready
select 'invite stats ready' as status;
