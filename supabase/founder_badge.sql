-- ============================================================
-- INFINITE ORIGINAL 2026 — the founding-member badge, and the
-- tagline that comes with it.
--
-- WHAT IT MEANS, WRITTEN DOWN SO IT STAYS MEANING IT
--
-- "This account existed before 2027." That is all, and that is the
-- point. It is a membership badge, not a verification of anybody's
-- identity, and it is deliberately not called one -- a badge that says
-- "Verified" beside a name in a TRADING community is read as "the shop
-- vouches for this person", and the shop does not. Nobody has been
-- checked. Nobody has been met.
--
-- Keep the name honest and it can never be misread. Change the name to
-- something that implies a check, and somebody eventually mails a
-- stranger a four-hundred-dollar card because of a gold star this file
-- handed out automatically.
--
-- HOW SOMEBODY GETS ONE
--
-- They ask, through claim_founder_badge(). The date on their account
-- decides, not the app: the cutoff is enforced here, so it cannot be
-- moved by anything holding the public key. Nobody can grant themselves
-- one by writing to the column -- supabase/usernames.sql has a trigger
-- that refuses exactly that -- and this function is the only door.
--
-- HOW IT GOES AWAY
--
-- drop_founder_badge() -- shop staff only, no warning, tagline with it.
-- That is the whole moderation story for badges, and it needs to exist
-- on the first day rather than the day it is first needed.
--
-- NEEDS supabase/comments.sql to have been run first: the tagline is
-- held to the same contact rule comments are, and that rule lives in
-- comment_has_contact(). A tagline is a far better spam surface than a
-- comment -- it sits under a name on every post that person ever makes.
--
-- SAFE TO RUN TWICE.
-- ============================================================

alter table public.profiles add column if not exists verified_at  timestamptz;
alter table public.profiles add column if not exists verified_by  uuid references auth.users(id) on delete set null;
alter table public.profiles add column if not exists tagline      text;

comment on column public.profiles.verified_at is
  'When this account claimed its Infinite Original 2026 badge. Means the '
  'account existed before 2027 and nothing else -- no identity has been '
  'checked. Written only by claim_founder_badge() and drop_founder_badge().';
comment on column public.profiles.tagline is
  'One short line shown under the username wherever it appears. Only an '
  'account with a badge has one.';

-- ------------------------------------------------------------
-- THE TAGLINE'S RULES
--
-- Two separate problems, and only the first is the obvious one.
--
-- Spam: a tagline is on every post its owner ever makes, so a phone
-- number in one is worth more to a scammer than a hundred comments.
-- Same rule as comments, same function, so the two cannot drift.
--
-- Impersonation: a gold badge next to the words "Shop Staff" is a
-- claim about who somebody is, whatever the badge itself says. That is
-- a different check and it is the one people would actually try.
-- ------------------------------------------------------------

create or replace function public.tagline_trouble(t text)
returns text
language plpgsql
immutable
as $$
declare
  s text := lower(btrim(coalesce(t, '')));
begin
  if s = '' then return null; end if;               -- clearing it is fine
  if char_length(s) > 60 then
    return 'A tagline has to be 60 characters or less.';
  end if;
  if public.comment_has_contact(t) then
    return 'A tagline cannot contain links, emails or phone numbers.';
  end if;
  -- Words that claim a job at the shop, matched as whole words so that
  -- "modern binder" is not read as "mod".
  --
  -- SUPPORT, OWNER AND MANAGER WERE ON THIS LIST AND CAME BACK OFF. They
  -- are ordinary English in a card shop -- "I support my local shop",
  -- "proud owner of a Base Set Charizard" -- and a rule that refuses those
  -- teaches people the tagline is broken rather than that the rule exists.
  -- What is left is the set of words nobody writes about themselves unless
  -- they mean to be taken for the shop.
  if s ~ '(^|[^a-z])(admin|administrator|staff|official|moderator|verified|infinite ?pulls)([^a-z]|$)' then
    return 'A tagline cannot claim to speak for the shop.';
  end if;
  return null;
end;
$$;

-- Enforced on the table, so it holds for anything talking to the API and
-- not only for the app.
alter table public.profiles drop constraint if exists profiles_tagline_ok;
alter table public.profiles add constraint profiles_tagline_ok
  check (public.tagline_trouble(tagline) is null);

-- ------------------------------------------------------------
-- CLAIMING IT
-- ------------------------------------------------------------

