-- QUICK JOIN (5 Oct 2026). The fast join (name, password, birthday) counts how many
-- accounts were just made from one internet address, so one person can't make hundreds.
-- Run this once in the Supabase SQL box. Safe to run again.
create table if not exists public.join_attempts (
  id bigint generated always as identity primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists join_attempts_ip_at on public.join_attempts (ip, at desc);
alter table public.join_attempts enable row level security;   -- no rules = only the server can read or write it
select 'quick join: ok' as status;
