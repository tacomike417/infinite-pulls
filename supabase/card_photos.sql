-- ============================================================
-- CARD PHOTOS — keep the picture the scanner already took.
--
-- Scanning a card photographs it, sends the frame off to be identified,
-- and then drops it. The collection has been keeping the catalog art
-- instead. This is the column that keeps the real one.
--
-- WHY A KEY AND NOT A URL. What goes in here is the object's key inside
-- the R2 bucket -- u/<user id>/<card id>-<timestamp>-<random>.webp -- and
-- the app builds the address from CARD_PHOTO_BASE in config.js. Photos can
-- then move to a different domain later without rewriting every row that
-- was ever saved. A hostname in a database is a promise you may not want
-- to keep.
--
-- NO POLICY CHANGES ARE NEEDED. This is a column on user_cards, and
-- user_cards already has its rules: a person manages their own rows, and
-- anybody may read the rows of a profile whose is_public is true. A photo
-- follows the card it belongs to, and it is hidden or shown by the same
-- switch. Nothing here widens what anyone can see.
--
-- SAFE TO RUN TWICE.
-- ============================================================

alter table public.user_cards
  add column if not exists photo_key text;

comment on column public.user_cards.photo_key is
  'R2 object key for the owner''s own photo of this card, taken at scan time. '
  'NULL means nobody has photographed it and the catalog art in image_url is '
  'what gets shown. Not a URL -- the app builds the address from '
  'CARD_PHOTO_BASE so the photos can be moved without touching these rows.';

-- Most cards will never have one, so the index only bothers with the ones
-- that do. This is what makes "show me the photographed cards first" cheap
-- if the feed ever wants to do that.
create index if not exists user_cards_photo_idx
  on public.user_cards (user_id)
  where photo_key is not null;
