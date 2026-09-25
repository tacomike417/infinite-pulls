-- ============================================================
-- PRICE ALERTS — actually schedule them.
--
-- check-price-alerts has been written, deployed and doing nothing since it
-- was built, because it was never put in cron.job. DROP-RADAR.md caught this
-- on 4 September 2026 and named the trap exactly:
--
--     pg_cron's "succeeded" only means net.http_post QUEUED the request.
--     A job can report success every day forever while the function on the
--     other end was never reached, or answered 500 every time.
--
-- So this file does two things: it schedules the job, and it gives you a way
-- to see the FUNCTION's own answer rather than the scheduler's opinion of it.
--
-- SAFE TO RUN TWICE. The unschedule first means re-running replaces the job
-- rather than stacking a second copy on top of it.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;


-- ============================================================
-- 1. THE JOB
--
--    Daily rather than weekly: a wish-list card dropping 10% is news the day
--    it happens, not the following Sunday. The weekly value digest inside the
--    function throttles itself to once every seven days, so firing daily does
--    not mean a digest every day.
--
--    13:00 UTC is about 9am US Eastern -- late enough that a notification is
--    not a 3am buzz, early enough to be the first thing seen.
-- ============================================================
select cron.unschedule('infinite-pulls-price-alerts')
  where exists (select 1 from cron.job where jobname = 'infinite-pulls-price-alerts');

select cron.schedule(
  'infinite-pulls-price-alerts',
  '0 13 * * *',   -- every day, 13:00 UTC (about 9am US Eastern)
  $$
  select net.http_post(
    url := 'https://rrkyvcouxdmurwdyuugv.functions.supabase.co/check-price-alerts',
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  $$
);


-- ============================================================
-- 2. WHO WOULD ACTUALLY GET ONE
--
--    Three things all have to be true, and it is worth seeing them apart:
--    the account opted in, the account has a device on file, and the card
--    it would be about exists. eligible = 0 means nothing will ever arrive
--    no matter how well the job runs.
-- ============================================================
select
  (select count(*) from public.profiles where price_alerts_enabled)            as opted_in,
  (select count(*) from public.push_subscriptions where user_id is not null)   as devices_on_file,
  (select count(distinct p.id)
     from public.profiles p
     join public.push_subscriptions s on s.user_id = p.id
    where p.price_alerts_enabled)                                              as eligible,
  (select count(*) from public.wishlist_cards)                                 as wishlist_rows,
  (select 1) as ok;  -- the grail card was retired 25 Sep 2026


-- ============================================================
-- 3. HAS IT EVER ACTUALLY REACHED THE FUNCTION
--
--    This is the row pg_cron cannot fake. status_code is what the function
--    replied; content is what it said. A 500 saying "VAPID secrets are not
--    configured on this function" is the difference between a broken feature
--    and a feature nobody has finished setting up -- and the job would report
--    "succeeded" for either one.
-- ============================================================
select
  created,
  status_code,
  left(content::text, 300) as said
from net._http_response
order by created desc
limit 10;


-- ============================================================
-- 4. PROOF SOMETHING WENT OUT
--
--    The function stamps these when it sends. If last_value_alert_at is
--    still null for everybody a day after this was scheduled, nothing was
--    sent, whatever else says otherwise.
-- ============================================================
select username, price_alerts_enabled, last_value_alert_at, last_value_alert_total
  from public.profiles
 where price_alerts_enabled
 order by last_value_alert_at desc nulls last
 limit 20;


-- ============================================================
-- 5. THE JOB ITSELF
-- ============================================================
select jobid, jobname, schedule, active from cron.job
 where jobname like 'infinite-pulls%'
 order by jobname;

-- And what the scheduler thinks happened. Remember what this does and does
-- not mean: 'succeeded' here only says the request was queued. Section 3 is
-- the one that tells you whether anybody answered.
select j.jobname, d.status, d.start_time, left(coalesce(d.return_message,''), 120) as message
  from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
 where j.jobname = 'infinite-pulls-price-alerts'
 order by d.start_time desc
 limit 10;