/* THE CUTOFF IS ONE CONSTANT, NAMED, in the one place that decides.
   It reads as a date somebody might want to move later, and the day
   that happens it must move HERE and nowhere else. */
create or replace function public.founder_cutoff()
returns timestamptz language sql immutable as $$ select '2027-01-01T00:00:00Z'::timestamptz $$;

create or replace function public.claim_founder_badge()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  joined timestamptz;
  row public.profiles%rowtype;
begin
  if me is null then
    raise exception 'You have to be signed in to claim a badge';
  end if;

  /* AUTH.USERS IS THE TRUTH ABOUT WHEN SOMEBODY SIGNED UP.
     profiles.created_at is written by a trigger when the profile row is
     made, which is normally the same moment -- but a profile that was
     ever repaired, re-created or backfilled has a created_at that says
     more about a maintenance job than about the person. The account's
     own date cannot be rewritten by anything the app does. */
  select u.created_at into joined from auth.users u where u.id = me;
  if joined is null then
    raise exception 'No account found';
  end if;

  if joined >= public.founder_cutoff() then
    raise exception 'Infinite Original 2026 is for accounts made before 2027';
  end if;

  update public.profiles
     set verified_at = coalesce(verified_at, now())   -- claiming twice is not an error
   where id = me
   returning * into row;

  if not found then
    raise exception 'No profile found for this account';
  end if;

  return row;
end;
$$;

revoke all on function public.claim_founder_badge() from public;
grant execute on function public.claim_founder_badge() to authenticated;

-- ------------------------------------------------------------
-- SETTING THE TAGLINE
--
-- Through a function rather than a plain update, for one reason: only an
-- account with a badge gets a tagline, and a policy cannot express "this
-- column may be written only while that column is not null" without
-- becoming something nobody can read six months later.
-- ------------------------------------------------------------

create or replace function public.set_tagline(new_tagline text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text := nullif(btrim(coalesce(new_tagline, '')), '');
  trouble text;
  row public.profiles%rowtype;
begin
  if me is null then
    raise exception 'You have to be signed in to do that';
  end if;

  if not exists (select 1 from public.profiles p where p.id = me and p.verified_at is not null) then
    raise exception 'A tagline comes with the Infinite Original 2026 badge';
  end if;

  trouble := public.tagline_trouble(clean);
  if trouble is not null then
    raise exception '%', trouble;
  end if;

  update public.profiles set tagline = clean where id = me returning * into row;
  return row;
end;
$$;

revoke all on function public.set_tagline(text) from public;
grant execute on function public.set_tagline(text) to authenticated;

-- ------------------------------------------------------------
-- TAKING IT BACK
--
-- Shop staff only. No warning, no appeal, and the tagline goes with it:
-- the tagline is the part somebody would have been abusing, and leaving
-- it behind while removing the badge takes away the ornament and keeps
-- the billboard.
-- ------------------------------------------------------------

create or replace function public.drop_founder_badge(who uuid, why text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_staff() then
    raise exception 'Only the shop can take a badge back';
  end if;

  update public.profiles
     set verified_at = null,
         verified_by = auth.uid(),   -- who took it, kept on purpose
         tagline = null
   where id = who;
end;
$$;

revoke all on function public.drop_founder_badge(uuid, text) from public;
grant execute on function public.drop_founder_badge(uuid, text) to authenticated;

comment on function public.drop_founder_badge(uuid, text) is
  'Shop staff only. Removes the badge and the tagline together -- the '
  'tagline is the part that gets abused, and removing one without the '
  'other leaves the billboard up.';

-- ------------------------------------------------------------
-- READING IT
--
-- The badge and tagline have to be visible to everybody, signed in or
-- not, because they appear beside a name on a public page. The existing
-- select policy on profiles already allows exactly that for a public
-- profile, so there is nothing to add -- which is worth saying out loud
-- so nobody adds a policy that widens it by accident.
-- ------------------------------------------------------------

-- ============================================================
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It does not check anybody's identity, and nothing in the app should
-- ever say that it does.
--
-- It does not stop two accounts having confusingly similar names --
-- tacomike417 and tacom1ke417 are different names, not different
-- capitals, and no constraint can tell the difference between a
-- lookalike and a coincidence. supabase/usernames.sql closes the
-- capitals hole, which is the one that is exact and therefore fixable.
--
-- It does not expire. Somebody who claimed a badge in 2026 keeps it.
-- ============================================================
