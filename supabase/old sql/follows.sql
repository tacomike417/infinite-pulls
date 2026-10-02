-- ============================================================
-- FOLLOWS — everybody follows everybody, and a row is how you say otherwise.
--
-- THE SHAPE, AND WHY IT IS NOT THE OBVIOUS ONE
--
-- The conventional follow table stores one row per pair. Here that would
-- mean signing up writes a row to every existing member and a row back from
-- each of them -- two thousand rows at a thousand members, twenty thousand
-- at ten thousand, and the table itself growing as the square of the
-- membership. Every one of those rows would say the same thing: the default.
--
-- So the table stores only the EXCEPTIONS. No row means you follow them,
-- which is the default the product wants. A row is somebody having changed
-- their mind. Signing up writes nothing at all and is instant at any size,
-- and a person who unfollows four people has four rows, not N.
--
-- `following` is a real column rather than the table just being a list of
-- unfollows, so if the default is ever flipped -- follows becoming opt-in,
-- the way most apps work -- that is a change to one function and not a
-- migration of everybody's data.
--
-- WHO CAN SEE IT
--
-- Only you. Your own rows, nobody else's. That is not laziness about
-- policies: it means unfollowing somebody is private, and nobody gets a
-- notification that they have been dropped. If a follower COUNT is ever
-- wanted, it is a security-definer function that returns a number, not a
-- policy that lets people read each other's rows.
--
-- SAFE TO RUN TWICE.
-- ============================================================

create table if not exists public.follows (
  follower_id uuid        not null references auth.users(id) on delete cascade,
  followee_id uuid        not null references auth.users(id) on delete cascade,
  following   boolean     not null,
  changed_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);

comment on table public.follows is
  'Exceptions to "everybody follows everybody". No row means following. A row '
  'with following=false is somebody who unfollowed. Never backfilled: a signup '
  'writes nothing here.';

-- The primary key already covers "my rows" -- (follower_id, followee_id) is
-- read left to right, so `where follower_id = me` uses it. No second index.

alter table public.follows enable row level security;

drop policy if exists "people manage their own follows" on public.follows;
create policy "people manage their own follows"
  on public.follows
  for all
  using      (auth.uid() = follower_id)
  with check (auth.uid() = follower_id);


-- ============================================================
-- CHECK
--    exceptions should be 0 on a fresh install -- everybody follows
--    everybody and nobody has said otherwise yet.
-- ============================================================
select
  (select count(*) from public.follows)                              as exceptions,
  (select count(*) from public.follows where following = false)      as unfollows,
  (select count(*) from public.profiles where is_public)             as people_in_the_feed;
