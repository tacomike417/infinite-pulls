-- ============================================================
-- USERNAMES, TIGHTENED — and the reason this runs BEFORE the badge.
--
-- A username is part of a public address and, once there is a gold
-- badge beside it, it is also an identity claim. Three things were
-- wrong with it, and the third one only becomes dangerous the day
-- badges exist:
--
-- 1. UNIQUE WAS CASE-SENSITIVE. `username text not null unique` in
--    Postgres means Jefleppard, jefleppard and JefLeppard are three
--    different accounts, all allowed. GitHub Pages is case-sensitive
--    too, so each one gets its own real folder of live pages. Sign up
--    as JefLeppard, collect the same badge everybody else gets, and
--    you are a gold-badged account one capital letter away from the
--    shop owner.
--
--    Note the asymmetry that caused it: the reserved-word check
--    already lowercased. Uniqueness between real people did not.
--
-- 2. THE RESERVED LIST LIVED IN THREE PLACES and they had drifted.
--    The database blocked thirty names, components/account.js blocked
--    a slightly different thirty-one, and the page builders blocked a
--    third, larger set. Only the database stops a signup; the others
--    are a friendlier error and a guard on what gets written to disk.
--    Names the database did not block but that are real folders in the
--    repository: pulls, infinite-questions, feed-next, tools, data,
--    brand-kit, cf-worker, stress-test. Registering "pulls" got you a
--    profile page you could never reach, because the real folder wins.
--    Registering "data" was worse: the page builders would write
--    data/post/<id>/index.html into a real source folder and the bot
--    would commit it.
--
--    It is one function here now. The copies in the app stay, because
--    an instant error is kinder than a round trip, but they are
--    cosmetic and this is the gate.
--
-- 3. A SIGNED-IN PERSON COULD WRITE ANY COLUMN ON THEIR OWN ROW.
--    The update policy is `using (auth.uid() = id)` with no column
--    restriction, which is fine while every column is theirs to set.
--    The moment a badge column exists on this table, anybody can grant
--    themselves one with a single request to the public API -- no app
--    required. So there is a trigger below that decides which columns
--    a person may change on themselves and which belong to the shop.
--
-- SAFE TO RUN TWICE. It refuses to do anything at all if step 1 would
-- silently merge two real accounts -- see the check.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ONE LIST, IN ONE PLACE
-- ------------------------------------------------------------

create or replace function public.is_reserved_username(name text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(name, '')) in (
    -- real folders in the repository
    'admin','assets','components','supabase','api','tools','data','pulls',
    'infinite-questions','feed-next','brand-kit','cf-worker','stress-test',
    'node_modules','icons','functions',
    -- routes the app answers on
    'home','shop','collection','pokedex','dex','goals','events','deals',
    'lookup','location','hours','contact','about','account','menu','gallery',
    'item','thanks','movers','mine','wishlist','post','search','feed','profile',
    -- files and conventions at the root
    'www','null','undefined','favicon','index','readme','cname','app','style',
    'config','manifest','service-worker','robots','sitemap','404','static',
    -- things that would read as the shop itself, which matters more now
    -- that a name can carry a badge
    'infinitepulls','infinite','official','staff','support','help','team',
    'moderator','mod','owner','jeff','verified','security','billing','system',
    'root','me','you','everyone'
  );
$$;

comment on function public.is_reserved_username(text) is
  'The one list. The copies in components/account.js and the page builders '
  'are there for a faster error message and to keep pages off real folders; '
  'this is the one that decides whether a name can be registered at all.';

-- ------------------------------------------------------------
-- 2. NOTHING HAPPENS IF IT WOULD COST SOMEBODY THEIR ACCOUNT
--
-- A unique index on lower(username) cannot be created while two rows
-- differ only by case -- and it should not be, quietly or otherwise.
-- This says exactly which rows are in the way and stops, so the choice
-- of who keeps the name is made by a person.
-- ------------------------------------------------------------

do $$
declare
  clash text;
