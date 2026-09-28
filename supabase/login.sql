-- ============================================================
-- SIGN IN WITH USERNAME + FORGOT PASSWORD -- 28 Sep 2026 (Mike).
-- The 'login' server function uses these. Nothing here is readable
-- from the app. SAFE TO RUN TWICE.
-- ============================================================

-- wrong passwords and reset emails, so they can be limited
create table if not exists public.login_attempts (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind    text not null check (kind in ('fail', 'reset')),
  at      timestamptz not null default now()
);
create index if not exists login_attempts_idx on public.login_attempts (user_id, kind, at desc);
alter table public.login_attempts enable row level security;   -- no policies: server only

-- find an account by its email (server only; the app can't call this)
create or replace function public.login_user_by_email(p_email text)
returns table (id uuid, email text)
language sql stable security definer set search_path = public, auth
as $$
  select u.id, u.email::text from auth.users u where lower(u.email) = lower(p_email) limit 1;
$$;
revoke all on function public.login_user_by_email(text) from public, anon, authenticated;
grant execute on function public.login_user_by_email(text) to service_role;

select 'login: ok' as status;
