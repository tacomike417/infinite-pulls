-- ============================================================
-- THE GALLERY — photos of the shop, what is in the case, and what
-- customers have pulled.
--
-- SAFE AGAINST LIVE DATA. Creates new tables and one new storage bucket.
-- Touches nothing that already exists. No drop of anything you have, no
-- update to a single existing row. Running it twice does nothing the
-- second time.
--
-- WHAT THIS IS FOR
--
-- Jeff asked for somewhere to put pictures. The pictures are the easy
-- part. What this schema is actually built around is everything a photo
-- has to become after he takes it: a page with its own address, a link
-- that unfurls properly when he pastes it into Facebook, something Google
-- can find, and a number the next morning telling him whether any of it
-- worked.
--
-- THE THREE RULES THIS FILE EXISTS TO ENFORCE
--
-- 1. NOTHING IS EVER TRULY DELETED. Photos go to a holding state for 30
--    days. A customer's submission he rejects is still their photo, and
--    they may not have another copy. `trashed_at` is the whole mechanism.
--
-- 2. A URL, ONCE SHARED, NEVER DIES. Every link Jeff posts to Facebook
--    lives on his page forever. If a slug is ever edited, the old one
--    keeps working — see `gallery_slug_aliases`. Renaming a photo must
--    never turn a post he made in March into a dead link.
--
-- 3. NOTHING FROM A STRANGER GOES PUBLIC WITHOUT A TAP. Customer
--    submissions land as `pending` and are invisible to everybody but
--    staff until approved. There are two independent controls: the master
--    switch (are submissions open at all) and the per-photo approval.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--
-- No comments table. Reactions can't turn on the shop; a comment thread
-- is a job somebody has to do every day. If that changes, it is a new
-- table and a switch, not a rework of this one.
-- ============================================================


-- ============================================================
-- 1. THE MASTER SWITCH
--
--    One row, and it is meant to stay one row — the `check (id)` on a
--    boolean primary key is the standard trick for a settings table that
--    can never accidentally grow a second, conflicting copy of itself.
--
--    Every one of these is a thing Jeff can turn off from his phone on a
--    week he does not want to deal with it, without losing anything he
--    has already posted.
-- ============================================================
create table if not exists public.gallery_settings (
  id                boolean primary key default true check (id),

  -- Is the gallery visible on the site at all.
  gallery_on        boolean not null default true,

  -- Can customers submit their own pull photos. OFF by default: the
  -- feature exists quietly until he decides he wants to moderate.
  submissions_on    boolean not null default false,

  -- Does the upload form offer generated caption options.
  captions_on       boolean not null default true,

  -- Reactions (a tap, no text). Comments are deliberately not here.
  reactions_on      boolean not null default true,

  -- The tile on the home page. Its label is editable because "See what
  -- just landed" is a promise that something is new, and if the shop goes
  -- quiet for a month he may want to say something else.
  home_tile_on      boolean not null default true,
  home_tile_label   text    not null default 'See what just landed',

  -- Shown to a customer on the submit form. Kept here rather than in the
  -- JavaScript so the house rules can be reworded without a deploy.
  submit_blurb      text    not null default
    'Pulled something good at Infinite Pulls? Send us the photo — if we put it up, we''ll credit you.',

  updated_at        timestamptz not null default now()
);

insert into public.gallery_settings (id) values (true)
on conflict (id) do nothing;


