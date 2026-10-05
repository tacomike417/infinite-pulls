-- ============================================================
-- INFINITE PULLS: THE SHARE DESK GETS A YOUTUBE TICK. 5 Oct 2026.
-- Run in the INFINITE PULLS Supabase project. SAFE TO RUN TWICE.
-- Lets the share desk remember "I put this Loop on YouTube". Nothing already ticked changes.
-- ============================================================
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.share_desk'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%instagram%'
  loop execute format('alter table public.share_desk drop constraint %I', c); end loop;
  alter table public.share_desk add constraint share_desk_place_check
    check (place in ('instagram', 'facebook', 'youtube', 'skip'));
end $$;

-- A correct result: one row that says 'share desk youtube: ok'.
select 'share desk youtube: ok' as status, (select count(*) from public.share_desk) as ticks_so_far;
