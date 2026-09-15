-- ============================================================
-- POST COMMENTS — what people say under a post, and who gets to
-- say it, keep it, or take it down.
--
-- ONE COLUMN FOR WHICH POST, NOT TWO
--
-- A post is either a card (public.user_cards) or a photo
-- (public.user_photos), and the feed already has one name for both:
-- 'c-<uuid>' and 'p-<uuid>'. That string is what the address bar
-- carries, what SHARE sends, and what the permalink pages are named
-- after. So it is what a comment points at too -- post_key -- rather
-- than a kind column and an id column that can disagree with each
-- other and with the feed.
--
-- The trade is that post_key cannot be a foreign key, so nothing in
-- the database stops a row naming a post that is not there. That is
-- handled where it matters: the trigger below REFUSES a comment on a
-- post it cannot find, which is a stronger guarantee than a foreign
-- key would give across two tables anyway.
--
-- WHO OWNS A COMMENT THREAD
--
-- The person whose post it is. Not the person who wrote the comment.
-- They can take down anything under their own post, with no warning
-- and no appeal, and so can shop staff -- the same is_shop_staff()
-- that guards the admin panel, so "Jeff or Mike" is already a list
-- that exists and is already maintained in one place.
--
-- post_owner is stored ON the comment row, and this is the only piece
-- of denormalization here. A policy that had to look in two different
-- tables to find out who owns the post would run that lookup on every
-- row of every read. It is written by the trigger, never by the
-- client, so it cannot be spoofed by the thing it protects against.
--
-- NOTHING IS EVER DELETED BY A MODERATOR
--
-- Taking a comment down sets hidden_at. It leaves the feed instantly
-- for everybody, including its author, who is not told. It stays in
-- the table so that somebody doing this repeatedly is a pattern you
-- can see rather than a thing you half-remember. Only staff can read
-- hidden rows.
--
-- SAFE TO RUN TWICE.
-- ============================================================

-- ------------------------------------------------------------
-- 1. THE SPAM AND SCAM FILTER
--
-- This lives in the database, not only in the app, and that is the
-- whole point of it. The app is one client talking to an ordinary
-- REST API with a public key; anybody can post a comment with curl.
-- A filter that only runs in the browser protects the people who
-- were never the problem.
--
-- It REFUSES rather than strips. A comment that silently loses half
-- its words reads as the app mangling somebody's sentence, and they
-- try again the same way. Told plainly, they stop.
-- ------------------------------------------------------------

create or replace function public.comment_has_contact(body text)
returns boolean
language plpgsql
immutable
as $$
declare
  t text := lower(coalesce(body, ''));
  digits text;
begin
  -- A LINK, in any of the shapes people actually type.
  if t ~ '(https?://|www\.)' then return true; end if;

  -- A bare domain: "mystore.com", "t.me/whoever". Deliberately a list of
  -- endings rather than "any dot": card talk is full of dots and slashes
  -- ("112/150", "1.5 mint") and none of those should be refused.
  --
  -- The two-letter endings on this list are here because they are what
  -- link-in-bio and shortener services use -- linktr.ee, bit.ly, t.me -- and
  -- that is precisely the shape a scam takes when someone knows a filter is
  -- watching for "http". They were added after linktr.ee walked straight
  -- through the first version of this list.
  if t ~ '[a-z0-9][a-z0-9-]*\.(com|net|org|io|co|me|gg|shop|store|xyz|info|biz|us|uk|ca|ru|cn|link|live|app|site|online|ee|ly|to|cc|tv|bio|page|click|top|vip|tk|gl|gd)([/?#]|\s|$)'
    then return true; end if;

  -- Anything with a slash after it is a URL whatever the ending is, which
  -- catches the next shortener before anybody has to hear about it.
  if t ~ '[a-z0-9][a-z0-9-]*\.[a-z]{2,10}/' then return true; end if;

  -- An email, plain or dressed up: "me@x.com", "me (at) x dot com".
  if t ~ '[a-z0-9._%%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then return true; end if;
  if t ~ '\(\s*at\s*\)|\[\s*at\s*\]|\sat\s+[a-z0-9-]+\s+dot\s' then return true; end if;
  if t ~ '\sdot\s+(com|net|org|io|co|me)\b' then return true; end if;

  -- A PHONE NUMBER, including the trick of spacing the digits out.
  --
  -- Only digits joined by things people put IN a phone number are
  -- considered -- spaces, dashes, dots, brackets, plus. Seven or more of
  -- them in one such run is a phone number. That is the shortest real one,
  -- and it leaves ordinary card talk alone: "112/150" is six digits and
  -- has a slash in it, "Base Set 1999" is four, "I have 10, 5 are mint"
  -- has letters between the numbers so it is not one run at all.
  digits := regexp_replace(
    coalesce((regexp_match(t, '(\+?[0-9][0-9 ().+-]{5,}[0-9])'))[1], ''),
    '[^0-9]', '', 'g');
  if length(digits) >= 7 then return true; end if;

  return false;
end;
$$;