-- ============================================================
-- 2. THE PHOTOS
--
--    One row is one photo, whoever it came from. A shop post and a
--    customer submission differ by `source` and `status`, not by living
--    in separate tables — the moment they are two tables, every query,
--    every policy and every piece of the admin panel has to be written
--    twice and kept in step.
--
--    ON THE TEXT FIELDS, because there are more of them than you would
--    expect for "a photo with a caption":
--
--      caption           the funny one. What a person reads. 8-18 words.
--      title             the page heading, and the <title> tag.
--      alt_text          what the image is, plainly, for screen readers
--                        and for Google Images.
--      meta_description  the sentence under the link in search results.
--      keyword           the one thing this photo is about.
--
--    They are separate because they have different jobs and different
--    audiences. The caption carries the personality and the keyword once,
--    naturally. The other three carry the keyword for machines, where no
--    customer ever sees it. Trying to make one sentence serve both is
--    exactly what produces a caption that reads like an advert.
-- ============================================================
create table if not exists public.gallery_items (
  id                uuid primary key default gen_random_uuid(),

  -- The URL. infinitepulls.com/pulls/<slug>
  -- Unique, permanent in practice, and never reused — see the alias
  -- table below for what happens when one is edited anyway.
  slug              text not null unique,

  title             text not null default '',
  caption           text not null default '',
  alt_text          text not null default '',
  meta_description  text not null default '',
  keyword           text not null default '',

  -- What he tapped on the upload form: 'just-pulled', 'restock',
  -- 'case-break', 'in-the-case', 'store', 'event', plus set names.
  -- An array rather than a join table because these are labels on a
  -- photo, not entities with a life of their own.
  chips             text[] not null default '{}',

  -- The original, and the three crops generated in the browser at upload
  -- time. Storing the derived URLs rather than regenerating on demand:
  -- Facebook needs a stable image URL it can cache, and a crop that
  -- changes shape after it has been shared is worse than no crop.
  image_url         text not null,
  image_square_url  text,          -- 1080x1080, the feed
  image_story_url   text,          -- 1080x1920, stories
  image_og_url      text,          -- 1200x630, the link preview

  image_width       integer,
  image_height      integer,

  -- 'shop' — Jeff posted it. 'customer' — somebody submitted it.
  source            text not null default 'shop'
                    check (source in ('shop','customer')),

  -- Set for customer submissions, so an approved photo can credit them
  -- and link to their public collector page. Null for shop posts.
  submitted_by      uuid references auth.users(id) on delete set null,
  -- Captured at submit time. A person can change their username later and
  -- a link Jeff already posted should still say who it was.
  submitted_name    text,

  --   draft      Jeff started it and got interrupted. Only he sees it.
  --   pending    a customer sent it. Only staff see it.
  --   published  live.
  --   hidden     was live, taken down, not deleted. Reversible in a tap.
  --   trashed    on its way out. See `trashed_at`. Still reversible.
  status            text not null default 'draft'
                    check (status in ('draft','pending','published','hidden','trashed')),

  -- Rule 1. Nothing hard-deletes. A rejected submission sits here for 30
  -- days in case the customer wants it back or Jeff changes his mind.
  trashed_at        timestamptz,

  -- Rule from the push conversation: a notification cannot be recalled,
  -- so it is a deliberate button and it only works once. Non-null means
  -- the button is spent and the panel greys it out.
  notified_at       timestamptz,

  -- The numbers Jeff sees the next morning. These are the whole reason he
  -- keeps posting, so they are first-class columns and not an afterthought.
  view_count        integer not null default 0,
  share_count       integer not null default 0,
  reaction_count    integer not null default 0,

  -- Pins a photo to the top of the gallery.
  featured          boolean not null default false,

  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- The gallery reads "published, newest first" on nearly every request.
create index if not exists gallery_items_live_idx
  on public.gallery_items (published_at desc)
  where status = 'published';

-- The approval queue reads "pending, oldest first" — oldest first because
-- somebody has been waiting.
create index if not exists gallery_items_pending_idx
  on public.gallery_items (created_at)
  where status = 'pending';

create index if not exists gallery_items_submitter_idx
  on public.gallery_items (submitted_by);


-- ============================================================
-- 3. OLD URLS NEVER DIE
--
--    Rule 2. Jeff pastes infinitepulls.com/pulls/moonbreon-just-landed
--    into Facebook. Three weeks later somebody fixes a typo in the slug.
--    Without this table, that Facebook post is now a dead link and
--    nobody will ever tell him.
--
--    With it, the old address is kept forever and redirects. Rename
--    freely; nothing he has ever posted breaks. The trigger below does
--    this automatically, so it cannot be forgotten.
-- ============================================================
create table if not exists public.gallery_slug_aliases (
  slug        text primary key,
  item_id     uuid not null references public.gallery_items(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists gallery_slug_aliases_item_idx
  on public.gallery_slug_aliases (item_id);

create or replace function public.gallery_keep_old_slug()
returns trigger
language plpgsql
as $$
begin
  if new.slug is distinct from old.slug then
    insert into public.gallery_slug_aliases (slug, item_id)
    values (old.slug, new.id)
    on conflict (slug) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists gallery_items_keep_old_slug on public.gallery_items;
create trigger gallery_items_keep_old_slug
  after update of slug on public.gallery_items
  for each row
  execute function public.gallery_keep_old_slug();


-- ============================================================
-- 4. MAKING A SLUG
--
--    Readable, lowercase, hyphenated, and never colliding — with an
--    existing photo OR with an address that used to belong to one. A slug
--    that was retired still owns its URL, so it has to be checked too.
-- ============================================================
create or replace function public.gallery_slugify(raw text)
returns text
language sql
immutable
as $$
  select trim(both '-' from
    regexp_replace(
      regexp_replace(lower(coalesce(raw, '')), '[^a-z0-9]+', '-', 'g'),
      '-{2,}', '-', 'g'
    )
  );
$$;

create or replace function public.gallery_unique_slug(raw text)
returns text
language plpgsql
stable
as $$
declare
  base text := public.gallery_slugify(raw);
  try  text;
  n    integer := 1;
begin
  if base = '' then base := 'photo'; end if;
  -- Long URLs get truncated in feeds and read as spam. Six or seven words
  -- is plenty to be both readable and specific.
  base := left(base, 70);
  base := trim(both '-' from base);
  try := base;

  while exists (select 1 from public.gallery_items where slug = try)
     or exists (select 1 from public.gallery_slug_aliases where slug = try)
  loop
    n := n + 1;
    try := base || '-' || n::text;
  end loop;

  return try;
end;
$$;


-- ============================================================
-- 5. REACTIONS
--
--    A tap, never text. `voter` is either a signed-in account or a token
--    the browser keeps, which is what lets somebody react without making
--    an account while still stopping the same phone counting twenty
--    times. It is not fraud-proof and is not trying to be — it is a
--    number that tells Jeff people liked a photo.
-- ============================================================
create table if not exists public.gallery_reactions (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.gallery_items(id) on delete cascade,
  -- 'u:<uuid>' for an account, 'a:<random>' for a browser.
  voter       text not null,
  kind        text not null default 'fire' check (kind in ('fire','heart')),
  created_at  timestamptz not null default now(),
  unique (item_id, voter, kind)
);

create index if not exists gallery_reactions_item_idx
  on public.gallery_reactions (item_id);

-- The count lives on the photo as well, because the gallery grid shows it
-- for every tile and counting rows per tile on every page load is the
-- kind of thing that is fine at 30 photos and miserable at 3,000.
create or replace function public.gallery_sync_reaction_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.item_id, old.item_id);
begin
  update public.gallery_items
     set reaction_count = (
       select count(*) from public.gallery_reactions where item_id = target
     )
   where id = target;
  return null;
end;
$$;

drop trigger if exists gallery_reactions_count on public.gallery_reactions;
create trigger gallery_reactions_count
  after insert or delete on public.gallery_reactions
  for each row
  execute function public.gallery_sync_reaction_count();


-- ============================================================
-- 6. COUNTING VIEWS AND SHARES
--
--    An RPC rather than a row per view. A views table would be more
--    precise and would also be the biggest table in the database inside a
--    year, for a number that only ever gets read as "143". If per-day
--    view history is ever wanted, that is a nightly snapshot job like the
--    one collection values already use — not a row per eyeball.
--
--    security definer because an anonymous visitor has no write access to
--    gallery_items and should not be given any. This function is the only
--    door, and it can only ever add one to a counter on a photo that is
--    actually published.
-- ============================================================
create or replace function public.gallery_bump_view(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.gallery_items
     set view_count = view_count + 1
   where slug = p_slug
     and status = 'published';
end;
$$;

create or replace function public.gallery_bump_share(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.gallery_items
     set share_count = share_count + 1
   where slug = p_slug
     and status = 'published';
end;
$$;

grant execute on function public.gallery_bump_view(text)  to anon, authenticated;
grant execute on function public.gallery_bump_share(text) to anon, authenticated;


-- ============================================================
-- 7. HOUSEKEEPING TRIGGERS
-- ============================================================
create or replace function public.gallery_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();

  -- The first time a photo goes live, stamp it. Re-publishing something
  -- that was hidden keeps its original date — the photo is not new again
  -- just because it came back.
  if new.status = 'published' and new.published_at is null then
    new.published_at = now();
  end if;

  -- Entering and leaving the bin, handled here so no caller can forget.
  if new.status = 'trashed' and old.status is distinct from 'trashed' then
    new.trashed_at = now();
  elsif new.status <> 'trashed' then
    new.trashed_at = null;
  end if;

  return new;
end;
$$;

drop trigger if exists gallery_items_touch on public.gallery_items;
create trigger gallery_items_touch
  before update on public.gallery_items
  for each row
  execute function public.gallery_touch_updated_at();

create or replace function public.gallery_settings_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists gallery_settings_touch on public.gallery_settings;
create trigger gallery_settings_touch
  before update on public.gallery_settings
  for each row
  execute function public.gallery_settings_touch();


-- ============================================================
-- 8. ARE SUBMISSIONS OPEN
--
--    The master switch, readable from a policy. security definer so the
--    check works for a customer who has no business reading the settings
--    table directly.
-- ============================================================
create or replace function public.gallery_submissions_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select submissions_on from public.gallery_settings where id), false);
$$;

grant execute on function public.gallery_submissions_open() to anon, authenticated;


-- ============================================================
-- 9. WHO CAN READ AND WRITE
--
--    Staff is `public.is_shop_staff()` from admin_lockdown.sql — the same
--    gate as the banner, the hours and the Dex. If that file has not been
--    run yet, run it first; this one depends on it existing.
--
--    The shape:
--      everyone      reads published photos, and the settings the site
--                    needs to render itself
--      a customer    reads their own submission (so the app can say
--                    "waiting for Jeff"), and creates one only while
--                    submissions are open
--      staff         everything
--
--    Note what a customer explicitly CANNOT do: change a submission after
--    sending it. Otherwise an approved photo could be swapped for a
--    different one after Jeff has looked at it, which is the one way this
--    feature could genuinely embarrass the shop.
-- ============================================================
alter table public.gallery_items      enable row level security;
alter table public.gallery_settings   enable row level security;
alter table public.gallery_reactions  enable row level security;
alter table public.gallery_slug_aliases enable row level security;

-- ---- the photos ----
drop policy if exists "anyone reads published photos" on public.gallery_items;
create policy "anyone reads published photos"
  on public.gallery_items for select
  to anon, authenticated
  using (status = 'published');

drop policy if exists "people read their own submissions" on public.gallery_items;
create policy "people read their own submissions"
  on public.gallery_items for select
  to authenticated
  using (submitted_by = auth.uid());

drop policy if exists "people submit photos while submissions are open" on public.gallery_items;
create policy "people submit photos while submissions are open"
  on public.gallery_items for insert
  to authenticated
  with check (
    public.gallery_submissions_open()
    and source       = 'customer'
    and status       = 'pending'
    and submitted_by = auth.uid()
    and notified_at is null
    and featured     is false
  );

drop policy if exists "staff read every photo" on public.gallery_items;
create policy "staff read every photo"
  on public.gallery_items for select
  to authenticated
  using (public.is_shop_staff());

drop policy if exists "staff manage photos" on public.gallery_items;
create policy "staff manage photos"
  on public.gallery_items for all
  to authenticated
  using (public.is_shop_staff())
  with check (public.is_shop_staff());

-- ---- the master switch ----
-- Readable by everyone: the site has to know whether to draw the gallery
-- at all, and an anonymous visitor is exactly who that question is about.
drop policy if exists "anyone reads gallery settings" on public.gallery_settings;
create policy "anyone reads gallery settings"
  on public.gallery_settings for select
  to anon, authenticated
  using (true);

drop policy if exists "staff change gallery settings" on public.gallery_settings;
create policy "staff change gallery settings"
  on public.gallery_settings for all
  to authenticated
  using (public.is_shop_staff())
  with check (public.is_shop_staff());

-- ---- reactions ----
drop policy if exists "anyone reads reactions" on public.gallery_reactions;
create policy "anyone reads reactions"
  on public.gallery_reactions for select
  to anon, authenticated
  using (true);

-- Anonymous reactions are the point — most people looking at a photo Jeff
-- shared on Facebook have no account and never will. The check keeps a
-- reaction attached to a photo that is actually live.
drop policy if exists "anyone reacts to a live photo" on public.gallery_reactions;
create policy "anyone reacts to a live photo"
  on public.gallery_reactions for insert
  to anon, authenticated
  with check (
    exists (
      select 1 from public.gallery_items i
       where i.id = item_id and i.status = 'published'
    )
  );

drop policy if exists "staff manage reactions" on public.gallery_reactions;
create policy "staff manage reactions"
  on public.gallery_reactions for all
  to authenticated
  using (public.is_shop_staff())
  with check (public.is_shop_staff());

-- ---- slug aliases ----
-- Public read: resolving an old link is something an anonymous visitor
-- arriving from a months-old Facebook post has to be able to do.
drop policy if exists "anyone resolves an old link" on public.gallery_slug_aliases;
create policy "anyone resolves an old link"
  on public.gallery_slug_aliases for select
  to anon, authenticated
  using (true);

drop policy if exists "staff manage slug aliases" on public.gallery_slug_aliases;
create policy "staff manage slug aliases"
  on public.gallery_slug_aliases for all
  to authenticated
  using (public.is_shop_staff())
  with check (public.is_shop_staff());


-- ============================================================
-- 10. THE BUCKET
--
--     Public, like `avatars` in schema.sql section 7 — these are photos
--     meant to be seen by strangers on Facebook, and a signed URL that
--     expires would break every link Jeff has ever posted.
--
--     Folder layout, and the write policies depend on it:
--       shop/<uuid>/original.jpg        staff only
--       shop/<uuid>/square.jpg
--       submissions/<user-id>/<uuid>.jpg   that user only
--
--     A customer can write into their own submissions folder and nowhere
--     else, which is the storage half of "nothing from a stranger goes
--     public without a tap" — they can put a file in the bucket, but the
--     row that would make it visible is still pending.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('gallery', 'gallery', true)
on conflict (id) do nothing;

drop policy if exists "public read gallery" on storage.objects;
create policy "public read gallery"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'gallery');

drop policy if exists "staff write gallery" on storage.objects;
create policy "staff write gallery"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'gallery' and public.is_shop_staff())
  with check (bucket_id = 'gallery' and public.is_shop_staff());

