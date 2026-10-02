-- ============================================================
-- INFINITE LOOPS -- 27 Sep 2026 (Mike).
--
-- Short videos, 15 seconds at most, like Reels. The video itself lives on
-- Bunny Stream (library 763994); this table is the list of them.
--
--   * A Loop is gone after 30 days, unless its owner pins it (3 at most).
--   * People heat and comment on a Loop like any other post. Its key is
--     'l-<id>', so the heat and comment tables learn a fourth prefix here.
--   * @names in the caption tell those people, same as a photo caption.
--
-- ROWS ARE ONLY EVER ADDED BY THE SERVER (the 'loops' function), because
-- adding one also creates the video on Bunny. People can change only
-- their own caption, the sound switch and the pin.
--
-- SAFE TO RUN TWICE.
-- ============================================================

create table if not exists public.user_loops (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  video_guid  text not null unique,
  caption     text check (caption is null or char_length(caption) <= 500),
  muted       boolean not null default false,
  status      text not null default 'uploading' check (status in ('uploading','ready','failed')),
  pinned      boolean not null default false,
  length_s    numeric,
  width       int,
  height      int,
  resolutions text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days'
);
create index if not exists user_loops_user_idx on public.user_loops (user_id, created_at desc);
create index if not exists user_loops_new_idx  on public.user_loops (created_at desc) where status = 'ready';

alter table public.user_loops enable row level security;

-- Everybody sees finished Loops from public profiles that are still
-- live (or pinned). You always see all of your own. Staff see all.
drop policy if exists "read loops" on public.user_loops;
create policy "read loops"
  on public.user_loops for select to anon, authenticated
  using (
    auth.uid() = user_id
    or (status = 'ready'
        and (pinned or expires_at > now())
        and exists (select 1 from public.profiles p
                     where p.id = user_loops.user_id and p.is_public is not false))
  );

drop policy if exists "owners edit their loops" on public.user_loops;
create policy "owners edit their loops"
  on public.user_loops for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- The guard: an owner may change caption, muted and pinned -- nothing
-- else -- and may not have more than 3 pinned. The server (service role)
-- may change anything.
create or replace function public.user_loops_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if new.user_id is distinct from old.user_id
       or new.video_guid is distinct from old.video_guid
       or new.status is distinct from old.status
       or new.created_at is distinct from old.created_at
       or new.expires_at is distinct from old.expires_at
       or new.length_s is distinct from old.length_s
       or new.width is distinct from old.width
       or new.height is distinct from old.height
       or new.resolutions is distinct from old.resolutions then
      raise exception 'Only the caption, sound and pin can be changed.' using errcode = '42501';
    end if;
  end if;
  if new.pinned and not old.pinned
     and (select count(*) from public.user_loops l
           where l.user_id = new.user_id and l.pinned and l.id <> new.id) >= 3 then
    raise exception 'You can keep 3 Loops pinned. Unpin one first.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists user_loops_guard on public.user_loops;
create trigger user_loops_guard
  before update on public.user_loops
  for each row execute function public.user_loops_guard();

-- ------------------------------------------------------------
-- HEAT AND COMMENTS LEARN 'l-'. Complete lists, never partial.
-- ------------------------------------------------------------
alter table public.post_comments drop constraint if exists post_comments_key_shape;
alter table public.post_comments
  add constraint post_comments_key_shape
  check (post_key ~ '^[cprl]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

alter table public.post_heat drop constraint if exists post_heat_key_shape;
alter table public.post_heat
  add constraint post_heat_key_shape
  check (post_key ~ '^[cprl]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

-- Same as reward_post_comments.sql, plus the 'l' branch.
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
    select urc.user_id into owner from public.user_reward_cards urc where urc.id = pid;
  elsif kind = 'l' then
    select ul.user_id into owner from public.user_loops ul where ul.id = pid;
  end if;

  if owner is null then
    raise exception 'No such post: %', new.post_key using errcode = '23503';
  end if;

  new.post_owner := owner;

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

-- ------------------------------------------------------------
-- @NAMES IN A LOOP'S CAPTION. Told once the Loop is finished (not while
-- it is still uploading), and again only if the caption changes.
-- ------------------------------------------------------------
create or replace function public.notify_mentions_loop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ready' and new.caption is not null and position('@' in new.caption) > 0
     and (old.status is distinct from 'ready'
          or coalesce(new.caption, '') is distinct from coalesce(old.caption, ''))
  then
    perform public.notify_mentions(new.caption, new.user_id, 'l-' || new.id::text, null);
  end if;
  return new;
end;
$$;

drop trigger if exists notify_mentions_loop on public.user_loops;
create trigger notify_mentions_loop
  after update of status, caption on public.user_loops
  for each row execute function public.notify_mentions_loop();

-- A correct result: one row, 'loops: ok'.
select case when to_regclass('public.user_loops') is not null
             and (select position('user_loops' in prosrc) > 0 from pg_proc where proname = 'post_comments_fill' limit 1)
             and exists (select 1 from pg_constraint where conname = 'post_heat_key_shape'
                          and pg_get_constraintdef(oid) like '%cprl%')
            then 'loops: ok' else 'loops: MISSING' end as status;
