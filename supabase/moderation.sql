-- ============================================================
-- REPORTS AND TAKEDOWNS -- 27 Sep 2026 (Mike).
--
-- Report on a post already writes to post_reports. Nobody could read it.
-- This adds the other half:
--
--   * MODERATORS: the shop staff (InfinitePullsTCG) plus anyone in the
--     moderators table -- Mike (tacomike417). Being a moderator reads and
--     handles reports and nothing else; it is NOT shop staff.
--   * HIDDEN POSTS: taking a post down hides it from everybody except its
--     owner and the moderators. Nothing is deleted, so it can come back.
--     It works in the database itself, so the feed, profiles, tags,
--     search and the shared post pages all stop showing it at once.
--
-- SAFE TO RUN TWICE.
-- ============================================================

create table if not exists public.moderators (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.moderators enable row level security;   -- no policies: read only through is_moderator()

insert into public.moderators (user_id)
select id from public.profiles where lower(username) = 'tacomike417'
on conflict do nothing;

create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_shop_staff()
    or exists (select 1 from public.moderators m where m.user_id = auth.uid())
  );
$$;
grant execute on function public.is_moderator() to anon, authenticated;

-- ------------------------------------------------------------
-- Hidden posts. post_key is 'c-', 'p-', 'r-' or 'l-' plus the row id.
-- ------------------------------------------------------------
create table if not exists public.hidden_posts (
  post_key   text primary key,
  post_owner uuid references auth.users(id) on delete cascade,
  hidden_by  uuid references auth.users(id) on delete set null,
  reason     text,
  hidden_at  timestamptz not null default now()
);
alter table public.hidden_posts enable row level security;

drop policy if exists "moderators handle hidden posts" on public.hidden_posts;
create policy "moderators handle hidden posts"
  on public.hidden_posts for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

drop policy if exists "owners see their hidden posts" on public.hidden_posts;
create policy "owners see their hidden posts"
  on public.hidden_posts for select to authenticated
  using (auth.uid() = post_owner);

create or replace function public.post_is_hidden(k text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.hidden_posts h where h.post_key = k);
$$;
grant execute on function public.post_is_hidden(text) to anon, authenticated;

-- Reports are now read and handled by moderators (was: shop staff only).
drop policy if exists "staff read and handle reports" on public.post_reports;
create policy "staff read and handle reports"
  on public.post_reports for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

-- ------------------------------------------------------------
-- THE TAKEDOWN ITSELF. A restrictive rule on each kind of post: whatever
-- else lets you read a row, a hidden one only shows to its owner and the
-- moderators. Reading only -- owners can still edit or delete their own.
-- ------------------------------------------------------------
drop policy if exists "hidden posts stay hidden" on public.user_photos;
create policy "hidden posts stay hidden"
  on public.user_photos as restrictive for select to anon, authenticated
  using (not public.post_is_hidden('p-' || id::text) or auth.uid() = user_id or public.is_moderator());

drop policy if exists "hidden posts stay hidden" on public.user_cards;
create policy "hidden posts stay hidden"
  on public.user_cards as restrictive for select to anon, authenticated
  using (not public.post_is_hidden('c-' || id::text) or auth.uid() = user_id or public.is_moderator());

drop policy if exists "hidden posts stay hidden" on public.user_reward_cards;
create policy "hidden posts stay hidden"
  on public.user_reward_cards as restrictive for select to anon, authenticated
  using (not public.post_is_hidden('r-' || id::text) or auth.uid() = user_id or public.is_moderator());

drop policy if exists "hidden posts stay hidden" on public.user_loops;
create policy "hidden posts stay hidden"
  on public.user_loops as restrictive for select to anon, authenticated
  using (not public.post_is_hidden('l-' || id::text) or auth.uid() = user_id or public.is_moderator());

-- A correct result: one row, 'moderation: ok' -- and Mike is a moderator.
select case when to_regclass('public.hidden_posts') is not null
             and exists (select 1 from public.moderators m join public.profiles p on p.id = m.user_id
                          where lower(p.username) = 'tacomike417')
             and (select count(*) from pg_policies where policyname = 'hidden posts stay hidden') = 4
            then 'moderation: ok' else 'moderation: MISSING' end as status;
