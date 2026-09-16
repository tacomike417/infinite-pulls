-- Infinite Pulls — notifications
-- ============================================================================
--
-- WHO GETS TOLD WHAT, AND WHY IT IS A TRIGGER
--
-- Three things happen to you that you would want to know about: somebody
-- comments on your card, somebody hearts a comment you wrote, somebody
-- follows you. All three are already real rows -- post_comments,
-- comment_hearts, follows -- so this table is the only thing missing.
--
-- The rows are written by TRIGGERS, not by the app. Three reasons:
--
--   1. The app cannot forget. A notification written by feed.js only exists
--      when that code path runs; a trigger fires for the admin panel, a SQL
--      editor paste, a future screen nobody has written yet, and anything
--      else that ever inserts one of these rows.
--
--   2. The app cannot lie. A client that can insert notifications can insert
--      one saying anybody did anything. Here no client has insert rights at
--      all -- the triggers are security definer and are the only writers.
--
--   3. The recipient is not always the person acting, so the client would
--      need to read somebody else's row to know who to tell. The trigger is
--      already inside the transaction with that information.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- HEAT. It looks like a fourth kind and it is not, because heat is not a
-- real row yet -- feed.js keeps the marks in localStorage and DISPLAYS AN
-- INVENTED NUMBER (`37 + (i % 9) * 3`). There is nothing to notify about.
-- When a hype table exists, add 'heat' to the kind check and one more
-- trigger; nothing else in here changes.
--
-- SAFE TO RUN TWICE.

-- ---------------------------------------------------------------------------
-- THE TABLE
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),

  -- WHO IS TOLD. Not who did it.
  user_id    uuid not null references auth.users(id) on delete cascade,

  -- WHO DID IT. Their name and face are read from profiles at display time
  -- rather than copied here, so somebody changing their username does not
  -- leave a trail of notifications from a person who no longer exists.
  actor_id   uuid not null references auth.users(id) on delete cascade,

  kind       text not null check (kind in ('comment','reply','heart','follow')),

  -- WHERE TAPPING IT GOES. post_key is the feed's own 'c-<uuid>' / 'p-<uuid>'
  -- name, the same one the permalinks use. Null for a follow, which is about
  -- a person rather than a post.
  post_key   text,
  comment_id uuid references public.post_comments(id) on delete cascade,

  created_at timestamptz not null default now(),
  read_at    timestamptz,

  -- Nobody is notified about their own doing. Enforced here as well as in
  -- every trigger, because a constraint cannot be forgotten in a rewrite.
  constraint notifications_not_self check (user_id <> actor_id)
);

-- The one query this table exists to answer: my unread ones, newest first.
create index if not exists notifications_inbox_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- WHO CAN SEE THEM
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists "people read their own notifications" on public.notifications;
create policy "people read their own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

-- Marking as read is the ONLY thing a client may change, and the with-check
-- keeps the row theirs afterwards -- an update that moved user_id to somebody
-- else would otherwise pass the using clause on the way in.
drop policy if exists "people mark their own notifications read" on public.notifications;
create policy "people mark their own notifications read"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "people delete their own notifications" on public.notifications;
create policy "people delete their own notifications"
  on public.notifications for delete
  using (auth.uid() = user_id);

-- NO INSERT POLICY, ON PURPOSE. With RLS on and no policy, every client
-- insert is refused. The triggers below run as the function owner and are
-- the only things that can write a row here.

