-- THE INFINITE GRADE: one row per run of the Pre-grading Lab (26 Oct 2026).
--
-- Why a table: the beta limit (15 completed inspections per account per
-- month) is counted HERE by the edge function with the service role, never
-- by the phone. A reshoot (bad photos) is stored with completed = false so
-- the person can see what happened, and it does not count.
--
-- No photos are stored. The report is JSON: centering, the defects with
-- the box each one was circled in, what could not be checked, the grade
-- range. That is enough to redraw the report later without the pictures.
--
-- Run once in the Supabase SQL editor (or: supabase db push).

create table if not exists public.infinite_grade_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  card_name   text,
  completed   boolean not null default false,
  result      jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists infinite_grade_runs_user_month
  on public.infinite_grade_runs (user_id, completed, created_at desc);

alter table public.infinite_grade_runs enable row level security;

-- People can read their own runs (a "my grades" screen later). Nobody
-- inserts from the phone: the edge function writes with the service role.
drop policy if exists "own runs" on public.infinite_grade_runs;
create policy "own runs" on public.infinite_grade_runs
  for select using (auth.uid() = user_id);
