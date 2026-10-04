-- ============================================================
-- "PEOPLE YOU FOLLOW POSTED", ONCE A DAY -- 4 Oct 2026 (Mike: "a once a day
-- version ... 11am for infinite pulls").
--
-- One alert a day, at 11am Eastern, to everybody who follows somebody that
-- posted a photo or a Loop since yesterday. Nobody gets one on a day nobody
-- they follow posted. House accounts do not count.
--
-- The knock comes at 15:00 and 16:00 UTC so it is 11am in summer AND in
-- winter; the push-out function only acts on the one that really is 11am,
-- and only once a day.
--
-- Deploy push-out BEFORE running this.
-- To stop it:  select cron.unschedule('infinite-pulls-following-digest');
-- SAFE TO RUN TWICE.
-- ============================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.unschedule('infinite-pulls-following-digest')
  where exists (select 1 from cron.job where jobname = 'infinite-pulls-following-digest');

select cron.schedule(
  'infinite-pulls-following-digest',
  '0 15,16 * * *',
  $$
  select net.http_post(
    url     := 'https://rrkyvcouxdmurwdyuugv.functions.supabase.co/push-out',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{"digest":"following"}'::jsonb
  );
  $$
);

-- A correct result: one row, status 'following digest: ok', job_on = true.
select 'following digest: ok' as status,
       exists (select 1 from cron.job where jobname = 'infinite-pulls-following-digest' and active) as job_on;