drop policy if exists "people upload their own submissions" on storage.objects;
create policy "people upload their own submissions"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'gallery'
    and public.gallery_submissions_open()
    and (storage.foldername(name))[1] = 'submissions'
    and (storage.foldername(name))[2] = auth.uid()::text
  );


-- ============================================================
-- 11. WHAT THE SITE READS
--
--     One view, so the public app and the page builder ask the same
--     question and can never drift apart in what "live" means.
-- ============================================================
create or replace view public.gallery_public as
  select
    id, slug, title, caption, alt_text, meta_description, keyword, chips,
    image_url, image_square_url, image_story_url, image_og_url,
    image_width, image_height,
    source, submitted_name,
    view_count, share_count, reaction_count,
    featured, published_at
  from public.gallery_items
  where status = 'published'
  order by featured desc, published_at desc;

grant select on public.gallery_public to anon, authenticated;


-- ============================================================
-- 12. TAKING OUT THE BIN
--
--     Thirty days, then actually gone. Not scheduled by this file — call
--     it from the same daily cron that already runs the price alerts, or
--     leave it and the bin simply keeps everything. Doing nothing is a
--     safe failure here, which is why it is not automatic.
--
--     Note it only removes the ROW. The image files stay in the bucket
--     until somebody removes them deliberately, because a storage delete
--     is the one genuinely irreversible thing in this whole feature.
-- ============================================================
create or replace function public.gallery_empty_bin(older_than_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  with gone as (
    delete from public.gallery_items
     where status = 'trashed'
       and trashed_at < now() - make_interval(days => older_than_days)
    returning 1
  )
  select count(*) into removed from gone;
  return removed;
end;
$$;


-- ============================================================
-- What you should see: the master switch with submissions OFF, no photos
-- yet, and a bucket named gallery.
-- ============================================================
select
  (select count(*) from public.gallery_items)                              as photos,
  (select count(*) from public.gallery_items where status = 'published')   as published,
  (select count(*) from public.gallery_items where status = 'pending')     as waiting_for_approval,
  (select submissions_on from public.gallery_settings where id)            as submissions_open,
  (select home_tile_label from public.gallery_settings where id)           as home_tile,
  (select count(*) from storage.buckets where id = 'gallery')              as bucket_exists;
