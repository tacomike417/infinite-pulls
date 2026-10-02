-- ==========================================================
-- THE LOCAL CARD INDEX
-- ==========================================================
--
-- WHY THIS EXISTS
--
-- Every card lookup in this app has been a network round trip to TCGdex,
-- and TCGdex's card search is a SUBSTRING match on a field we do not
-- control. That is where the worst scanner bug came from: a card prints
-- 082/198, TCGdex stores that localId as "82", and a query for "082"
-- returns nothing because "082" does not appear inside "82". A perfectly
-- read number, and "nothing found".
--
-- The whole catalogue is 36,771 cards and it does not change. Held here,
-- a lookup stops being a search and becomes what it always should have
-- been: one exact row.
--
-- 14,491 of those cards carry leading zeros and 20,660 do not. We now
-- know which is which for every single one, so nothing is guessed.
--
-- SOURCE: TCGdex cards-database commit b73a03b7 (MIT), 2026-09-04,
-- with Japanese English-name translations from PokeAPI. Snapshot, not
-- eternal truth -- re-importing is safe and is how this stays current.
--
-- SAFE TO RUN TWICE.

-- ==========================================================
-- PART 1 -- staging
-- ==========================================================
--
-- Rule 1 of the implementation notes: import into staging, never straight
-- into production. Every column is text so a bad row can never fail the
-- import; the merge in Part 3 is where anything gets interpreted.
--
-- Columns are in the CSV's own order, with the CSV's own names, so the
-- dashboard importer maps them without anybody editing a file.

drop table if exists public.staging_cards;

create table public.staging_cards (
  dataset_id          text,
  language            text,
  name_native         text,
  name_english        text,
  display_name        text,
  translation_status  text,
  category            text,
  pokemon_types       text,
  hp                  text,
  stage               text,
  evolves_from_native text,
  collector_number    text,
  set_total           text,
  set_id              text,
  set_name_native     text,
  set_name_english    text,
  rarity              text,
  illustrator         text,
  pokedex_numbers     text,
  regulation_mark     text,
  available_finishes  text,
  release_date        text,
  source_record       text,
  source_url          text
);

comment on table public.staging_cards is
  'Landing area for the TCGdex card CSVs. Truncated and refilled on every import; nothing reads it but the merge.';

-- ==========================================================
-- PART 2 -- the index itself
-- ==========================================================
--
-- THE KEY IS THE DATASET ID, NOT THE TCGDEX ID.
--
-- English and Japanese are two separate TCGdex databases, not translations
-- of one. The same artwork carries a different number in each, and a set id
-- in one carries no promise about the other. So the language stays in the
-- key and `tcgdex_id` -- the id the app already uses for images, prices and
-- everything else -- is stored beside it rather than as the key.

create table if not exists public.cards (
  dataset_id          text primary key,
  tcgdex_id           text not null,
  language            text not null,

  -- IDENTITY. Rule 3: language + set + collector number. Collector number
  -- is TEXT and keeps its leading zeros, because "082" and "82" are how
  -- two different sets write the same idea and only one of them is right
  -- for any given card.
  set_id              text not null,
  collector_number    text not null,
  set_total           text,

  -- The same number with leading zeros stripped and letters uppercased.
  -- THIS IS THE COLUMN THE SCANNER SEARCHES. A scan reading "082", "82"
  -- or "H01" lands on one row either way, without asking anybody anything.
  number_norm         text not null,

  name_native         text,
  name_english        text,
  translation_status  text,

  category            text,
  rarity              text,
  available_finishes  text,
  illustrator         text,
  release_date        text,
  set_name_native     text,
  set_name_english    text,
  hp                  text,
  stage               text,
  pokemon_types       text,
  regulation_mark     text,

  -- Rule 14: where a row came from and when it was taken.
  source_url          text,
  imported_at         timestamptz not null default now()
);

comment on table public.cards is
  'Local card index, 36,771 rows from TCGdex. Identity only -- never prices. Searched by number_norm so a scan never depends on the network.';

comment on column public.cards.number_norm is
  'collector_number with leading zeros stripped and letters uppercased. The scanner searches THIS. Never show it to anybody -- collector_number is what is printed on the card.';

-- The three questions this table is ever asked.
create index if not exists cards_lookup_number
  on public.cards (language, number_norm);
create index if not exists cards_lookup_set_number
  on public.cards (language, set_id, number_norm);
