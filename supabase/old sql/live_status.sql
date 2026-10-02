-- ============================================================
-- JEFF IS LIVE -- 25 Sep 2026 (SOCIAL-NEXT part 7)
--
-- One row that says whether the shop is streaming right now, and where.
-- The feed reads it: while is_live is true, the "Start here" card at the
-- top of the feed becomes his live stream (YouTube, fed by Whatnot's
-- Multicast), with BID ON WHATNOT and SHOP INFINITE PULLS under it, and
-- his photo gets the red LIVE ring.
--
-- Anyone can READ it (the feed is public). Only shop staff can change it,
-- through the "We're live" switch in the admin screen.
-- SAFE TO RUN TWICE.
-- ============================================================

create table if not exists public.live_status (
  id           int primary key default 1 check (id = 1),     -- exactly one row
  is_live      boolean     not null default false,
  youtube_channel_id text,          -- UC... -- the embed plays whatever is live on it
  whatnot_url  text,                -- where BID ON WHATNOT goes
  title        text,                -- optional line, e.g. "Sunday night breaks"
  started_at   timestamptz,
  updated_at   timestamptz not null default now()
);

insert into public.live_status (id) values (1) on conflict (id) do nothing;

alter table public.live_status drop constraint if exists live_status_youtube_id;
alter table public.live_status add constraint live_status_youtube_id
  check (youtube_channel_id is null or youtube_channel_id ~ '^UC[A-Za-z0-9_-]{20,24}$');
alter table public.live_status drop constraint if exists live_status_whatnot_url;
alter table public.live_status add constraint live_status_whatnot_url
  check (whatnot_url is null or whatnot_url ~ '^https://(www\.)?whatnot\.com/');

alter table public.live_status enable row level security;

drop policy if exists "anyone can see if the shop is live" on public.live_status;
create policy "anyone can see if the shop is live"
  on public.live_status for select using (true);

drop policy if exists "shop staff flip the live switch" on public.live_status;
create policy "shop staff flip the live switch"
  on public.live_status for update
  using (public.is_shop_staff()) with check (public.is_shop_staff());

grant select on public.live_status to anon, authenticated;
grant update on public.live_status to authenticated;

-- Check: one row, not live yet.
select id, is_live, youtube_channel_id, whatnot_url from public.live_status;
