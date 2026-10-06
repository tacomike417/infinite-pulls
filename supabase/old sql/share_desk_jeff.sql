-- ============================================================
-- INFINITE PULLS: HYDE-BOT GETS THE VIDEOS. 6 Oct 2026.
-- Run in the INFINITE PULLS Supabase project. SAFE TO RUN TWICE.
--
-- Hyde-Bot (/post/) now shows the shop account its own Loops, one at a
-- time, to put on TikTok and YouTube by hand. It ticks the same share_desk
-- rows the Share Desk page shows. Until now only moderators could touch
-- that table, and the shop's login is not a moderator.
--
-- So: whoever OWNS a Loop may read that Loop's ticks, and may add or take
-- back three of them on it: 'tiktok', 'youtube', and 'jeff_skip' (he passed
-- on this one). Nothing else. Moderators keep everything they had.
-- ============================================================
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.share_desk'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%instagram%'
  loop execute format('alter table public.share_desk drop constraint %I', c); end loop;
  alter table public.share_desk add constraint share_desk_place_check
    check (place in ('instagram', 'story', 'facebook', 'tiktok', 'youtube', 'skip', 'jeff_skip'));
end $$;

create or replace function public.share_desk_mine(p_item text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_loops l
                  where 'loop:' || l.id::text = p_item and l.user_id = auth.uid());
$$;
revoke all on function public.share_desk_mine(text) from public;
grant execute on function public.share_desk_mine(text) to authenticated;

drop policy if exists "owner reads ticks on own loops" on public.share_desk;
create policy "owner reads ticks on own loops" on public.share_desk
  for select to authenticated using (public.share_desk_mine(item));

drop policy if exists "owner ticks tiktok and youtube on own loops" on public.share_desk;
create policy "owner ticks tiktok and youtube on own loops" on public.share_desk
  for insert to authenticated
  with check (place in ('tiktok', 'youtube', 'jeff_skip') and public.share_desk_mine(item));

drop policy if exists "owner changes tiktok and youtube ticks on own loops" on public.share_desk;
create policy "owner changes tiktok and youtube ticks on own loops" on public.share_desk
  for update to authenticated
  using (place in ('tiktok', 'youtube', 'jeff_skip') and public.share_desk_mine(item))
  with check (place in ('tiktok', 'youtube', 'jeff_skip') and public.share_desk_mine(item));

drop policy if exists "owner takes back tiktok and youtube on own loops" on public.share_desk;
create policy "owner takes back tiktok and youtube on own loops" on public.share_desk
  for delete to authenticated
  using (place in ('tiktok', 'youtube', 'jeff_skip') and public.share_desk_mine(item));

-- A correct result: one row. status says 'hyde-bot videos: ok', policies = 5,
-- and shop_loops is how many videos the shop account has (about 30).
select 'hyde-bot videos: ok' as status,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'share_desk') as policies,
       (select count(*) from public.user_loops l join public.profiles p on p.id = l.user_id
         where lower(p.username) = 'infinitepullstcg' and l.status = 'ready') as shop_loops;