comment on function public.comment_has_contact(text) is
  'True when a comment contains a link, an email or a phone number, '
  'including the spaced-out and "at ... dot com" forms people use to get '
  'around exactly this check. Enforced by a constraint on post_comments '
  'so the rule holds for anything talking to the API, not just the app.';

-- ------------------------------------------------------------
-- 2. THE TABLE
-- ------------------------------------------------------------

create table if not exists public.post_comments (
  id          uuid primary key default gen_random_uuid(),
  post_key    text not null,
  post_owner  uuid not null references auth.users(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  parent_id   uuid references public.post_comments(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now(),
  hidden_at   timestamptz,
  hidden_by   uuid references auth.users(id) on delete set null,

  -- 'c-<uuid>' or 'p-<uuid>', the same name the feed and the permalinks use.
  constraint post_comments_key_shape
    check (post_key ~ '^[cp]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),

  -- Long enough to say something, short enough that nobody pastes an essay
  -- into a feed built for one-line reactions.
  constraint post_comments_body_length
    check (char_length(btrim(body)) between 1 and 600),

  -- THE FILTER, as a constraint rather than a trigger, so it is checked on
  -- every insert AND every update and cannot be edited around after the fact.
  constraint post_comments_no_contact
    check (not public.comment_has_contact(body))
);

comment on table public.post_comments is
  'Comments under a feed post. post_key names the post the same way the '
  'feed and the permalink pages do. post_owner is written by a trigger, '
  'never by the client -- it is what the moderation policies read.';

create index if not exists post_comments_post_idx
  on public.post_comments (post_key, created_at);
create index if not exists post_comments_parent_idx
  on public.post_comments (parent_id) where parent_id is not null;
create index if not exists post_comments_user_idx
  on public.post_comments (user_id, created_at desc);

-- ------------------------------------------------------------
-- 3. THE TRIGGER THAT DECIDES WHO OWNS THE THREAD
--
-- It looks the post up and refuses if it is not there, which also means a
-- comment can never be filed against a post that does not exist.
--
-- REPLIES ARE ONE LEVEL DEEP. A reply to a reply is filed against the
-- reply's parent instead of being refused -- the person tapped Reply on
-- something and meant it, and telling them "you cannot reply to that" is
-- a worse answer than quietly putting it in the right group. On a 393px
-- phone a staircase of nested replies is unreadable by the third step.
-- ------------------------------------------------------------

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
  else
    select up.user_id into owner from public.user_photos up where up.id = pid;
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

drop trigger if exists post_comments_fill_trg on public.post_comments;
create trigger post_comments_fill_trg
  before insert on public.post_comments
  for each row execute function public.post_comments_fill();

-- ------------------------------------------------------------
-- 4. HEARTS
-- ------------------------------------------------------------

create table if not exists public.comment_hearts (
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

comment on table public.comment_hearts is
  'One row per person per comment. The primary key IS the rule -- hearting '
  'twice is the same row, so there is no count to get out of step.';

create index if not exists comment_hearts_comment_idx
  on public.comment_hearts (comment_id);

-- ------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ------------------------------------------------------------

alter table public.post_comments enable row level security;
alter table public.comment_hearts enable row level security;

-- ---- reading ----

-- Everybody, signed in or not, sees comments that are not hidden on posts
-- belonging to public profiles. The profile check is the same rule the feed
-- runs on: a private shelf has no public conversation under it either.
drop policy if exists post_comments_read on public.post_comments;
create policy post_comments_read on public.post_comments
  for select
  using (
    hidden_at is null
    and exists (
      select 1 from public.profiles p
       where p.id = post_comments.post_owner
         and coalesce(p.is_public, true)
    )
  );

-- Staff see everything, hidden rows included. Deliberately NOT extended to
-- the post owner: "removed without warning" means the author cannot tell,
-- and the owner already knows what they removed.
drop policy if exists post_comments_read_staff on public.post_comments;
create policy post_comments_read_staff on public.post_comments
  for select to authenticated
  using (public.is_shop_staff());

-- ---- writing ----

-- Signed in, as yourself, on a post whose owner is public. The body filter
-- is the table constraint, which applies here without being repeated.
drop policy if exists post_comments_insert on public.post_comments;
create policy post_comments_insert on public.post_comments
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.profiles p
       where p.id = post_comments.post_owner
         and coalesce(p.is_public, true)
    )
  );

-- ---- taking things down ----
--
-- THROUGH ONE FUNCTION, NOT AN UPDATE POLICY, and the reason is a real
-- property of Postgres rather than a preference:
--
-- an UPDATE must leave the row still visible to the person doing it. Hiding
-- a comment makes it invisible to everybody except staff -- so an owner
-- hiding a comment on their own post was refused with "new row violates
-- row-level security policy", while staff doing the same thing succeeded,
-- because staff can still see hidden rows. The rule worked for exactly the
-- people who needed it least.
--
-- The fixes available were to widen who can see hidden comments -- which
-- means an author can see the comment somebody took down, and "no warning"
-- stops being true -- or to do the hiding somewhere the row's visibility is
-- not the question. This is the second one. It runs as the function's owner,
-- so RLS is not in the way, and the permission check is written out in full
-- where anybody can read it.
--
-- It is also the only way to write to hidden_at at all: there is no UPDATE
-- policy on the table, so nothing else can.

create or replace function public.hide_comment(comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.post_comments%rowtype;
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'You have to be signed in to do that';
  end if;

  select * into c from public.post_comments where id = comment_id;
  if not found then
    raise exception 'No such comment';
  end if;

  -- The three people who may: whoever wrote it, whoever owns the post it
  -- sits under, and shop staff.
  if not (c.user_id = me or c.post_owner = me or public.is_shop_staff()) then
    raise exception 'That is not your comment to remove';
  end if;

  -- Already gone is not an error. Two taps on a slow connection should not
  -- produce a failure message about something that already happened.
  if c.hidden_at is not null then
    return;
  end if;

  update public.post_comments
     set hidden_at = now(), hidden_by = me
   where id = comment_id;
end;
$$;

revoke all on function public.hide_comment(uuid) from public;
grant execute on function public.hide_comment(uuid) to authenticated;

comment on function public.hide_comment(uuid) is
  'Takes a comment off the feed. The author, the owner of the post, or shop '
  'staff -- nobody else. security definer because a hidden row is invisible '
  'to the very people allowed to hide it, so an ordinary UPDATE policy '
  'refuses the update it is meant to allow.';

-- NO UPDATE POLICY EXISTS, so a comment cannot be edited by anybody through
-- the API at all. The trigger below is the second lock: if an update policy
-- is ever added for some other reason, the body still cannot change.

create or replace function public.post_comments_guard()
returns trigger
language plpgsql
as $$
begin
  if new.body is distinct from old.body
     or new.post_key is distinct from old.post_key
     or new.post_owner is distinct from old.post_owner
     or new.user_id is distinct from old.user_id
     or new.parent_id is distinct from old.parent_id
     or new.created_at is distinct from old.created_at then
    raise exception 'A comment cannot be edited, only hidden';
  end if;
  return new;
end;
$$;

drop trigger if exists post_comments_guard_trg on public.post_comments;
create trigger post_comments_guard_trg
  before update on public.post_comments
  for each row execute function public.post_comments_guard();

drop policy if exists post_comments_moderate on public.post_comments;

-- Nobody deletes rows. There is no delete policy, so with RLS on, delete is
-- refused for everybody -- which is the "hidden, never gone" rule, enforced
-- rather than merely intended.

-- ---- hearts ----

drop policy if exists comment_hearts_read on public.comment_hearts;
create policy comment_hearts_read on public.comment_hearts
  for select using (true);

drop policy if exists comment_hearts_insert on public.comment_hearts;
create policy comment_hearts_insert on public.comment_hearts
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists comment_hearts_delete on public.comment_hearts;
create policy comment_hearts_delete on public.comment_hearts
  for delete to authenticated
  using (user_id = auth.uid());

-- ------------------------------------------------------------
-- 6. COUNTS
--
-- The number on the comment icon. A view rather than a count on every post
-- row: the feed asks for one screenful of keys at a time and gets its
-- numbers in a single request.
--
-- security_invoker means it reads with the caller's own permissions, so it
-- cannot become a way to learn how many comments are on a post you are not
-- allowed to read.
-- ------------------------------------------------------------

drop view if exists public.post_comment_counts;
create view public.post_comment_counts
with (security_invoker = true)
as
  select post_key, count(*)::int as n
    from public.post_comments
   where hidden_at is null
   group by post_key;

grant select on public.post_comment_counts to anon, authenticated;

comment on view public.post_comment_counts is
  'Comment count per post, hidden ones excluded. security_invoker, so the '
  'counts you can see are the comments you can see.';

-- ------------------------------------------------------------
-- 7. A LOOK AT WHAT HAS BEEN TAKEN DOWN
--
-- For staff only -- the pattern this exists to make visible.
-- ------------------------------------------------------------

drop view if exists public.hidden_comments;
create view public.hidden_comments
with (security_invoker = true)
as
  select c.id, c.post_key, c.created_at, c.hidden_at, c.body,
         au.username as author, hu.username as hidden_by_name
    from public.post_comments c
    left join public.profiles au on au.id = c.user_id
    left join public.profiles hu on hu.id = c.hidden_by
   where c.hidden_at is not null
   order by c.hidden_at desc;

grant select on public.hidden_comments to authenticated;

-- ============================================================
-- WHAT THIS DOES NOT DO, SO THE NEXT PERSON DOES NOT GO LOOKING
--
-- No notifications. Nobody is told they have a comment. That is a
-- separate piece of work with its own decisions in it.
--
-- No rate limit. Somebody could write a hundred comments in a minute
-- and only be stopped by being taken down afterwards. If that ever
-- happens it wants a per-minute cap in the insert policy.
--
-- No blocking. There is no way to stop one person commenting on your
-- posts short of hiding each one.
-- ============================================================
