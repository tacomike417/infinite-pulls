-- Infinite Pulls — HEAT, for real
-- ============================================================================
--
-- WHAT THIS REPLACES
--
-- Heat was a mark in localStorage and a NUMBER THE PAGE MADE UP:
--
--     const n = 37 + (i % 9) * 3;       -- cards
--     const n = 41 + (i % 7) * 4;       -- photos
--
-- Every post showed a plausible count that nobody had earned, the mark
-- lived on one phone, and the same post read differently on a different
-- device. In front of collectors who count things for a living that is the
-- kind of detail that makes a person wonder what else on the page is
-- decorative.
--
-- WHAT DOES NOT CARRY OVER
--
-- Nothing. The old marks were per-device and attached to no account, so
-- there is no honest way to say who made them. They are abandoned, and
-- everybody starts from a true zero -- which is better than starting from a
-- number that was never true.
--
-- SAFE TO RUN TWICE. Run notifications.sql FIRST: the last section here
-- teaches that table a fourth kind.

-- ---------------------------------------------------------------------------
-- THE TABLE
-- ---------------------------------------------------------------------------
create table if not exists public.post_heat (
  -- The feed's own name for a post: 'c-<uuid>' for a card, 'p-<uuid>' for a
  -- photo. Deliberately the same shape post_comments uses, so one post has
  -- one name everywhere in the app.
  post_key   text not null,
  user_id    uuid not null references auth.users(id) on delete cascade,

  -- WHO IS NOTIFIED. Null for the shop's own posts, which belong to the
  -- shelf rather than to a person -- heat on those is counted and tells
  -- nobody, which is the right answer for a shelf.
  post_owner uuid references auth.users(id) on delete cascade,

  created_at timestamptz not null default now(),

  -- ONE PER PERSON PER POST. The whole mechanic in one line: this is what
  -- makes the number mean "how many people", and it is why the count could
  -- never be gamed by tapping twice.
  primary key (post_key, user_id),

  constraint post_heat_key_shape
    check (post_key ~ '^[cp]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);

create index if not exists post_heat_key_idx   on public.post_heat (post_key);
create index if not exists post_heat_mine_idx  on public.post_heat (user_id);

-- ---------------------------------------------------------------------------
-- WHO CAN DO WHAT
-- ---------------------------------------------------------------------------
alter table public.post_heat enable row level security;

-- The COUNT is public, because a signed-out visitor sees the number on every
-- post and a feed where the numbers appear only after signing in looks
-- broken rather than gated.
drop policy if exists "anyone reads heat" on public.post_heat;
create policy "anyone reads heat"
  on public.post_heat for select
  using (true);

-- You may only add your OWN mark. with-check on user_id is what stops a
-- signed-in client inserting a row in somebody else's name and inflating a
-- post -- the exact thing a public count invites somebody to try.
drop policy if exists "people add their own heat" on public.post_heat;
create policy "people add their own heat"
  on public.post_heat for insert
  with check (auth.uid() = user_id);

drop policy if exists "people take back their own heat" on public.post_heat;
create policy "people take back their own heat"
  on public.post_heat for delete
  using (auth.uid() = user_id);

-- No update policy at all. There is nothing in a row worth changing, and a
-- row that cannot be edited cannot be edited into somebody else's.

-- ---------------------------------------------------------------------------
-- THE COUNT
-- ---------------------------------------------------------------------------
-- Same shape as post_comment_counts, on purpose: one view, one query for a
-- screenful of posts rather than one query each.
drop view if exists public.post_heat_counts;
create view public.post_heat_counts
with (security_invoker = true)
as
  select post_key, count(*)::int as n
    from public.post_heat
   group by post_key;

grant select on public.post_heat_counts to anon, authenticated;

comment on view public.post_heat_counts is
  'How many people have marked each post. security_invoker, so the counts '
  'you can see are the rows you can see -- which is all of them, by design.';

-- ---------------------------------------------------------------------------
-- THE NOTIFICATION
-- ---------------------------------------------------------------------------
-- notifications.sql shipped with three kinds and a note saying heat would be
-- the fourth when it became real. This is that.
do $$
begin
  if to_regclass('public.notifications') is null then
    raise exception 'Run notifications.sql first — this adds a kind to that table.';
  end if;
end $$;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('comment','reply','heart','follow','heat'));

create or replace function public.notify_on_heat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A shop post has no owner. Counted, nobody told.
  if new.post_owner is null then
    return new;
  end if;
  perform public.notify_once(new.post_owner, new.user_id, 'heat', new.post_key, null);
  return new;
end;
$$;

drop trigger if exists notify_on_heat on public.post_heat;
create trigger notify_on_heat
  after insert on public.post_heat
  for each row execute function public.notify_on_heat();

-- TAKING A MARK BACK TAKES THE NOTIFICATION WITH IT, but only while it is
-- still unread. Once somebody has SEEN that you liked their card, quietly
-- deleting the evidence is a stranger thing to do than leaving it -- and
-- notify_once already stops the pair from going round again for a day.
create or replace function public.notify_drop_heat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notifications
   where kind = 'heat'
     and user_id = old.post_owner
     and actor_id = old.user_id
     and post_key = old.post_key
     and read_at is null;
  return old;
end;
$$;

drop trigger if exists notify_drop_heat on public.post_heat;
create trigger notify_drop_heat
  after delete on public.post_heat
  for each row execute function public.notify_drop_heat();

comment on table public.post_heat is
  'One row per person per post. Replaces a localStorage mark and an invented '
  'count. The primary key is the mechanic: one mark each, so the number means '
  'how many people rather than how many taps.';
