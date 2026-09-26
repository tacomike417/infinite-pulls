-- ============================================================
-- HOUSE ACCOUNTS -- the shop's own theme accounts (TCGCardWatch,
-- 10Dollar, iamvintage, ProfessorPulls, oddballemon, ...).
--
-- WHAT THEY ARE
--
-- Ordinary accounts, the same as Hyde-Bot's: a row in auth.users and a
-- public row in public.profiles, so everything the feed already does for
-- a collector (name, face, badge, tagline, bio, profile page) just works.
-- The one thing that makes them "house" is a row in public.house_accounts.
--
-- WHO CAN EDIT THEM
--
-- Only accounts listed in public.house_admins -- Mike's, to start. The
-- master page (/admin/house/) never writes to profiles directly; it calls
-- house_account_save(), a security definer function that checks the
-- caller is a house admin and that the account being edited really is a
-- house account. Nobody else can call it into doing anything.
--
-- Avatars go in the same `avatars` bucket everybody's do, in the house
-- account's own folder. A storage policy below lets a house admin write
-- there -- only there, only for house accounts.
--
-- SAFE TO RUN TWICE.
-- ============================================================

-- ------------------------------------------------------------
-- 1. THE TWO LISTS
-- ------------------------------------------------------------
create table if not exists public.house_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  added_at   timestamptz not null default now()
);

create table if not exists public.house_accounts (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  sort       int  not null default 0,
  active     boolean not null default true,      -- off = it stops posting (once posting exists)
  notes      text,                               -- Mike's own note: what this account posts
  created_at timestamptz not null default now()
);

alter table public.house_admins   enable row level security;
alter table public.house_accounts enable row level security;
-- No policies on purpose: nobody reads or writes these tables through the
-- API. Everything goes through the functions below.

-- ------------------------------------------------------------
-- 2. WHO IS A HOUSE ADMIN
-- ------------------------------------------------------------
create or replace function public.is_house_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.house_admins where user_id = auth.uid());
$$;
grant execute on function public.is_house_admin() to authenticated;

-- Used by the storage policy: is this avatars folder a house account's?
create or replace function public.is_house_folder(folder text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.house_accounts where user_id::text = folder);
$$;
grant execute on function public.is_house_folder(text) to authenticated;

-- ------------------------------------------------------------
-- 3. THE LIST THE MASTER PAGE SHOWS
-- ------------------------------------------------------------
create or replace function public.house_accounts_list()
returns table (
  id uuid, email text, username text, display_name text, avatar_url text,
  bio text, tagline text, badge boolean, active boolean, notes text, sort int
)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_house_admin() then
    raise exception 'Not a house admin';
  end if;
  return query
    select p.id, u.email::text, p.username, p.display_name, p.avatar_url,
           p.bio, p.tagline, (p.verified_at is not null), h.active, h.notes, h.sort
      from public.house_accounts h
      join public.profiles p on p.id = h.user_id
      join auth.users u      on u.id = h.user_id
     order by h.sort, p.username;
end;
$$;
grant execute on function public.house_accounts_list() to authenticated;

-- ------------------------------------------------------------
-- 4. SAVING ONE ACCOUNT
--    Username rules are the table's own (3-24 letters/numbers/_/-, not on
--    the reserved list, not taken) -- a bad one comes back as an error the
--    page shows as it is.
-- ------------------------------------------------------------
create or replace function public.house_account_save(
  p_id           uuid,
  p_username     text,
  p_display_name text,
  p_bio          text,
  p_tagline      text,
  p_badge        boolean,
  p_active       boolean,
  p_notes        text,
  p_avatar_url   text
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_house_admin() then
    raise exception 'Not a house admin';
  end if;
  if not exists (select 1 from public.house_accounts where user_id = p_id) then
    raise exception 'That is not a house account';
  end if;
  if public.is_reserved_username(p_username) then
    raise exception '% is reserved by the site -- pick another name', p_username;
  end if;
  if exists (select 1 from public.profiles
              where lower(username) = lower(p_username) and id <> p_id) then
    raise exception 'Somebody already has the name %', p_username;
  end if;

  update public.profiles
     set username     = p_username,
         display_name = nullif(trim(p_display_name), ''),
         bio          = nullif(left(trim(coalesce(p_bio, '')), 160), ''),
         tagline      = nullif(trim(coalesce(p_tagline, '')), ''),
         verified_at  = case when p_badge then coalesce(verified_at, now()) else null end,
         avatar_url   = coalesce(nullif(p_avatar_url, ''), avatar_url),
         is_public    = true
   where id = p_id;

  update public.house_accounts
     set active = coalesce(p_active, active),
         notes  = nullif(trim(coalesce(p_notes, '')), '')
   where user_id = p_id;
end;
$$;
grant execute on function public.house_account_save(uuid, text, text, text, text, boolean, boolean, text, text) to authenticated;

-- ------------------------------------------------------------
-- 5. ADDING AN ACCOUNT TO THE HOUSE LIST (by its login email)
--    The account itself is made in the Supabase dashboard first.
-- ------------------------------------------------------------
create or replace function public.house_account_add(p_email text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare uid uuid;
begin
  if not public.is_house_admin() then
    raise exception 'Not a house admin';
  end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then
    raise exception 'No account with the email % -- make it in Supabase first', p_email;
  end if;
  if not exists (select 1 from public.profiles where id = uid) then
    raise exception 'That account has no profile yet';
  end if;
  insert into public.house_accounts (user_id, sort)
  values (uid, coalesce((select max(sort) + 1 from public.house_accounts), 0))
  on conflict (user_id) do nothing;
  update public.profiles set is_public = true where id = uid;
  return uid;
end;
$$;
grant execute on function public.house_account_add(text) to authenticated;

-- ------------------------------------------------------------
-- 6. AVATARS: a house admin may write in a house account's folder
-- ------------------------------------------------------------
drop policy if exists "house admins write house avatars" on storage.objects;
create policy "house admins write house avatars"
  on storage.objects for all to authenticated
  using (bucket_id = 'avatars' and public.is_house_admin()
         and public.is_house_folder((storage.foldername(name))[1]))
  with check (bucket_id = 'avatars' and public.is_house_admin()
         and public.is_house_folder((storage.foldername(name))[1]));

-- ------------------------------------------------------------
-- 7. MIKE IS THE FIRST HOUSE ADMIN (his tacomike417 account)
-- ------------------------------------------------------------
insert into public.house_admins (user_id)
select id from public.profiles where lower(username) = 'tacomike417'
on conflict (user_id) do nothing;

-- CHECK: this should come back with one row, tacomike417.
select p.username as house_admin
  from public.house_admins a join public.profiles p on p.id = a.user_id;
