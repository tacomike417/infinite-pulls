-- ============================================================
-- THE SHARE DESK -- 4 Oct 2026 (Mike: "same thing for infinite loops. im the
-- social media manager too for both so i just need to keep this straight").
--
-- One small table: which Loop or photo post, which place, when it was ticked.
-- Only moderators can read it or write it. The page is /share-desk/.
--   item  = 'loop:<id>' or 'photo:<id>'
--   place = 'instagram', 'facebook', or 'skip' (archived without sharing)
--
-- SAFE TO RUN TWICE.
-- ============================================================

create table if not exists public.share_desk (
  item     text not null check (item ~ '^(loop|photo):[0-9a-f-]{36}$'),
  place    text not null check (place in ('instagram', 'facebook', 'skip')),
  done_at  timestamptz not null default now(),
  done_by  uuid default auth.uid() references auth.users(id) on delete set null,
  primary key (item, place)
);
alter table public.share_desk enable row level security;

drop policy if exists "moderators run the share desk" on public.share_desk;
create policy "moderators run the share desk" on public.share_desk
  for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

grant select, insert, update, delete on public.share_desk to authenticated;

-- A correct result: one row, status 'share desk: ok', and mike_is_a_moderator = true.
select 'share desk: ok' as status,
       exists (select 1 from public.moderators m join public.profiles p on p.id = m.user_id
                where lower(p.username) = 'tacomike417') as mike_is_a_moderator;
