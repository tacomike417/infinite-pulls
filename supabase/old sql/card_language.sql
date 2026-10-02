-- ============================================================
-- Japanese cards: two new columns on the collection tables.
--
-- SAFE AGAINST LIVE DATA. This file only ADDS columns. It contains no
-- delete, no drop, no update, and no insert — nobody's cards are touched,
-- and running it twice does nothing the second time.
--
-- WHY THESE TWO:
--
--   card_lang — TCGdex is not one database with translations, it's one
--     database PER LANGUAGE. api.tcgdex.net/v2/en and /v2/ja have
--     different sets, different numbering, and cards that only exist in
--     one of them. A saved card id does not say which one it came from,
--     and asking the wrong database for an id just 404s. So without this
--     column a Japanese card could be added and then never loaded again.
--     Defaulting to 'en' is not a guess: every row that exists today was
--     added when the app only ever talked to the English database.
--
--   dex_id — which Pokémon the card is. My Pokédex counts a card toward a
--     species by looking for the species name inside the printed card
--     name, which can never work for a Japanese card: リザードンex does
--     not contain the word "Charizard". Storing the National Dex number
--     at add time is what lets a Japanese card be counted at all. Left
--     null on old rows, which keep using the name matching they always
--     did — see rowIsSpecies() in components/pokemon-data.js.
--
-- Both are filled in on new adds, and quietly backfilled onto older rows
-- whenever their card detail gets opened (backfillCardMetadata in
-- components/collection.js), the same way rarity/illustrator/set_id were.
-- ============================================================

alter table public.user_cards     add column if not exists card_lang text not null default 'en';
alter table public.user_cards     add column if not exists dex_id    integer;

alter table public.wishlist_cards add column if not exists card_lang text not null default 'en';
alter table public.wishlist_cards add column if not exists dex_id    integer;

-- Only the languages the app actually knows how to fetch. Added as NOT
-- VALID first so an existing row could never block the migration, then
-- validated — which passes, because every existing row is 'en' by the
-- default above.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_cards_card_lang_known') then
    alter table public.user_cards
      add constraint user_cards_card_lang_known check (card_lang in ('en','ja')) not valid;
    alter table public.user_cards validate constraint user_cards_card_lang_known;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'wishlist_cards_card_lang_known') then
    alter table public.wishlist_cards
      add constraint wishlist_cards_card_lang_known check (card_lang in ('en','ja')) not valid;
    alter table public.wishlist_cards validate constraint wishlist_cards_card_lang_known;
  end if;
end $$;

-- My Pokédex reads every owned row and buckets them by dex number, so an
-- index on (user_id, dex_id) is the one that matters for it.
create index if not exists user_cards_user_dex_idx on public.user_cards(user_id, dex_id);

-- ============================================================
-- The result you should see: one row per table, all four columns "yes".
-- ============================================================
select
  t.table_name,
  bool_or(t.column_name = 'card_lang')                                  as has_card_lang,
  bool_or(t.column_name = 'dex_id')                                     as has_dex_id,
  (select count(*) from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = t.table_name)   as total_columns
from information_schema.columns t
where t.table_schema = 'public'
  and t.table_name in ('user_cards','wishlist_cards')
group by t.table_name
order by t.table_name;
