-- ============================================================
-- THE GREETER, PART 5: THE INVITE LINE -- 4 Oct 2026 (Mike: "in that original message
-- we need to have ... dont forget to invite a friend with an invite link for them to click").
--
-- oddballemon's welcome message now ends with:
--   "And don't forget to invite a friend. Here's your invite link:
--    https://infinitepulls.com/feed-next/?invite=1"
-- Tapping it opens the Invite sheet in the app (needs v131 pushed first).
-- Everything else about the greeter is unchanged. Messages already sent stay as they are.
--
-- SAFE TO RUN TWICE.
-- ============================================================

-- ---------- the job ----------
create or replace function public.greet_run()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  host uuid;
  helper uuid;
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

  -- 3. oddballemon says hi to everybody new, some time in their first day
  select id into helper from public.profiles where lower(username) = 'oddballemon';
  if helper is not null then
    for q in select * from public.greet_queue
              where ob_done_at is null and ob_due_at is not null and ob_due_at <= now()
              order by ob_due_at limit 20
    loop
      if q.user_id in (host, helper) or exists (select 1 from public.house_accounts h where h.user_id = q.user_id) then
        update public.greet_queue set ob_done_at = now(), ob_result = 'house account' where user_id = q.user_id;
        continue;
      end if;
      if coalesce(public.age_years(q.user_id), 0) < 18 then
        update public.greet_queue set ob_done_at = now(), ob_result = 'under 18 or no birthday: no message' where user_id = q.user_id;
        continue;
      end if;
      begin
        insert into public.dm_threads (user_a, user_b)
        values (least(helper, q.user_id), greatest(helper, q.user_id))
        on conflict (user_a, user_b) do update set last_at = now()
        returning id into th;
        insert into public.dm_messages (thread_id, sender_id, body)
        values (th, helper, 'Hey, welcome to Infinite Pulls! I volunteered to help around here so if you have any questions lemme know! 💛 And don''t forget to invite a friend. Here''s your invite link: https://infinitepulls.com/feed-next/?invite=1');
        update public.dm_threads set last_at = now() where id = th;
        update public.greet_queue set ob_done_at = now(), ob_result = 'messaged' where user_id = q.user_id;
        n := n + 1;
      exception when others then
        update public.greet_queue set ob_done_at = now(), ob_result = 'failed: ' || left(sqlerrm, 200) where user_id = q.user_id;
      end;
    end loop;
  end if;
  return n;
end;
$$;
revoke all on function public.greet_run() from public, anon, authenticated;



-- A correct result: one row, status 'greeter 5: ok'.
select 'greeter 5: ok' as status,
       position('invite=1' in pg_get_functiondef('public.greet_run()'::regprocedure)) > 0 as invite_line_in;
