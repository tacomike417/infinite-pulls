-- ============================================================
-- THE GREETER -- 3 Oct 2026 (Mike: "make it so no one ever feels like they
-- arrived in an empty room. we'll use oddballemon as the greeter").
--
-- When somebody makes their FIRST post (the Say Hi post, or any first photo
-- post), oddballemon answers it:
--     * one welcome comment
--     * a like on that post
--     * a follow
-- Once per person, ever.
--
-- ON A TIMER (Mike: "put it on a timer so it doesn't look too spammy, give it
-- a random time within 2 hours of the say hi post"). The post goes on a list
-- with a random time 5 to 120 minutes out. A job checks the list every 5
-- minutes and does the ones that are due.
--
-- oddballemon is the ONLY house account that talks to people. The others
-- stay quiet. House accounts are never greeted. Nobody who already posted
-- before today gets a late hello.
--
-- To stop it:   select cron.unschedule('infinite-pulls-greeter');
-- To see it:    select * from public.greet_queue order by due_at desc limit 20;
--
-- SAFE TO RUN TWICE.
-- ============================================================

create table if not exists public.greet_queue (
  user_id   uuid primary key references auth.users(id) on delete cascade,   -- once per person, ever
  post_key  text not null,
  due_at    timestamptz not null,
  done_at   timestamptz,
  result    text
);
alter table public.greet_queue enable row level security;   -- no policies: nobody reads or writes it through the app
create index if not exists greet_queue_due on public.greet_queue (due_at) where done_at is null;

-- everybody who has already posted counts as greeted (no late hellos on old posts)
insert into public.greet_queue (user_id, post_key, due_at, done_at, result)
select p.user_id, 'p-' || (array_agg(p.id order by p.added_at))[1]::text, now(), now(), 'before the greeter'
  from public.user_photos p
 group by p.user_id
on conflict (user_id) do nothing;

-- ---------- a first post goes on the list ----------
create or replace function public.greet_on_first_post()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  begin
    if exists (select 1 from public.house_accounts h where h.user_id = new.user_id) then return new; end if;
    insert into public.greet_queue (user_id, post_key, due_at)
    values (new.user_id, 'p-' || new.id::text, now() + make_interval(mins => 5 + floor(random() * 116)::int))
    on conflict (user_id) do nothing;
  exception when others then
    null;                                  -- a hello must never stop a post from posting
  end;
  return new;
end;
$$;
drop trigger if exists greet_on_first_post on public.user_photos;
create trigger greet_on_first_post
  after insert on public.user_photos
  for each row execute function public.greet_on_first_post();

-- ---------- the job: do the ones that are due ----------
create or replace function public.greet_run()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  host uuid;
  q record;
  pid uuid;
  n int := 0;
  lines text[] := array[
    'Welcome to Infinite Pulls! Glad you''re here. 👋',
    'Welcome in! What are you chasing right now? 👀',
    'Hey, welcome! Can''t wait to see your pulls. 🔥',
    'Welcome to the crew! Post your best card when you get a sec. 🙌',
    'New collector in the house! Welcome. 👋',
    'Welcome! What was the first card you ever pulled?'
  ];
begin
  select id into host from public.profiles where lower(username) = 'oddballemon';
  if host is null then return 0; end if;

  for q in select * from public.greet_queue
            where done_at is null and due_at <= now()
            order by due_at limit 20
  loop
    pid := substring(q.post_key from 3)::uuid;
    if q.user_id = host or not exists (select 1 from public.user_photos where id = pid and user_id = q.user_id) then
      update public.greet_queue set done_at = now(), result = 'post is gone' where user_id = q.user_id;
      continue;
    end if;
    begin
      insert into public.post_comments (post_key, post_owner, user_id, body)
      values (q.post_key, q.user_id, host, lines[1 + floor(random() * array_length(lines, 1))::int]);
      insert into public.post_heat (post_key, user_id, post_owner)
      values (q.post_key, host, q.user_id)
      on conflict do nothing;
      insert into public.follows (follower_id, followee_id, following, changed_at)
      values (host, q.user_id, true, now())
      on conflict (follower_id, followee_id) do update set following = true, changed_at = now()
        where public.follows.following is not true;
      update public.greet_queue set done_at = now(), result = 'greeted' where user_id = q.user_id;
      n := n + 1;
    exception when others then
      update public.greet_queue set done_at = now(), result = 'failed: ' || left(sqlerrm, 200) where user_id = q.user_id;
    end;
  end loop;
  return n;
end;
$$;
revoke all on function public.greet_run() from public, anon, authenticated;

-- ---------- every 5 minutes ----------
create extension if not exists pg_cron;
select cron.unschedule('infinite-pulls-greeter')
  where exists (select 1 from cron.job where jobname = 'infinite-pulls-greeter');
select cron.schedule('infinite-pulls-greeter', '*/5 * * * *', $$select public.greet_run();$$);

-- A correct result: one row. status 'greeter: ok', greeter_found = true, job_on = true.
-- (already_posted is how many people were here before today and will not get a late hello.)
select 'greeter: ok' as status,
       exists (select 1 from public.profiles where lower(username) = 'oddballemon') as greeter_found,
       exists (select 1 from cron.job where jobname = 'infinite-pulls-greeter' and active) as job_on,
       (select count(*) from public.greet_queue where result = 'before the greeter') as already_posted;
