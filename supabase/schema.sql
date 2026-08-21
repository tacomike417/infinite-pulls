-- Infinite Pulls — Banner + Push Notifications schema
-- Run this once in your Supabase project's SQL Editor (Database > SQL Editor > New query).
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT DO NOTHING where possible.

-- ============================================================
-- 1. BANNER — single row the admin panel edits, the app reads.
--    "updated_at" changes every time the admin publishes, which
--    is what makes a visitor's "closed" state expire automatically.
-- ============================================================
create table if not exists public.banner (
  id smallint primary key default 1,
  message text not null default '',
  active boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint banner_singleton check (id = 1)
);

insert into public.banner (id, message, active)
values (1, '', false)
on conflict (id) do nothing;

-- Auto-update "updated_at" any time the row is edited, so the
-- admin panel never has to set it manually (and can't forget to).
create or replace function public.set_banner_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists banner_set_updated_at on public.banner;
create trigger banner_set_updated_at
  before update on public.banner
  for each row
  execute function public.set_banner_updated_at();

alter table public.banner enable row level security;

drop policy if exists "public read banner" on public.banner;
create policy "public read banner"
  on public.banner for select
  to anon, authenticated
  using (true);

drop policy if exists "admin update banner" on public.banner;
create policy "admin update banner"
  on public.banner for update
  to authenticated
  using (true)
  with check (true);

-- ============================================================
-- 2. PUSH SUBSCRIPTIONS — one row per device that opts in.
--    Endpoint URLs act like a secret token already, and hold no
--    personal info, so public insert/update is fine. There is
--    deliberately NO public select/delete policy: only the
--    service-role key (used inside the Edge Function, never in
--    the browser) can read or clean these up.
-- ============================================================
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "public insert subscription" on public.push_subscriptions;
create policy "public insert subscription"
  on public.push_subscriptions for insert
  to anon, authenticated
  with check (true);

drop policy if exists "public update own subscription" on public.push_subscriptions;
create policy "public update own subscription"
  on public.push_subscriptions for update
  to anon, authenticated
  using (true)
  with check (true);

-- Visitors write through this function instead of hitting the table
-- directly. It runs with the function owner's privileges (this project's
-- table-owning role), so Postgres never needs to grant the caller read
-- access just to process the write — sidesteps a rough edge in how
-- upsert-with-conflict-handling requests get built, and keeps things
-- working the same regardless of which Supabase API key format is used.
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.push_subscriptions (endpoint, p256dh, auth)
  values (p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do nothing;
end;
$$;

grant execute on function public.save_push_subscription(text, text, text)
  to anon, authenticated;

-- ============================================================
-- 3. STORE INFO — single row holding Store Info/Hours/Events/Deals.
--    Stored as one JSON blob so it matches the app's existing data
--    shape exactly (storeName, hours, events, deals, etc.) without
--    needing a column per field. Same publish pattern as the banner:
--    anyone can read it, only a signed-in admin can update it.
-- ============================================================
create table if not exists public.store_info (
  id smallint primary key default 1,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint store_info_singleton check (id = 1)
);

insert into public.store_info (id, data)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

create or replace function public.set_store_info_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists store_info_set_updated_at on public.store_info;
create trigger store_info_set_updated_at
  before update on public.store_info
  for each row
  execute function public.set_store_info_updated_at();

alter table public.store_info enable row level security;

drop policy if exists "public read store_info" on public.store_info;
create policy "public read store_info"
  on public.store_info for select
  to anon, authenticated
  using (true);

drop policy if exists "admin update store_info" on public.store_info;
create policy "admin update store_info"
  on public.store_info for update
  to authenticated
  using (true)
  with check (true);

-- ============================================================
-- 4. PROFILES — one row per customer account (username + avatar).
--    A row is created automatically the moment someone signs up
--    (see the trigger below), seeded from the username they chose
--    on the sign-up form.
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Added for public collector pages (infinitepulls.com/username): whether
-- the page exists at all, and whether it shows the collection's dollar
-- total. `add column if not exists` keeps this safe to re-run against a
-- project that already has the profiles table from an earlier setup.
alter table public.profiles add column if not exists is_public boolean not null default true;
alter table public.profiles add column if not exists show_price boolean not null default true;

-- Usernames become part of a public URL, so keep them URL-safe and keep
-- anyone from claiming a name that collides with a real path the site
-- already uses (e.g. "admin"). If this fails on an existing project, it
-- means an existing username doesn't fit — rename it, then re-run.
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (
    username ~ '^[A-Za-z0-9_-]{3,24}$'
    and lower(username) not in (
      'admin','assets','components','supabase','api','www','null','undefined',
      'favicon','index','readme','cname','app','style','config','manifest',
      'service-worker','home','shop','collection','events','deals','location',
      'hours','contact','about','account','menu'
    )
  );

alter table public.profiles enable row level security;

-- Anyone can look up a profile that's been made public (that's the whole
-- point of the public page); the owner can always see their own row too,
-- even while it's private, so their account page still works.
drop policy if exists "users can view their own profile" on public.profiles;
drop policy if exists "profiles are visible to owner or when public" on public.profiles;
create policy "profiles are visible to owner or when public"
  on public.profiles for select
  to anon, authenticated
  using (is_public = true or auth.uid() = id);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ============================================================