create index if not exists cards_lookup_tcgdex
  on public.cards (tcgdex_id);

-- Reading the catalogue is not reading anybody's collection. Every visitor
-- may read it; nobody may write it from the browser.
alter table public.cards enable row level security;

drop policy if exists "cards are readable by everyone" on public.cards;
create policy "cards are readable by everyone"
  on public.cards for select using (true);

-- No insert/update/delete policy at all, deliberately: the merge below runs
-- as the table owner in the SQL editor, and nothing else may write.

-- ==========================================================
-- PART 3 -- the merge
-- ==========================================================
--
-- Rule 2: never silently overwrite. This upserts by dataset_id, so running
-- it twice changes nothing and re-running after a partial import simply
-- finishes the job (rules 16 and 17).
--
-- Rule 19: rows carrying EXAMPLE are ignored.

create or replace function public.merge_staging_cards()
returns table (inserted bigint, total bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  before_count bigint;
  after_count  bigint;
begin
  select count(*) into before_count from public.cards;

  insert into public.cards (
    dataset_id, tcgdex_id, language, set_id, collector_number, set_total,
    number_norm, name_native, name_english, translation_status,
    category, rarity, available_finishes, illustrator, release_date,
    set_name_native, set_name_english, hp, stage, pokemon_types,
    regulation_mark, source_url, imported_at
  )
  select
    s.dataset_id,
    -- "en-base1-1" -> "base1-1". Verified against all 36,771 rows:
    -- dataset_id is always language + '-' + set_id + '-' + collector_number.
    regexp_replace(s.dataset_id, '^[a-z]{2}-', ''),
    s.language,
    s.set_id,
    s.collector_number,
    nullif(s.set_total, ''),
    -- THE SAME RULE THE APP USES, CHARACTER FOR CHARACTER.
    -- normalizeCardNumber() in collection.js is ^([A-Z]*)(\d+)([A-Z]?)$ with
    -- the digits run through parseInt, which drops leading zeros wherever
    -- they sit -- so "082"->"82" AND "H01"->"H1". Aquapolis prints H1 and
    -- TCGdex stores H01; both land on H1 here, which is the entire point.
    -- If these two rules ever drift, every scan of a padded number misses.
    case
      when s.collector_number ~ '^[A-Za-z]*[0-9]+[A-Za-z]?$'
        then upper(regexp_replace(s.collector_number,
               '^([A-Za-z]*)0*([0-9]+)([A-Za-z]?)$', '\1\2\3'))
      else upper(s.collector_number)
    end,
    nullif(s.name_native, ''),
    nullif(s.name_english, ''),
    nullif(s.translation_status, ''),
    nullif(s.category, ''),
    nullif(s.rarity, ''),
    nullif(s.available_finishes, ''),
    nullif(s.illustrator, ''),
    nullif(s.release_date, ''),
    nullif(s.set_name_native, ''),
    nullif(s.set_name_english, ''),
    nullif(s.hp, ''),
    nullif(s.stage, ''),
    nullif(s.pokemon_types, ''),
    nullif(s.regulation_mark, ''),
    nullif(s.source_url, ''),
    now()
  from public.staging_cards s
  where coalesce(s.dataset_id, '') <> ''
    and coalesce(s.set_id, '') <> ''
    and coalesce(s.collector_number, '') <> ''
    and s.dataset_id not ilike '%EXAMPLE%'
  on conflict (dataset_id) do update set
    tcgdex_id          = excluded.tcgdex_id,
    language           = excluded.language,
    set_id             = excluded.set_id,
    collector_number   = excluded.collector_number,
    set_total          = excluded.set_total,
    number_norm        = excluded.number_norm,
    name_native        = excluded.name_native,
    name_english       = excluded.name_english,
    translation_status = excluded.translation_status,
    category           = excluded.category,
    rarity             = excluded.rarity,
    available_finishes = excluded.available_finishes,
    illustrator        = excluded.illustrator,
    release_date       = excluded.release_date,
    set_name_native    = excluded.set_name_native,
    set_name_english   = excluded.set_name_english,
    hp                 = excluded.hp,
    stage              = excluded.stage,
    pokemon_types      = excluded.pokemon_types,
    regulation_mark    = excluded.regulation_mark,
    source_url         = excluded.source_url,
    imported_at        = now();

  select count(*) into after_count from public.cards;
  return query select (after_count - before_count), after_count;
end;
$$;

revoke all on function public.merge_staging_cards() from public, anon, authenticated;
