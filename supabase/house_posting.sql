-- ============================================================
-- HOUSE POSTING -- what the house accounts have posted, so they never
-- repeat themselves, and whether each one is switched on.
--
-- The poster (tools/house/, run by .github/workflows/house-posts.yml)
-- signs in AS the house account and writes as it, so everything here is
-- scoped to auth.uid(): an account reads and writes only its own log.
-- No service key anywhere.
--
-- NEEDS supabase/house_accounts.sql first.
-- SAFE TO RUN TWICE.
-- ============================================================

create table if not exists public.house_post_log (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  kind       text not null,             -- e.g. 'mover'
  card_id    text,                      -- the card it was about, for no-repeats
  direction  text,                      -- 'up' / 'down'
  photo_id   uuid references public.user_photos(id) on delete set null,
  posted_at  timestamptz not null default now()
);

create index if not exists house_post_log_account_idx
  on public.house_post_log (account_id, posted_at desc);

alter table public.house_post_log enable row level security;

drop policy if exists "house accounts manage their own log" on public.house_post_log;
create policy "house accounts manage their own log"
  on public.house_post_log for all to authenticated
  using      (auth.uid() = account_id)
  with check (auth.uid() = account_id);

-- Is the signed-in house account switched ON in the master page?
-- (house_accounts has no API access of its own, so this is the one door.)
create or replace function public.house_is_active()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select active from public.house_accounts where user_id = auth.uid()),
    false);
$$;
grant execute on function public.house_is_active() to authenticated;

-- CHECK: should say true for TCGCardWatch being a house account.
select exists (select 1 from public.house_accounts h
                 join public.profiles p on p.id = h.user_id
                where p.username = 'TCGCardWatch') as tcgcardwatch_is_house;