-- 5. USER CARDS — each customer's personal card collection.
--    A user can always see/change their own rows; other visitors can
--    read them only when that user's profile is public (see policy
--    below). Card details (name/set/image) are copied in at add-time so
--    the collection still displays correctly even if a lookup against
--    TCGdex later fails or that card ID changes.
-- ============================================================
create table if not exists public.user_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null,
  card_name text not null,
  set_name text,
  image_url text,
  variant text not null default 'normal',
  condition text not null default 'Near Mint',
  quantity integer not null default 1 check (quantity > 0),
  added_at timestamptz not null default now()
);

create index if not exists user_cards_user_id_idx on public.user_cards(user_id);

alter table public.user_cards enable row level security;

drop policy if exists "users manage their own cards" on public.user_cards;
create policy "users manage their own cards"
  on public.user_cards for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Visitors (signed in or not) can view another account's cards only when
-- that account has made its profile public — this is what powers the
-- public collector page. The policy above still covers the owner's own
-- full read/write access regardless of their public/private setting.
drop policy if exists "public reads cards of public profiles" on public.user_cards;
create policy "public reads cards of public profiles"
  on public.user_cards for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = user_cards.user_id and p.is_public = true
    )
  );

-- ============================================================
-- 5b. WISH LIST — same shape and same rules as user_cards, just a
--     separate table: cards a customer is hunting for rather than ones
--     they own. Kept as its own table (rather than a "type" column on
--     user_cards) so the collection and wish list are unambiguously
--     separate lists with their own RLS policies.
-- ============================================================
create table if not exists public.wishlist_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null,
  card_name text not null,
  set_name text,
  image_url text,
  variant text not null default 'normal',
  condition text not null default 'Near Mint',
  quantity integer not null default 1 check (quantity > 0),
  added_at timestamptz not null default now()
);

create index if not exists wishlist_cards_user_id_idx on public.wishlist_cards(user_id);

alter table public.wishlist_cards enable row level security;

drop policy if exists "users manage their own wishlist" on public.wishlist_cards;
create policy "users manage their own wishlist"
  on public.wishlist_cards for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "public reads wishlist of public profiles" on public.wishlist_cards;
create policy "public reads wishlist of public profiles"
  on public.wishlist_cards for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = wishlist_cards.user_id and p.is_public = true
    )
  );

-- ============================================================
-- 6. PROFILE VIDEOS — links to pack-opening videos a customer has
--    already uploaded elsewhere (YouTube, TikTok, Instagram, etc).
--    We only ever store a link + caption, never the video file itself,
--    so there's no video storage/bandwidth cost on our end. Same
--    visibility rule as user_cards: public only when the profile is.
-- ============================================================
create table if not exists public.profile_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  caption text,
  added_at timestamptz not null default now()
);

create index if not exists profile_videos_user_id_idx on public.profile_videos(user_id);

alter table public.profile_videos enable row level security;

drop policy if exists "owner manages own videos" on public.profile_videos;
create policy "owner manages own videos"
  on public.profile_videos for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "public reads videos of public profiles" on public.profile_videos;
create policy "public reads videos of public profiles"
  on public.profile_videos for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = profile_videos.user_id and p.is_public = true
    )
  );

-- ============================================================
-- 7. AVATAR STORAGE — public bucket for profile pictures.
--    Anyone can view an avatar (they're meant to be public), but a
--    user can only upload/replace/delete files inside their own
--    user-id folder.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "public read avatars" on storage.objects;
create policy "public read avatars"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists "users manage their own avatar" on storage.objects;
create policy "users manage their own avatar"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
