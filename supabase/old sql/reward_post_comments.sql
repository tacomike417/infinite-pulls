-- ===========================================================================
-- LET PEOPLE TALK ABOUT EARNED CARDS
--
-- The feed has drawn a COMMENT button on reward posts since they shipped.
-- Tapping it did nothing useful, because the database refused the row.
--
-- Two separate refusals, and the second one only shows up after the first
-- is lifted -- which is why this file fixes both at once rather than
-- looking finished halfway.
--
--   1. post_key had to match '^[cp]-<uuid>'. A reward post is named
--      'r-<uuid>', so every insert failed the CHECK before any code ran.
--
--   2. post_comments_fill() resolves who owns a post so moderation and
--      notifications know who to answer to. It knew 'c' (user_cards) and
--      treated everything else as 'p' (user_photos). An 'r' key went
--      looking for a photo with a reward card's id, found nothing, and
--      raised 'No such post'.
--
-- HYPE WAS BROKEN THE SAME WAY and nobody noticed, because a failed hype
-- is silent -- the heart just does not stick. post_heat carries its own
-- copy of the same CHECK. Fixed here too.
--
-- WHAT A REWARD POST IS, since it is not like the other two: there is no
-- reward_posts table. A post IS a batch of user_reward_cards rows grouped
-- by when they landed, and the post is named after the FIRST row's id. So
-- 'r-<uuid>' points at a real user_reward_cards row, and that row's
-- user_id is the owner. Nothing new has to be stored.
--
-- Safe to run twice. No deletes.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE KEY SHAPE, on both tables
--
-- A check constraint cannot be appended to -- it is dropped and rewritten --
-- so each of these carries the COMPLETE list of prefixes, not just the one
-- being added. Same lesson the notifications kind constraint taught when a
-- partial rewrite silently deleted 'dex' and 'goal'.
-- ---------------------------------------------------------------------------
alter table public.post_comments drop constraint if exists post_comments_key_shape;
alter table public.post_comments
  add constraint post_comments_key_shape
  check (post_key ~ '^[cpr]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

alter table public.post_heat drop constraint if exists post_heat_key_shape;
alter table public.post_heat
  add constraint post_heat_key_shape
  check (post_key ~ '^[cpr]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- ---------------------------------------------------------------------------
-- 2. WHO OWNS A REWARD POST
--
-- Unchanged from comments.sql except for the 'r' branch and the else-if
-- rather than a bare else -- an unknown prefix now falls through to
-- owner null and gets the honest 'No such post' instead of being
-- quietly looked up in the wrong table.
-- ---------------------------------------------------------------------------
create or replace function public.post_comments_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text := left(new.post_key, 1);
  pid  uuid := substring(new.post_key from 3)::uuid;
  owner uuid;
  grandparent uuid;
begin
  if kind = 'c' then
    select uc.user_id into owner from public.user_cards uc where uc.id = pid;
  elsif kind = 'p' then
    select up.user_id into owner from public.user_photos up where up.id = pid;
  elsif kind = 'r' then
    -- The post is named after the first card in the batch; that row's
    -- owner is the person who earned it.
    select urc.user_id into owner
      from public.user_reward_cards urc
     where urc.id = pid;
  end if;

  if owner is null then
    raise exception 'No such post: %', new.post_key using errcode = '23503';
  end if;

  new.post_owner := owner;

  -- Flatten a reply-to-a-reply onto its group, and refuse a reply that
  -- points at a comment on a different post entirely -- which is the shape
  -- an attempt to smuggle a comment onto somebody else's post would take.
  if new.parent_id is not null then
    select c.parent_id into grandparent
      from public.post_comments c
     where c.id = new.parent_id and c.post_key = new.post_key;

    if not found then
      raise exception 'That reply does not belong to this post' using errcode = '23503';
    end if;

    if grandparent is not null then
      new.parent_id := grandparent;
    end if;
  end if;

  return new;
end;
$$;

commit;

-- ===========================================================================
-- CHECK IT WORKED — run this after, it changes nothing
-- ===========================================================================
-- Both should say the regex now contains [cpr].
select conname, pg_get_constraintdef(oid) as rule
  from pg_constraint
 where conname in ('post_comments_key_shape','post_heat_key_shape');

-- Should say true. If it says false, the function did not replace.
select position('user_reward_cards' in prosrc) > 0 as handles_reward_posts
  from pg_proc
 where proname = 'post_comments_fill';
