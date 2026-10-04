-- ============================================================
-- INFINITE PULLS TV -- 4 Oct 2026 (Mike: "i'd like to make a ton of these and
-- post 2-3 a day"). Three shows, one Loop from each every day, posted by
-- @InfinitePullsTCG:
--     Crazy J              9am Eastern
--     Pulls News          12pm Eastern
--     The Collector        6pm Eastern
--
-- This is the list of videos waiting to go up. The 'house-loops' function
-- reads it once an hour and posts the next one in line for each show.
--   n 1001-1999 = Crazy J, 2001-2999 = Pulls News, 3001-3999 = The Collector
--
-- To stop it:  select cron.unschedule('infinite-pulls-tv');
-- SAFE TO RUN TWICE.
-- ============================================================

create table if not exists public.house_loops (
  n          int primary key,
  video_guid text not null unique,
  title      text,
  caption    text,
  status     text not null default 'uploading' check (status in ('uploading','queued','posted','failed')),
  loop_id    uuid,
  posted_on  date,
  posted_at  timestamptz,
  created_at timestamptz not null default now()
);
alter table public.house_loops enable row level security;
revoke all on public.house_loops from anon, authenticated;

create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.unschedule('infinite-pulls-tv')
  where exists (select 1 from cron.job where jobname = 'infinite-pulls-tv');

select cron.schedule(
  'infinite-pulls-tv',
  '5 * * * *',
  $$
  select net.http_post(
    url     := 'https://rrkyvcouxdmurwdyuugv.functions.supabase.co/house-loops',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- A correct result: one row, status 'infinite pulls tv: ok', job_on = true, poster_found = true.
select 'infinite pulls tv: ok' as status,
       exists (select 1 from cron.job where jobname = 'infinite-pulls-tv' and active) as job_on,
       exists (select 1 from public.profiles where lower(username) = 'infinitepullstcg') as poster_found;
