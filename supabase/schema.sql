-- Infinite Pulls — Banner + Push Notifications schema
-- Run this once in your Supabase project's SQL Editor (Database > SQL Editor > New query).
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT DO NOTHING where possible.

-- ============================================================
-- 1. BANNER — single row the admin panel edits, the app reads.
--    "updated_at" changes every time the admin publishes, which
--    is what makes a visitor's "closed" state expire automatically.
-- ============================================================
create table if not exists public.banner (
  id smallint primary key default 1,
  message text not null default '',
  active boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint banner_singleton check (id = 1)
);

insert into public.banner (id, message, active)
values (1, '', false)
on conflict (id) do nothing;

-- Auto-update "updated_at" any time the row is edited, so the
-- admin panel never has to set it manually (and can't forget to).
create or replace function public.set_banner_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists banner_set_updated_at on public.banner;
create trigger banner_set_updated_at
  before update on public.banner
  for each row
  execute function public.set_banner_updated_at();

alter table public.banner enable row level security;

drop policy if exists "public read banner" on public.banner;
create policy "public read banner"
  on public.banner for select
  to anon, authenticated
  using (true);

drop policy if exists "admin update banner" on public.banner;
create policy "admin update banner"
  on public.banner for update
  to authenticated
  using (true)
  with check (true);

-- ============================================================
-- 2. PUSH SUBSCRIPTIONS — one row per device that opts in.
--    Endpoint URLs act like a secret token already, and hold no
--    personal info, so public insert/update is fine. There is
--    deliberately NO public select/delete policy: only the
--    service-role key (used inside the Edge Function, never in
--    the browser) can read or clean these up.
-- ============================================================
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "public insert subscription" on public.push_subscriptions;
create policy "public insert subscription"
  on public.push_subscriptions for insert
  to anon, authenticated
  with check (true);

drop policy if exists "public update own subscription" on public.push_subscriptions;
create policy "public update own subscription"
  on public.push_subscriptions for update
  to anon, authenticated
  using (true)
  with check (true);

-- Visitors write through this function instead of hitting the table
-- directly. It runs with the function owner's privileges (this project's
-- table-owning role), so Postgres never needs to grant the caller read
-- access just to process the write — sidesteps a rough edge in how
-- upsert-with-conflict-handling requests get built, and keeps things
-- working the same regardless of which Supabase API key format is used.
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.push_subscriptions (endpoint, p256dh, auth)
  values (p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do nothing;
end;
$$;

grant execute on function public.save_push_subscription(text, text, text)
  to anon, authenticated;
