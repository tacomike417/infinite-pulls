-- HOUSE-TICK TIMER (19 Nov 2026). Already applied -- kept here as the record.
-- Wakes the house accounts every 15 minutes from Supabase, because GitHub's
-- own timer was only running about three times a day.
select cron.schedule(
  'infinite-pulls-house-tick',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://rrkyvcouxdmurwdyuugv.functions.supabase.co/house-tick',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
-- To switch it off:  select cron.unschedule('infinite-pulls-house-tick');