begin
  select string_agg(names, ' | ') into clash
  from (
    select string_agg(username, ' vs ') as names
      from public.profiles
     group by lower(username)
    having count(*) > 1
  ) d;

  if clash is not null then
    raise exception E'Two accounts differ only by capitals, so nothing was changed:\n  %\nRename one of each pair first, then run this again.', clash;
  end if;
end $$;

-- Existing names that are now reserved are reported the same way rather
-- than having the constraint fail with a message about a constraint.
do $$
declare
  taken text;
begin
  select string_agg(username, ', ') into taken
    from public.profiles
   where public.is_reserved_username(username);

  if taken is not null then
    raise exception E'These existing usernames are on the reserved list, so nothing was changed:\n  %\nRename them first, then run this again.', taken;
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. ONE NAME, WHATEVER THE CAPITALS
-- ------------------------------------------------------------

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

comment on index public.profiles_username_lower_idx is
  'Usernames are unique regardless of capitals. Without this, JefLeppard '
  'and jefleppard are two accounts and two sets of live pages -- which is '
  'an impersonation kit the moment a badge sits beside the name.';

-- The format check now calls the one list.
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (
    username ~ '^[A-Za-z0-9_-]{3,24}$'
    and not public.is_reserved_username(username)
  );

-- ------------------------------------------------------------
-- 4. WHICH COLUMNS BELONG TO THE PERSON, AND WHICH TO THE SHOP
--
-- Applies to every write, from the app or from anything else holding
-- the public key. Shop staff are exempt, because taking a badge back
-- is their job.
-- ------------------------------------------------------------

/* DELIBERATELY NOT security definer, and that is the whole mechanism.
   A security definer function runs as its OWNER, so current_user inside one
   is always the owner no matter who called -- which made the check below
   true for everybody and quietly opened the door it exists to shut. Left as
   an ordinary trigger function it runs as whoever is writing, so
   current_user is `authenticated` through the API and the table's owner when
   the write came from inside claim_founder_badge() or drop_founder_badge().
   It needs no elevated rights of its own: it reads new and old, and
   is_shop_staff() is definer already. */
create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  /* THE SANCTIONED FUNCTIONS COME THROUGH HERE TOO, and they have to be let
     past. claim_founder_badge() and drop_founder_badge() are the only doors
     to the badge column, and both are security definer -- but auth.uid()
     inside one of them still returns the PERSON, not the function, so from
     this trigger's point of view a legitimate claim looked exactly like
     somebody granting themselves a badge. It was refused, which is the
     right instinct applied to the wrong caller.

     What actually distinguishes them is current_user: inside a security
     definer function it is the function's owner, which is also the owner of
     this table; through PostgREST it is `authenticated`. That is a property
     of how the call arrived rather than of what it claims about itself, so
     it cannot be set by whoever is calling. Compared against the table's
     real owner rather than a hard-coded 'postgres', so this keeps working
     wherever it is restored. */
  if current_user = (
       select tableowner from pg_tables
        where schemaname = 'public' and tablename = 'profiles'
     ) then
    return new;
  end if;

  if public.is_shop_staff() then
    return new;
  end if;

  -- The badge is not yours to grant yourself. These columns arrive with
  -- the badge migration; the guard is written to cope with them being
  -- absent so this file can be run on its own, in either order.
  if to_jsonb(new) ? 'verified_at'
     and to_jsonb(new)->'verified_at' is distinct from to_jsonb(old)->'verified_at' then
    raise exception 'A badge is not something an account can give itself';
  end if;

  -- Renaming is allowed -- people outgrow a name they picked in a hurry --
  -- but not while carrying a badge, because the badge vouches for the name
  -- somebody else already learned to recognize. Drop the badge, rename,
  -- ask for it back.
  if new.username is distinct from old.username
     and to_jsonb(new) ? 'verified_at'
     and to_jsonb(new)->>'verified_at' is not null then
    raise exception 'Remove your badge before changing your username';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg
  before update on public.profiles
  for each row execute function public.profiles_guard();

comment on function public.profiles_guard() is
  'Decides which columns on a profile belong to the person and which belong '
  'to the shop. The update policy on this table is `using (auth.uid() = id)` '
  'with no column restriction, so without this a badge column would be '
  'self-serve through the public API.';
