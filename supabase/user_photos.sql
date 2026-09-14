-- ============================================================
-- USER PHOTOS — a picture that is a post, not part of a card.
--
-- WHY THIS IS NOT card_photos
--
-- card_photos answers one question: "what pictures are there OF this
-- card". Every row has a card it belongs to, and that is the point of the
-- table. A photo of you on a good day is not a picture of a card, and
-- hanging it off one had a consequence nobody asked for: you could only
-- take one while adding a card, and it only ever showed up one swipe
-- inside that card's post.
--
-- So it gets its own table and its own kind of post. The feed already
-- mixes sources -- people's cards and the shop's shelf -- and this is a
-- third one. Two tables holding pictures is fine because they are not the
-- same thing and no screen ever has to look in both for one answer: the
-- strip on a card reads card_photos, the feed reads this.
--
-- WHO CAN SEE THEM
--
-- Exactly who can see your cards, which is the rule the whole app already
-- runs on: a public profile is public, and unfollowing is how somebody
-- stops seeing what they do not want to see.
--
-- SAFE TO RUN TWICE.
-- ============================================================

create table if not exists public.user_photos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  object_key text not null,
  caption    text,
  added_at   timestamptz not null default now()
);

comment on table public.user_photos is
  'A photo somebody posted as itself -- not a picture of a card. object_key '
  'is the key inside the R2 bucket, never a URL: the address is built by the '
  'app from CARD_PHOTO_BASE so the photos can move without rewriting a row.';

-- The feed asks "this person's photos, newest first" and pages back through
-- them by added_at, exactly the way it walks a shelf of cards.
create index if not exists user_photos_person_idx
  on public.user_photos (user_id, added_at desc);

alter table public.user_photos enable row level security;

drop policy if exists "owners manage their own photos" on public.user_photos;
create policy "owners manage their own photos"
  on public.user_photos for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "public reads photos of public profiles" on public.user_photos;
create policy "public reads photos of public profiles"
  on public.user_photos for select to anon, authenticated
  using (exists (
    select 1 from public.profiles p
     where p.id = user_photos.user_id
       and p.is_public = true
  ));

-- ============================================================
-- CHECK
-- ============================================================
select count(*) as photo_posts from public.user_photos;
