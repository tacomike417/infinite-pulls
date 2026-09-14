-- ============================================================
-- KEEP THIS ONE OFF THE FEED.
--
-- A card in your collection is a post in the feed -- there is no separate
-- posts table, the row IS the post. Which is the right design, and it left
-- one thing missing: no way to own a card quietly. A mis-scan, a card you
-- would rather not advertise, forty commons imported in one sitting -- all
-- of it went out to everybody with no way to take any of it back short of
-- deleting the card.
--
-- So: one boolean. The card stays in your collection, in your Pokedex, in
-- your value total and on your profile. It simply stops being a post.
--
-- NOT NULL DEFAULT FALSE on purpose. A nullable flag means every query that
-- filters on it has to say "false or null", and the day somebody forgets,
-- half the feed disappears.
--
-- SAFE TO RUN TWICE.
-- ============================================================

alter table public.user_cards
  add column if not exists hidden_feed boolean not null default false;

comment on column public.user_cards.hidden_feed is
  'True = this card is not shown in the feed. It is still owned, still '
  'counted, still in My Collection -- it is only the post that is gone.';

-- The feed asks one person for their newest cards and skips the hidden
-- ones, so the flag belongs in that index rather than in one of its own.
create index if not exists user_cards_feed_idx
  on public.user_cards (user_id, added_at desc)
  where hidden_feed = false;

-- ============================================================
-- CHECK
-- ============================================================
select
  count(*)                                as cards,
  count(*) filter (where hidden_feed)     as kept_off_the_feed
from public.user_cards;
