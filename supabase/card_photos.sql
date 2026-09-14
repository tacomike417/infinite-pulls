-- ============================================================
-- CARD PHOTOS — every picture of a card, in one place.
--
-- WHY THIS REPLACES A COLUMN
--
-- user_cards.photo_key was added for the scanned shot: one column, one
-- photo. Personal pictures -- you holding the card, the moment you pulled
-- it, the shop counter it came off -- mean MANY photos for one card, and a
-- column cannot hold many. It also cannot hold an ORDER, which is the thing
-- somebody wants the first time they take a better picture than the one
-- they already had.
--
-- A photo is a photo. The scanned shot and the selfie beside it are the
-- same kind of thing with a different label, so they live in one table with
-- a `kind` on them. The alternative -- keep the column, add a table -- means
-- two places a photo can be, and every screen that shows one has to remember
-- to look in both. One of them eventually forgets.
--
-- WHO CAN SEE THEM
--
-- Exactly who can see the card. A photo on a public profile's card is
-- public, the same way the card is. That is the decision, made knowingly:
-- unfollowing is how somebody stops seeing what they do not want to see.
--
-- photo_key IS NOT DROPPED. Its values are copied across and then it is left
-- alone. Dropping a column that an older cached copy of the app still asks
-- for does not fail politely -- PostgREST fails the WHOLE query, so a
-- visitor on yesterday's JavaScript would get an empty feed rather than a
-- missing picture. It costs nothing to leave sitting there.
--
-- SAFE TO RUN TWICE.
-- ============================================================

create table if not exists public.card_photos (
  id           uuid primary key default gen_random_uuid(),
  user_card_id uuid not null references public.user_cards(id) on delete cascade,
  user_id      uuid not null references auth.users(id)        on delete cascade,
  object_key   text not null,
  kind         text not null default 'mine' check (kind in ('card', 'mine')),
  sort         smallint not null default 0,
  added_at     timestamptz not null default now()
);

comment on table public.card_photos is
  'Every photo of a card: the scanned shot (kind=card) and the owner''s own '
  'pictures (kind=mine). object_key is the key inside the R2 bucket, never a '
  'URL -- the address is built by the app from CARD_PHOTO_BASE so the photos '
  'can move without rewriting a single row.';

-- The feed asks "the photos for these cards, in order" and nothing else.
create index if not exists card_photos_card_idx
  on public.card_photos (user_card_id, sort, added_at);

alter table public.card_photos enable row level security;

drop policy if exists "owners manage their own card photos" on public.card_photos;
create policy "owners manage their own card photos"
  on public.card_photos for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The same rule user_cards already uses, so a photo is visible exactly when
-- the card it belongs to is.
drop policy if exists "public reads photos of public profiles" on public.card_photos;
create policy "public reads photos of public profiles"
  on public.card_photos for select to anon, authenticated
  using (exists (
    select 1 from public.profiles p
     where p.id = card_photos.user_id
       and p.is_public = true
  ));


-- ============================================================
-- BRING THE SCANNED SHOTS ACROSS
--    Only where there is one, and only once -- re-running finds them
--    already here and does nothing.
-- ============================================================
insert into public.card_photos (user_card_id, user_id, object_key, kind, sort, added_at)
select c.id, c.user_id, c.photo_key, 'card', 0, c.added_at
  from public.user_cards c
 where c.photo_key is not null
   and not exists (
     select 1 from public.card_photos p
      where p.user_card_id = c.id and p.object_key = c.photo_key
   );


-- ============================================================
-- CHECK
-- ============================================================
select
  (select count(*) from public.card_photos)                          as photos,
  (select count(*) from public.card_photos where kind = 'card')      as scanned_shots,
  (select count(*) from public.card_photos where kind = 'mine')      as personal,
  (select count(*) from public.user_cards where photo_key is not null) as old_column_rows;
