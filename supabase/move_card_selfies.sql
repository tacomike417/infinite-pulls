-- ============================================================
-- MOVE CARD SELFIES INTO PHOTO POSTS -- 27 Sep 2026.
--
-- Card posts no longer take extra pictures (Mike: a card post is the card;
-- anything of your own is a photo post). The one picture that was added
-- the old way becomes its own photo post, same person, same date, same
-- picture -- so it shows up in their My Photos and nothing is lost.
--
-- The scanned picture of the card (kind = 'card') is NOT touched.
-- Safe to run twice: the second run finds nothing left to move.
-- ============================================================

with moved as (
  delete from public.card_photos
   where kind = 'mine'
  returning user_id, object_key, added_at
)
insert into public.user_photos (user_id, object_key, added_at)
select user_id, object_key, added_at from moved;

-- A correct result: left_on_cards = 0.
select (select count(*) from public.card_photos where kind = 'mine') as left_on_cards,
       (select count(*) from public.user_photos)                     as photo_posts_now;