-- ---------------------------------------------------------------------------
-- A GUARD AGAINST THE SAME NUDGE TWICE
-- ---------------------------------------------------------------------------
-- Follow and heart are both TOGGLES. Somebody tapping follow, unfollow and
-- follow again would otherwise send three notifications for one decision,
-- which is how an app teaches people to switch notifications off. One per
-- actor, per kind, per day is plenty.
create or replace function public.notify_once(
  p_user uuid, p_actor uuid, p_kind text,
  p_post text default null, p_comment uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null or p_actor is null or p_user = p_actor then
    return;
  end if;

  if exists (
    select 1 from public.notifications
     where user_id = p_user
       and actor_id = p_actor
       and kind = p_kind
       and coalesce(comment_id::text, '') = coalesce(p_comment::text, '')
       and created_at > now() - interval '1 day'
  ) then
    return;
  end if;

  insert into public.notifications (user_id, actor_id, kind, post_key, comment_id)
  values (p_user, p_actor, p_kind, p_post, p_comment);
end;
$$;

-- ---------------------------------------------------------------------------
-- SOMEBODY COMMENTED
-- ---------------------------------------------------------------------------
-- Two notifications can come out of one comment, and they are different
-- things: the card's owner is told somebody commented, and if this is a
-- reply, the person being replied to is told separately. Somebody replying
-- on their own card gets one, not two, because the self-check drops the
-- other.
create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_author uuid;
begin
  if new.hidden_at is not null then
    return new;                       -- born hidden: nobody is told
  end if;

  perform public.notify_once(new.post_owner, new.user_id, 'comment', new.post_key, new.id);

  if new.parent_id is not null then
    select user_id into parent_author from public.post_comments where id = new.parent_id;
    perform public.notify_once(parent_author, new.user_id, 'reply', new.post_key, new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists notify_on_comment on public.post_comments;
create trigger notify_on_comment
  after insert on public.post_comments
  for each row execute function public.notify_on_comment();

-- A HIDDEN COMMENT TAKES ITS NOTIFICATIONS WITH IT. Moderating something out
-- of the feed and leaving a notification pointing at it is how somebody taps
-- a bell and lands on nothing.
create or replace function public.notify_drop_hidden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.hidden_at is not null and old.hidden_at is null then
    delete from public.notifications where comment_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_drop_hidden on public.post_comments;
create trigger notify_drop_hidden
  after update of hidden_at on public.post_comments
  for each row execute function public.notify_drop_hidden();

-- ---------------------------------------------------------------------------
-- SOMEBODY HEARTED YOUR COMMENT
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_heart()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  select user_id, post_key, hidden_at into c
    from public.post_comments where id = new.comment_id;

  if c.hidden_at is not null then
    return new;
  end if;

  perform public.notify_once(c.user_id, new.user_id, 'heart', c.post_key, new.comment_id);
  return new;
end;
$$;

drop trigger if exists notify_on_heart on public.comment_hearts;
create trigger notify_on_heart
  after insert on public.comment_hearts
  for each row execute function public.notify_on_heart();

-- ---------------------------------------------------------------------------
-- SOMEBODY FOLLOWED YOU
-- ---------------------------------------------------------------------------
-- follows is an UPSERT with a boolean, not an insert-and-delete, so this has
-- to fire on update as well -- and only on the change INTO following, never
-- on the change out of it.
create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.following is not true then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.following is true then
    return new;                        -- already following: nothing changed
  end if;

  perform public.notify_once(new.followee_id, new.follower_id, 'follow', null, null);
  return new;
end;
$$;

drop trigger if exists notify_on_follow on public.follows;
create trigger notify_on_follow
  after insert or update of following on public.follows
  for each row execute function public.notify_on_follow();

-- ---------------------------------------------------------------------------
-- THE COUNT, AND MARKING THEM READ
-- ---------------------------------------------------------------------------
-- A count function rather than a client-side head-count, so the badge is one
-- small round trip that returns a number instead of a row set.
create or replace function public.unread_notifications()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.notifications
   where user_id = auth.uid() and read_at is null;
$$;

create or replace function public.mark_notifications_read()
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
     set read_at = now()
   where user_id = auth.uid() and read_at is null;
$$;

revoke all on function public.notify_once(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.unread_notifications() to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;

-- ---------------------------------------------------------------------------
-- HOUSEKEEPING
-- ---------------------------------------------------------------------------
-- Nobody scrolls back through six months of "X hearted your comment". Read
-- ones older than 60 days go; unread ones stay, because an unread thing is
-- still owed to somebody.
create or replace function public.prune_notifications()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.notifications
   where read_at is not null and created_at < now() - interval '60 days';
$$;

comment on table public.notifications is
  'One row per thing that happened TO somebody. Written only by triggers on post_comments, comment_hearts and follows -- there is no insert policy, so no client can write one. Heat is missing on purpose: it is not a real row yet.';
