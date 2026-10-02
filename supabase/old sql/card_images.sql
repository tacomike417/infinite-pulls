-- Infinite Pulls — card artwork, captured from a fetch we already make
-- ===================================================================
--
-- WHY THERE WAS NO ART OUTSIDE A CARD'S OWN PAGE
--
-- public.cards is an identity index -- name, set, number, rarity. It has
-- never held an image, so anything wanting artwork had to go and ask
-- TCGdex for the whole card object one card at a time. That is fine for
-- ONE card on the lookup page. It is exactly the wrong thing for a rail of
-- twenty, which is why every list in this app has been text.
--
-- THE FETCH IS ALREADY HAPPENING
--
-- sync-prices walks all 36,771 cards every Sunday and pulls the complete
-- TCGdex object for each one, purely to read two prices out of it. That
-- same object carries `image` and the function has been discarding it
-- every week. Storing it costs no request, no rate limit and no extra
-- second -- it is already in memory when the prices are read.
--
-- WHAT IS STORED
--
-- The BASE, exactly as TCGdex gives it and with no extension:
--
--     https://assets.tcgdex.net/en/base/base1/4
--
-- The size is chosen at the point of use -- '/low.webp' in a rail,
-- '/high.webp' on the card's own page. Storing a finished URL would pin
-- every future screen to whichever size the first one happened to want.
-- This is the same string components/card-lookup.js already appends to.
--
-- COVERAGE
--
-- The backfill below fills in whatever is already sitting in
-- tcgdex_cache, which is every card anybody has looked up. The rest fills
-- itself on the next weekly price run. Until then a card without art shows
-- its placeholder, which is the honest state and not a broken image.
--
-- SAFE TO RUN TWICE.

alter table public.cards
  add column if not exists image_base text;

comment on column public.cards.image_base is
  'TCGdex artwork base URL with no extension, e.g. https://assets.tcgdex.net/en/base/base1/4 -- append /low.webp or /high.webp at the point of use. Captured free by sync-prices, which already fetches the whole card object for its prices.';

-- Only rows that need it, so re-running this is cheap rather than a
-- full-table rewrite.
create index if not exists cards_missing_image
  on public.cards (dataset_id) where image_base is null;

-- ==========================================================
-- BACKFILL from what has already been fetched
-- ==========================================================
--
-- tcgdex_cache keys on the API path with no leading slash --
-- 'en/cards/base1-4' -- so language is segment 1 and the card id is
-- segment 3. Both halves are needed: tcgdex_id is not unique across
-- languages, and matching on it alone would put an English card's artwork
-- on the Japanese row.

update public.cards c
set image_base = t.img
from (
  select split_part(t.path, '/', 1) as lang,
         split_part(t.path, '/', 3) as tcgdex_id,
         t.payload->>'image'        as img
  from public.tcgdex_cache t
  where t.kind = 'card'
    and coalesce(t.payload->>'image', '') <> ''
) t
where c.tcgdex_id = t.tcgdex_id
  and c.language  = t.lang
  and c.image_base is distinct from t.img;

-- ==========================================================
-- THE DOOR sync-prices WRITES THROUGH
-- ==========================================================
--
-- One call per slice of 400 rather than 400 calls. The Edge Function has
-- the images in hand already; this just lands them.
--
-- security definer because cards is read-only from the browser by design
-- (see the RLS note in cards_index.sql) and that stays true -- execute is
-- revoked from anon and authenticated below, so the service role inside
-- the Edge Function is the only caller.

create or replace function public.set_card_images(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  update public.cards c
  set image_base = r.image
  from jsonb_to_recordset(p_rows) as r(dataset_id text, image text)
  where c.dataset_id = r.dataset_id
    and coalesce(r.image, '') <> ''
    and c.image_base is distinct from r.image;
  get diagnostics touched = row_count;
  return touched;
end;
$$;

comment on function public.set_card_images(jsonb) is
  'Bulk-sets cards.image_base from [{dataset_id, image}, ...]. Called once per slice by the sync-prices Edge Function, which already holds the artwork URL while reading prices out of the same object.';

revoke all on function public.set_card_images(jsonb) from public, anon, authenticated;

-- ==========================================================
-- HOW FAR ALONG IS IT?
-- ==========================================================
--
-- Run this after a weekly price run. `with_art` could climb to nearly
-- `total` on the first Sunday after this is installed.
--
--   select count(*) as total,
--          count(image_base) as with_art,
--          round(100.0 * count(image_base) / nullif(count(*),0), 1) as pct
--   from public.cards;
