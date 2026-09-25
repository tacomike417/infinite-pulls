-- =====================================================================
-- PUSH THE NOTIFICATIONS WE ALREADY MAKE -- 25 Sep 2026
--
-- Mike: "I never get notifications for anything, so I don't even really
-- get a reminder to come back to the app."
--
-- The app already writes a row into public.notifications every time
-- somebody comments on your card, replies to you, likes your comment,
-- follows you, adds heat, or you earn a card or finish a goal. Those rows
-- only ever showed up if you opened the bell inside the app. Nothing went
-- to the phone.
--
-- Now every new row also calls the push-out function, which sends it to
-- that person's phone (if they turned notifications on). pushed_at makes
-- sure a row is sent once, however many times it is asked.
--
-- And once a day, at 6pm Eastern, "N new cards hit the shelf today" goes to
-- every device with notifications on -- but only on a day something new
-- actually went up.
--
-- Run AFTER deploying the push-out function (the steps say so).
-- Safe to run more than once.
-- =====================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

alter table public.notifications add column if not exists pushed_at timestamptz;

-- When the shelf digest last went out, so it can never go twice in a day.
create table if not exists public.push_digests (
  kind    text primary key,
  sent_at timestamptz not null
);
alter table public.push_digests enable row level security;   -- nobody reads it but the function

create or replace function public.push_new_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url     := 'https://rrkyvcouxdmurwdyuugv.functions.supabase.co/push-out',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := jsonb_build_object('notification_id', new.id)
  );
  return new;
exception when others then
  return new;          -- a push that cannot go out must never stop the comment
end;
$$;

drop trigger if exists push_new_notification on public.notifications;
create trigger push_new_notification
  after insert on public.notifications
  for each row execute function public.push_new_notification();

-- The daily shelf note. 22:00 UTC = 6pm Eastern (5pm in winter).
select cron.unschedule('infinite-pulls-shelf-digest')
  where exists (select 1 from cron.job where jobname = 'infinite-pulls-shelf-digest');

select cron.schedule(
  'infinite-pulls-shelf-digest',
  '0 22 * * *',
  $$
  select net.http_post(
    url     := 'https://rrkyvcouxdmurwdyuugv.functions.supabase.co/push-out',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{"digest":"shelf"}'::jsonb
  );
  $$
);

-- CHECK: you should see 1 | 1 | 1 and a number of phones that can get pushes
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications'
      and column_name = 'pushed_at')                                         as column_should_be_1,
  (select count(*) from pg_trigger where tgname = 'push_new_notification')   as trigger_should_be_1,
  (select count(*) from cron.job where jobname = 'infinite-pulls-shelf-digest') as job_should_be_1,
  (select count(*) from public.push_subscriptions)                           as devices_with_notifications_on,
  (select count(distinct user_id) from public.push_subscriptions
    where user_id is not null)                                               as people_with_notifications_on;
