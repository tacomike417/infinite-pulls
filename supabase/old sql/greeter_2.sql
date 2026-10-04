-- ============================================================
-- THE GREETER, PART 2 -- 4 Oct 2026 (Mike: "we need to make infinitepullstcg the
-- greeter of the site. he posts within minutes of the person joining. if they make
-- the say hi post he comments one of 10 different things ... if they do not make
-- the say hi post then have him direct message them something similar").
--
-- WHAT CHANGES FROM greeter.sql (run that one first; it has been):
--   * The greeter is now @InfinitePullsTCG (the shop), not oddballemon.
--   * A first post (Say hi, or any first photo post) gets a welcome comment, a like
--     and a follow 2 to 8 MINUTES later. One of ten lines, picked at random.
--   * No post 15 minutes after joining? The shop sends ONE welcome message to their
--     Messages instead. If they post later, they still get the comment.
--   * Messages are for 18 and over, so somebody under 18 who never posts gets no
--     message (they could not see it). Their first post still gets the comment.
--   * Nobody who joined before today gets a late message.
--
-- To stop it:   select cron.unschedule('infinite-pulls-greeter');
-- To see it:    select * from public.greet_queue order by coalesce(due_at, dm_due_at) desc limit 20;
--
-- SAFE TO RUN TWICE.
-- ============================================================

alter table public.greet_queue alter column post_key drop not null;
alter table public.greet_queue alter column due_at   drop not null;
alter table public.greet_queue add column if not exists dm_due_at  timestamptz;
alter table public.greet_queue add column if not exists dm_done_at timestamptz;
alter table public.greet_queue add column if not exists dm_result  text;
create index if not exists greet_queue_dm_due on public.greet_queue (dm_due_at) where dm_done_at is null and dm_due_at is not null;

-- ---------- somebody joins: start the 15-minute clock ----------
create or replace function public.greet_on_join()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  begin
    insert into public.greet_queue (user_id, dm_due_at)
    values (new.id, now() + interval '15 minutes')
    on conflict (user_id) do nothing;
  exception when others then
    null;                                  -- a hello must never stop a sign-up
  end;
  return new;
end;
$$;
drop trigger if exists greet_on_join on public.profiles;
create trigger greet_on_join
  after insert on public.profiles
  for each row execute function public.greet_on_join();

-- ---------- their first post: the comment is due in 2 to 8 minutes ----------
create or replace function public.greet_on_first_post()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  soon timestamptz := now() + make_interval(mins => 2 + floor(random() * 7)::int);
begin
  begin
    if exists (select 1 from public.house_accounts h where h.user_id = new.user_id) then return new; end if;
    insert into public.greet_queue (user_id, post_key, due_at)
    values (new.user_id, 'p-' || new.id::text, soon)
    on conflict (user_id) do update
       set post_key = excluded.post_key, due_at = excluded.due_at
     where public.greet_queue.post_key is null and public.greet_queue.done_at is null;
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

-- ---------- the job ----------
create or replace function public.greet_run()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  host uuid;
  q record;
  pid uuid;
  th uuid;
  n int := 0;
  lines text[] := array[
    'Welcome to Infinite Pulls! 👋',
    'Welcome to Infinite Pulls, glad you''re here!',
    'Welcome in! What are you chasing right now? 👀',
    'Hey, welcome! Can''t wait to see your pulls. 🔥',
    'Welcome to the crew! Post your best card when you get a sec. 🙌',
    'New collector in the house! Welcome. 👋',
    'Welcome! What was the first card you ever pulled?',
    'Glad you found us. Welcome to Infinite Pulls! 🎉',
    'Welcome aboard! Show us the binder when you''re ready. 📒',
    'Welcome! Pull something good today. 🍀'
  ];
  notes text[] := array[
    'Welcome to Infinite Pulls! 👋 Glad you''re here. Post a pull or add a card whenever you''re ready.',
    'Hey, welcome to Infinite Pulls! Tap the + at the bottom to post your first pull. Can''t wait to see it.',
    'Welcome in! 🎉 This is the shop. Say hi on the feed when you get a sec, the collectors here are friendly.',
    'Glad you found us. Welcome to Infinite Pulls! Scan a card or post a pull to get started.',
    'Welcome to the crew! 🙌 Your first post gets a warm welcome. Tap the + when you''re ready.'
  ];
begin
  select id into host from public.profiles where lower(username) = 'infinitepullstcg';
  if host is null then return 0; end if;

  -- 1. a first post: comment, like, follow
  for q in select * from public.greet_queue
            where done_at is null and post_key is not null and due_at <= now()
            order by due_at limit 20
  loop
    pid := substring(q.post_key from 3)::uuid;
    if q.user_id = host
       or exists (select 1 from public.house_accounts h where h.user_id = q.user_id)
       or not exists (select 1 from public.user_photos where id = pid and user_id = q.user_id) then
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

  -- 2. no post 15 minutes after joining: one welcome message
  for q in select * from public.greet_queue
            where dm_done_at is null and dm_due_at is not null and dm_due_at <= now()
            order by dm_due_at limit 20
  loop
    if q.post_key is not null then
      update public.greet_queue set dm_done_at = now(), dm_result = 'they posted, so the comment does it' where user_id = q.user_id;
      continue;
    end if;
    if q.user_id = host or exists (select 1 from public.house_accounts h where h.user_id = q.user_id) then
      update public.greet_queue set dm_done_at = now(), dm_result = 'house account' where user_id = q.user_id;
      continue;
    end if;
    if coalesce(public.age_years(q.user_id), 0) < 18 then
      update public.greet_queue set dm_done_at = now(), dm_result = 'under 18 or no birthday: no message' where user_id = q.user_id;
      continue;
    end if;
    begin
      insert into public.dm_threads (user_a, user_b)
      values (least(host, q.user_id), greatest(host, q.user_id))
      on conflict (user_a, user_b) do update set last_at = now()
      returning id into th;
      insert into public.dm_messages (thread_id, sender_id, body)
      values (th, host, notes[1 + floor(random() * array_length(notes, 1))::int]);
      update public.dm_threads set last_at = now() where id = th;
      update public.greet_queue set dm_done_at = now(), dm_result = 'messaged' where user_id = q.user_id;
      n := n + 1;
    exception when others then
      update public.greet_queue set dm_done_at = now(), dm_result = 'failed: ' || left(sqlerrm, 200) where user_id = q.user_id;
    end;
  end loop;
  return n;
end;
$$;
revoke all on function public.greet_run() from public, anon, authenticated;

-- ---------- every 2 minutes now, so "within minutes" holds ----------
select cron.unschedule('infinite-pulls-greeter')
  where exists (select 1 from cron.job where jobname = 'infinite-pulls-greeter');
select cron.schedule('infinite-pulls-greeter', '*/2 * * * *', $$select public.greet_run();$$);

-- A correct result: one row. status 'greeter 2: ok', greeter_found = true, job_on = true.
select 'greeter 2: ok' as status,
       exists (select 1 from public.profiles where lower(username) = 'infinitepullstcg') as greeter_found,
       exists (select 1 from cron.job where jobname = 'infinite-pulls-greeter' and active) as job_on;
