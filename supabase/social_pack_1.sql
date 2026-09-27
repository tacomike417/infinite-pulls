-- ============================================================
-- SOCIAL PACK, PHASE 1 -- 27 Sep 2026.
--
--   1. @MENTIONS NOTIFY. Typing @jeff in a comment or a photo caption
--      tells Jeff ("@you mentioned you") -- in the app and, if he has
--      notifications on, on his phone (push-out sends every new row).
--   2. REPORT A POST, BLOCK A PERSON. Reports go in a table only staff can
--      read. A block is private: the blocked person is never told, and
--      their posts and comments stop showing to you.
--   3. VIEW COUNTS. One number per post, counted once per phone per visit
--      by the app, through one function nobody can use to write anything
--      else.
--
-- (Editing a caption needs nothing here: owners could always update their
-- own photo rows.)
--
-- SAFE TO RUN TWICE.
-- ============================================================

-- ------------------------------------------------------------
-- 1. MENTIONS
-- ------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('comment','reply','heart','follow','heat','dex','goal','wishlist','mention'));

-- Every @name in a piece of text, turned into people, each told once.
-- Ten at most, so one comment cannot ping the whole site.
create or replace function public.notify_mentions(
  p_text text, p_actor uuid, p_post text, p_comment uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  who uuid;
begin
  if p_text is null or p_actor is null then return; end if;
  for who in
    select distinct p.id
      from regexp_matches(p_text, '(?:^|[^A-Za-z0-9_@.])@([A-Za-z0-9_.]{2,31})', 'g') as m(h)
      join public.profiles p on lower(p.username) = lower(rtrim(m.h[1], '.'))
     limit 10
  loop
    perform public.notify_once(who, p_actor, 'mention', p_post, p_comment);
  end loop;
end;
$$;

create or replace function public.notify_mentions_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.hidden_at is null then
    perform public.notify_mentions(new.body, new.user_id, new.post_key, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists notify_mentions_comment on public.post_comments;
create trigger notify_mentions_comment
  after insert on public.post_comments
  for each row execute function public.notify_mentions_comment();

-- A caption, when the photo goes up or when its caption is edited. The
-- once-a-day guard in notify_once stops an edit from pinging twice.
create or replace function public.notify_mentions_photo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or coalesce(new.caption, '') is distinct from coalesce(old.caption, '') then
    perform public.notify_mentions(new.caption, new.user_id, 'p-' || new.id::text, null);
  end if;
  return new;
end;
$$;

drop trigger if exists notify_mentions_photo on public.user_photos;
create trigger notify_mentions_photo
  after insert or update of caption on public.user_photos
  for each row execute function public.notify_mentions_photo();

-- ------------------------------------------------------------
-- 2. REPORTS AND BLOCKS
-- ------------------------------------------------------------
create table if not exists public.post_reports (
  id          uuid primary key default gen_random_uuid(),
  post_key    text not null,
  post_owner  uuid references auth.users(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason      text not null check (char_length(reason) between 1 and 300),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz,
  unique (post_key, reporter_id)
);
alter table public.post_reports enable row level security;

drop policy if exists "people file their own reports" on public.post_reports;
create policy "people file their own reports"
  on public.post_reports for insert to authenticated
  with check (auth.uid() = reporter_id);

drop policy if exists "staff read and handle reports" on public.post_reports;
create policy "staff read and handle reports"
  on public.post_reports for all to authenticated
  using (public.is_shop_staff()) with check (public.is_shop_staff());

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);
alter table public.user_blocks enable row level security;

drop policy if exists "people manage their own blocks" on public.user_blocks;
create policy "people manage their own blocks"
  on public.user_blocks for all to authenticated
  using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- ------------------------------------------------------------
-- 3. VIEW COUNTS
-- ------------------------------------------------------------
create table if not exists public.post_view_counts (
  post_key text primary key,
  n        bigint not null default 0
);
alter table public.post_view_counts enable row level security;

drop policy if exists "anyone reads view counts" on public.post_view_counts;
create policy "anyone reads view counts"
  on public.post_view_counts for select to anon, authenticated using (true);

-- The only way in: add one view to each of these posts. Fifty keys a call,
-- post-shaped keys only, so it cannot be used to write anything else.
create or replace function public.record_views(p_keys text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.post_view_counts as v (post_key, n)
  select distinct k, 1
    from unnest(p_keys[1:50]) as k
   where k ~ '^(c|p|r)-[0-9a-zA-Z_-]{3,80}$'
  on conflict (post_key) do update set n = v.n + 1;
end;
$$;

revoke all on function public.record_views(text[]) from public;
grant execute on function public.record_views(text[]) to anon, authenticated;

-- A correct result: three rows of 'ok'.
select 'mentions' as part, case when exists (select 1 from pg_trigger where tgname = 'notify_mentions_comment') then 'ok' else 'MISSING' end as status
union all
select 'reports and blocks', case when to_regclass('public.user_blocks') is not null and to_regclass('public.post_reports') is not null then 'ok' else 'MISSING' end
union all
select 'view counts', case when to_regclass('public.post_view_counts') is not null then 'ok' else 'MISSING' end;
