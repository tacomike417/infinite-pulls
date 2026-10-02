-- ============================================================
-- INFINITE PULLS: THE AFFILIATE WAITLIST. 2 Oct 2026 (Mike + Jeff).
-- Run in the INFINITE PULLS Supabase project. SAFE TO RUN TWICE.
--
-- "The affiliate program is currently closed, but the next affiliate drop is
-- coming Jan 1, and you can get your name in the queue now. You have to fill
-- out your socials, how many followers you currently have, how many people
-- you think you can bring to the table."
--
-- The page is infinitepulls.com/affiliates. Anybody can ADD their name (signed
-- in or not). Nobody can read the list from the site: you read it in Supabase
-- (Table Editor -> affiliate_waitlist). One entry per email.
-- ============================================================

create table if not exists public.affiliate_waitlist (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null check (char_length(btrim(name)) between 2 and 80),
  email      text not null check (char_length(email) <= 160 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  username   text check (username is null or char_length(username) <= 40),
  socials    jsonb not null default '{}'::jsonb check (pg_column_size(socials) < 3000),
  followers  integer not null default 0 check (followers between 0 and 500000000),
  can_bring  integer check (can_bring is null or can_bring between 0 and 100000000),
  note       text check (note is null or char_length(note) <= 600),
  user_id    uuid default auth.uid()
);
create unique index if not exists affiliate_waitlist_email on public.affiliate_waitlist (lower(email));

alter table public.affiliate_waitlist enable row level security;
revoke all on public.affiliate_waitlist from anon, authenticated;
grant insert on public.affiliate_waitlist to anon, authenticated;

drop policy if exists "anybody can get in the queue" on public.affiliate_waitlist;
create policy "anybody can get in the queue" on public.affiliate_waitlist
  for insert to anon, authenticated with check (user_id is null or user_id = auth.uid());

-- check: should say ready
select 'affiliate waitlist ready' as status, (select count(*) from public.affiliate_waitlist) as in_the_queue;
