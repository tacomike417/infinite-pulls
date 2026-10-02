-- ==========================================================
-- SEARCH THAT TAKES WHAT PEOPLE ACTUALLY TYPE
-- ==========================================================
--
-- WHY THIS EXISTS
--
-- The old search demanded one shape: a number, then maybe a total. Jeff
-- typed the footer off a Snorlax -- "SVP EN 051" -- and the parser took
-- the FIRST token as the card number, went looking for a card numbered
-- SVP in a set called EN, and reported that a card he was holding in his
-- hand does not exist.
--
-- The fix is not a better parser for one more shape. It is to stop
-- demanding a shape at all. A person searching knows what they are
-- holding. They will type a number, or a set, or a name, or a nickname,
-- or all four in any order. Every one of those is EVIDENCE. More evidence
-- ranks a card higher; less evidence returns more candidates. Nothing a
-- person types is ever answered with "not found".
--
-- HOW IT READS A QUERY
--
--   1. Fold it       "SVP EN 051"  ->  "svp en 051"
--   2. Pull out any set the words name, longest phrase first, and take
--      those words out of the query. "black star promo" is a set phrase;
--      so is "svp"; so is "scarlet and violet".
--   3. Pull out anything shaped like a collector number.
--   4. Whatever is left is the card's name.
--   5. Score every card on what matched, and rank.
--
-- WHERE IT RUNS
--
-- Entirely here. 36,771 rows is nothing to Postgres, so this is one round
-- trip and zero TCGdex requests -- names, sets, numbers, rarity and now
-- artwork all come back from this one call. Only the live price of a card
-- somebody actually opens still leaves the building.
--
-- SAFE TO RUN TWICE.


-- ==========================================================
-- PART 1 -- folding
-- ==========================================================
--
-- One rule for turning anything typed by a person into something
-- comparable. It has to be the SAME rule on both sides: the alias table
-- is folded on the way in and the query is folded on the way through, so
-- "S&V", "s & v" and "s and v" are one string by the time they meet.
--
-- The ampersand becomes " and " rather than vanishing, because that is
-- what people mean by it and because dropping it would collapse "S&V"
-- into "sv" -- which is a different, real abbreviation.

create or replace function public.search_fold(t text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
           regexp_replace(
             replace(lower(coalesce(t, '')), '&', ' and '),
             '[^a-z0-9]+', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

comment on function public.search_fold(text) is
  'Lowercase, ampersand to "and", every other punctuation run to a single space. Used on aliases at write time and on queries at read time -- change it here and reseed, never in one place only.';


-- THE NUMBER RULE, CHARACTER FOR CHARACTER.
--
-- This is normalizeCardNumber() from collection.js and the merge rule in
-- cards_index.sql, written a third time. It has to stay identical to
-- both: "051" and "51" are one card, "H01" and "H1" are one card, and if
-- these three copies ever drift then a padded number silently stops
-- matching. Any change here is a change in all three places.

create or replace function public.search_norm_number(t text)
returns text
language sql
immutable
as $$
  select case
    when coalesce(t, '') ~ '^[A-Za-z]*[0-9]+[A-Za-z]?$'
      then upper(regexp_replace(t, '^([A-Za-z]*)0*([0-9]+)([A-Za-z]?)$', '\1\2\3'))
    else upper(coalesce(t, ''))
  end
$$;


-- ==========================================================
-- PART 2 -- the vocabulary
-- ==========================================================
--
-- Every word a human might use for a set. Three sources feed it:
--
--   'name'     the set's own name, straight out of the catalogue
--   'code'     the set id, which is usually what is printed on the card
--   'family'   a phrase covering SEVERAL sets at once -- "black star
--              promo" is not one set, it is nine of them, and somebody
--              typing it wants all nine
--   'nickname' shorthand nobody could derive: s&v, ASC, PFL, MEG
--
-- The first three are regenerated from the catalogue by reseed below and
-- must never be hand-edited -- they will be wiped. The fourth is Jeff's,
-- and reseed does not touch it. That split is the whole point: the
-- machine keeps the official words current, and the man behind the
-- counter adds the words people actually say.

create table if not exists public.set_aliases (
  language   text not null,
  set_id     text not null,
  alias_norm text not null,
  alias_raw  text not null,
  kind       text not null default 'nickname',
  weight     int  not null default 100,
  added_by   text not null default 'auto',
  created_at timestamptz not null default now(),
  primary key (language, set_id, alias_norm)
);

comment on table public.set_aliases is
  'Every word a person might use for a set. kind name/code/family are regenerated by reseed_set_aliases(); kind nickname is entered by hand and is never wiped.';

create index if not exists set_aliases_lookup
  on public.set_aliases (language, alias_norm);

-- The catalogue is public and so is the vocabulary for searching it.
alter table public.set_aliases enable row level security;

drop policy if exists "set aliases are readable by everyone" on public.set_aliases;
create policy "set aliases are readable by everyone"
  on public.set_aliases for select using (true);

-- Writing is shop staff only, through the admin panel. Same door the
-- Customers tab uses; no second concept of who is allowed.
drop policy if exists "shop staff may write set aliases" on public.set_aliases;
create policy "shop staff may write set aliases"
  on public.set_aliases for all
  using (public.is_shop_staff())
  with check (public.is_shop_staff());


-- ==========================================================
-- PART 3 -- seeding the vocabulary from the catalogue
-- ==========================================================
--
-- Derived, never typed. Whatever sets are in public.cards is what comes
-- out, so a re-import of the catalogue plus a reseed keeps the words
-- current with no list for anybody to maintain.
--
-- Deliberately data-driven rather than hard-coded: this file does not
-- know that Scarlet & Violet promos live under `svp`, it knows that a set
-- whose NAME says Promo is a promo set. New promo series work on the day
-- they are imported, with nothing to edit here.

drop function if exists public.reseed_set_aliases();
create or replace function public.reseed_set_aliases()
returns table (digital_sets bigint, auto_rows bigint, nickname_rows bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  n_auto bigint;
  n_nick bigint;
  n_dig  bigint;
begin
  -- Digital sets are settled first, because the vocabulary below skips
  -- them: teaching the search words for a set it will never return is
  -- how a search box starts lying about what it has.
  n_dig := public.reseed_set_kinds();

  -- Only the derived rows. Jeff's nicknames survive every reseed.
  delete from public.set_aliases where added_by = 'auto';

  /* ---- the set's own names ---- */
  insert into public.set_aliases (language, set_id, alias_norm, alias_raw, kind, weight, added_by)
  select distinct on (c.language, c.set_id, public.search_fold(n.name))
         c.language, c.set_id, public.search_fold(n.name), n.name, 'name', 300, 'auto'
  from public.cards c
  cross join lateral (values (c.set_name_english), (c.set_name_native)) as n(name)
  where coalesce(n.name, '') <> ''
    and public.search_fold(n.name) <> ''
    and not exists (select 1 from public.set_kinds k
                     where k.language = c.language and k.set_id = c.set_id and k.kind = 'digital')
  on conflict do nothing;

  /* ---- the set id, which is usually what is printed ---- */
  insert into public.set_aliases (language, set_id, alias_norm, alias_raw, kind, weight, added_by)
  select distinct c.language, c.set_id, public.search_fold(c.set_id), c.set_id, 'code', 400, 'auto'
  from public.cards c
  where public.search_fold(c.set_id) <> ''
    and not exists (select 1 from public.set_kinds k
                     where k.language = c.language and k.set_id = c.set_id and k.kind = 'digital')
  on conflict do nothing;

  /* ---- families: one phrase, many sets ----
     "black star promo" is nine English sets and counting. Somebody typing
     it has told us something real -- narrow to promos -- without naming
     one set, and the ranking below treats it as exactly that much
     evidence: less than an exact set, more than nothing. */
  insert into public.set_aliases (language, set_id, alias_norm, alias_raw, kind, weight, added_by)
  select distinct c.language, c.set_id, f.alias, f.alias, 'family', 150, 'auto'
  from public.cards c
  cross join (values
    ('black star promo'), ('black star promos'), ('black star'), ('promo'), ('promos')
  ) as f(alias)
  where (coalesce(c.set_name_english, '') ilike '%promo%'
     or coalesce(c.set_name_native, '')  ilike '%promo%'
     or coalesce(c.set_id, '')           ilike '%p')
    and not exists (select 1 from public.set_kinds k
                     where k.language = c.language and k.set_id = c.set_id and k.kind = 'digital')
  on conflict do nothing;

  /* ---- shorthand nobody could derive from a name ----
     Matched against the set NAME, so it lands on whatever set ids the
     catalogue actually uses and this file never has to know them. These
     are seeded as 'auto' on purpose: they are my starters, and Jeff
     overrides or extends them from the admin panel with rows that a
     reseed cannot touch. */
  insert into public.set_aliases (language, set_id, alias_norm, alias_raw, kind, weight, added_by)
  select distinct c.language, c.set_id, s.alias, s.alias, 'nickname', 250, 'auto'
  from public.cards c
  cross join (values
    ('%scarlet%violet%',      's and v'),
    ('%scarlet%violet%',      'sv'),
    ('%sword%shield%',        'swsh'),
    ('%sword%shield%',        's and s'),
    ('%sun%moon%',            'sm'),
    ('%black%white%',         'bw'),
    ('%diamond%pearl%',       'dp'),
    ('%heartgold%',           'hgss'),
    ('%heartgold%',           'hs'),
    ('%ascended%hero%',       'asc'),
    ('%phantasmal%flame%',    'pfl'),
    ('%mega%evolution%',      'meg'),
    ('%trainer%gallery%',     'tg'),
    ('%galarian%gallery%',    'gg'),
    ('%radiant%collection%',  'rc')
  ) as s(pattern, alias)
  where (coalesce(c.set_name_english, '') ilike s.pattern
     or coalesce(c.set_name_native, '')  ilike s.pattern)
    and not exists (select 1 from public.set_kinds k
                     where k.language = c.language and k.set_id = c.set_id and k.kind = 'digital')
  on conflict do nothing;

  select count(*) into n_auto from public.set_aliases where added_by = 'auto';
  select count(*) into n_nick from public.set_aliases where added_by <> 'auto';
  return query select n_dig, n_auto, n_nick;
end;
$$;

revoke all on function public.reseed_set_aliases() from public, anon, authenticated;

comment on function public.reseed_set_aliases() is
  'Rebuilds the derived half of set_aliases from public.cards. Run after any catalogue import. Never deletes hand-entered nicknames.';



-- ==========================================================
-- PART 3b -- what is a real card
-- ==========================================================
--
-- Pokemon TCG Pocket is a phone game. Its cards are in this catalogue --
-- Genetic Apex, Mythical Island, Space-Time Smackdown -- because TCGdex
-- carries them, and until now they sat in the results of every number
-- search alongside cardboard. A search for 051 returned Jeff's Snorlax
-- and then four cards that cannot be bought, sold, graded, sleeved or
-- brought to a show.
--
-- They are also, almost certainly, a large share of the cards this app
-- has never found a price for. There is nothing to price.
--
-- A TABLE RATHER THAN A REGEX IN THE CODE. The pattern below is only how
-- the table gets SEEDED. What the search actually reads is the rows, so a
-- set that lands on the wrong side is one UPDATE to fix rather than a
-- deploy -- and a physical set that ever gets an id starting with A1 does
-- not silently vanish from the app with nobody able to put it back.
--
-- Only exceptions are stored. Absent from this table means physical,
-- which is what almost every row in the catalogue is.

create table if not exists public.set_kinds (
  language text not null,
  set_id   text not null,
  kind     text not null default 'digital',
  note     text,
  primary key (language, set_id)
);

comment on table public.set_kinds is
  'Exceptions only. A set listed here as digital is excluded from card search and pricing -- Pokemon TCG Pocket. Anything not listed is treated as a physical card.';

alter table public.set_kinds enable row level security;

drop policy if exists "set kinds are readable by everyone" on public.set_kinds;
create policy "set kinds are readable by everyone"
  on public.set_kinds for select using (true);

drop policy if exists "shop staff may write set kinds" on public.set_kinds;
create policy "shop staff may write set kinds"
  on public.set_kinds for all
  using (public.is_shop_staff()) with check (public.is_shop_staff());

create or replace function public.reseed_set_kinds()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare n bigint;
begin
  /* HOW POCKET IS TOLD APART, AND WHY IT IS NOT A LIST OF LETTERS.
     The first attempt matched A-numbers (A1, A1a, A2...) and missed the
     whole second generation the moment Pocket moved to B1, B1a, B2. A
     list of prefixes was always going to rot on the next letter.
     The real difference is in the catalogue itself: TCGdex slugs every
     physical English set in LOWERCASE -- svp, me5, swsh1, base1, cel25c
     -- and carries Pocket's official codes verbatim, in uppercase. So an
     English set id that starts with a capital letter followed by a digit
     is Pocket, this year and next year, whatever letter they reach.
     Japanese is deliberately excluded from that rule: its physical sets
     ARE uppercase (S10P, CP1, PCG9) and the same test would quarantine
     real cards. Japanese Pocket sets are caught by the explicit shapes
     below instead, and anything the seed misses is one row to add by
     hand -- which is the entire reason this is a table. */
  insert into public.set_kinds (language, set_id, kind, note)
  select distinct c.language, c.set_id, 'digital', 'Pokemon TCG Pocket -- no physical card exists'
  from public.cards c
  where (c.language = 'en' and c.set_id ~ '^[A-Z][0-9]')
     or (c.language <> 'en' and c.set_id ~ '^[A-Z][0-9]?[a-z]?$' and c.set_id ~ '^[AB][0-9]')
     or upper(c.set_id) in ('P-A', 'PA')
  on conflict (language, set_id) do nothing;

  select count(*) into n from public.set_kinds where kind = 'digital';
  return n;
end;
$$;

revoke all on function public.reseed_set_kinds() from public, anon, authenticated;


-- ==========================================================
-- PART 4 -- the search
-- ==========================================================
--
-- WHAT COMES BACK
--
-- Everything a result row needs to draw itself: name, set, number as
-- printed, rarity, regulation mark and the artwork base. No follow-up
-- request per card. That is the difference between a list that appears
-- and a list that arrives one card at a time.
--
-- WHY SCORING RATHER THAN FILTERING
--
-- A filter has to decide what the query MEANT and then throws away
-- everything that disagrees -- which is how "SVP EN 051" ended up
-- meaning "a card numbered SVP" and returning nothing. Scoring never
-- decides. Every signal it recognises ADDS, nothing subtracts, and a word
-- it cannot place is simply worth nothing rather than fatal. So a query
-- with three good signals and one piece of noise still lands on the right
-- card, and a query with one signal returns an honest list of candidates
-- instead of a guess.
--
-- THE ONE RULE ABOUT NUMBERS
--
-- A number typed with a prefix counts twice: "SVP051" is asked for as
-- SVP51 (the whole token, in case a set really numbers its cards that
-- way, like TG05) AND as 51 with the prefix read as a set. The whole
-- token scores higher, so TG05 still beats plain 5 -- which is test case
-- T007, and the reason prefixes must never simply be stripped.

drop function if exists public.search_cards(text, text, int);
create or replace function public.search_cards(
  p_query      text,
  p_language   text default 'en',
  p_limit      int  default 60,
  p_include_digital boolean default false
)
returns table (
  tcgdex_id        text,
  dataset_id       text,
  language         text,
  set_id           text,
  set_name         text,
  collector_number text,
  set_total        text,
  card_name        text,
  name_native      text,
  rarity           text,
  illustrator      text,
  regulation_mark  text,
  image_base       text,
  release_date     text,
  score            int,
  matched_on       text
)
language plpgsql
stable
as $$
/* The OUT columns above (language, set_id, rarity, score...) are plpgsql
   variables as well as result columns, and they shadow the identically
   named columns on public.cards. This says the column always wins -- every
   variable of my own below is named something no table here uses, so
   nothing else changes meaning. Without it, `array_agg(set_id)` is
   ambiguous and the function will not run. */
#variable_conflict use_column
declare
  lang        text;
  q           text;
  work        text;
  a           record;
  tok         text;
  pre         text;
  rest        text;
  sets_exact  text[] := '{}';
  sets_family text[] := '{}';
  nums_strong text[] := '{}';
  nums_weak   text[] := '{}';
  nums_pre    text[] := '{}';
  nums_word   text[] := '{}';
  words       text[] := '{}';
  codes       text[] := '{}';
  raw_q       text;
  denom       text;
  n           text;
  cd          text;
  skip_sets   text[] := '{}';
  lim         int := least(greatest(coalesce(p_limit, 60), 1), 240);
begin
  lang  := lower(coalesce(nullif(trim(p_language), ''), 'en'));
  raw_q := coalesce(p_query, '');

  /* The phone-game sets, unless somebody deliberately asks for them.
     Read once into an array rather than joined per row -- it is a couple
     of dozen ids against thirty-six thousand cards. */
  if not coalesce(p_include_digital, false) then
    select coalesce(array_agg(k.set_id), '{}') into skip_sets
    from public.set_kinds k
    where k.kind = 'digital';
  end if;

  /* A GRADE IS NOT A CARD NUMBER.
     "PSA 10 SVP 051" carries two numbers and only one of them is on the
     card. Left alone, the 10 competed with the 51 and won the top row
     with a completely different card. A grading company followed by a
     grade is the one shape where a number is definitely NOT the
     collector number, so it comes out before anything else reads it.
     What the person does with the grade afterwards -- filtering their
     own copies -- happens above this function, not in it. */
  raw_q := regexp_replace(raw_q, '\m(psa|bgs|cgc|sgc|tag|ace)\M\s*\.?\s*[0-9]{1,2}(\.[05])?', ' ', 'gi');

  /* THE DENOMINATOR IS READ BEFORE FOLDING.
     Folding turns every punctuation run into a space, so "4/102" would
     arrive here as two unrelated numbers and the slash -- the thing that
     says one of them is a set size -- would be gone. Read it off the raw
     text first, and remove it, because a set size competing as a card
     number is how "150/202" returned the card numbered 202. */
  /* The right-hand side has to be a SET SIZE, which means digits --
     optionally behind the same kind of prefix the numerator carries, as
     in TG05/TG30. It must NOT swallow a Japanese promo family: "001/SV-P"
     has a slash and letters after it, and reading SV as a set size there
     destroyed the promo code and sent the search to the wrong catalogue
     corner. The trailing guard is what refuses that. */
  select m[1] into denom
  from regexp_matches(raw_q, '/\s*(?:[A-Za-z]{1,4})?([0-9]{1,4})(?![0-9A-Za-z-])') as m
  limit 1;
  if denom is not null then
    raw_q := regexp_replace(raw_q, '/\s*(?:[A-Za-z]{1,4})?[0-9]{1,4}(?![0-9A-Za-z-])', ' ', 'g');
  end if;

  /* ? AND ! ARE REAL COLLECTOR NUMBERS.
     Unown ? and Unown ! are printed exactly like that, and folding wipes
     punctuation, so they have to be lifted out of the raw text before the
     fold happens or the query becomes empty and the card cannot be
     reached at all. */
  for n in select (regexp_matches(raw_q, '(?:^|\s)([?!])(?:\s|$)', 'g'))[1]
  loop
    nums_strong := nums_strong || n;
  end loop;

  q := public.search_fold(raw_q);
  if q = '' and coalesce(array_length(nums_strong, 1), 0) = 0 then return; end if;

  /* A LANGUAGE PRINTED IN THE FOOTER IS AN ANSWER, NOT NOISE.
     Jeff's card says "SVP EN 051". The EN is the app telling itself which
     catalogue to search, if it bothers to read it. */
  if (' ' || q || ' ') ~ ' (en|eng|english) ' then
    lang := 'en';
    q := trim(regexp_replace(' ' || q || ' ', ' (en|eng|english) ', ' ', 'g'));
  elsif (' ' || q || ' ') ~ ' (ja|jp|jpn|japanese) ' then
    lang := 'ja';
    q := trim(regexp_replace(' ' || q || ' ', ' (ja|jp|jpn|japanese) ', ' ', 'g'));
  end if;

  /* ---- 1. pull out any set the words name ----
     Longest phrase first, and each phrase is REMOVED once it matches, so
     "black star promo" is consumed whole and the bare "promo" inside it
     cannot match again and count twice. What survives this loop is the
     part of the query that is not about a set. */
  work := ' ' || q || ' ';

  for a in
    select alias_norm,
           bool_or(kind <> 'family')                          as is_exact,
           array_agg(distinct set_id)                         as sets
    from public.set_aliases
    where language = lang
    group by alias_norm
    order by length(alias_norm) desc
  loop
    if position(' ' || a.alias_norm || ' ' in work) > 0 then
      work := replace(work, ' ' || a.alias_norm || ' ', ' ');
      if a.is_exact then
        sets_exact := sets_exact || a.sets;
        -- A short alphabetic code ("tg", "svp", "gg") is very likely the
        -- prefix printed in front of the number on those cards. Kept, so
        -- that a number typed separately can be tried WITH it below.
        if a.alias_norm ~ '^[a-z]{1,5}$' then codes := codes || a.alias_norm; end if;
      else
        sets_family := sets_family || a.sets;
      end if;
    end if;
  end loop;

  /* ---- 2. what is left is numbers and a name ---- */
  foreach tok in array regexp_split_to_array(trim(work), '\s+')
  loop
    if coalesce(tok, '') = '' then continue; end if;

    if tok ~ '^[a-z]*[0-9]+[a-z]?$' then
      nums_strong := nums_strong || public.search_norm_number(tok);

      -- A prefix on a number is a set talking. Read it both ways.
      pre  := (regexp_match(tok, '^([a-z]+)[0-9]'))[1];
      rest := (regexp_match(tok, '^[a-z]*([0-9]+[a-z]?)$'))[1];
      if pre is not null then
        nums_weak := nums_weak || public.search_norm_number(rest);
        sets_exact := sets_exact || coalesce(
          (select array_agg(distinct s.set_id)
             from public.set_aliases s
            where s.language = lang and s.alias_norm = pre), '{}');
      end if;
    else
      words := words || tok;
      /* AND ALSO TRIED AS A COLLECTOR NUMBER.
         "A", "ONE", "?" -- Unown letters, Alph Lithographs, V-UNION
         pieces. Rather than a special case per shape, every word is
         simply offered to the number column as well. A word that is not
         a collector number matches nothing and costs nothing; the ones
         that are, work without anybody having listed them. */
      nums_word := nums_word || upper(tok);
    end if;
  end loop;

  /* A PREFIX SPLIT ACROSS A SPACE IS STILL A PREFIX.
     "TG05" works and "TG 05" did not, because the space turned TG into a
     set and left a bare 5 that no Trainer Gallery card is numbered. Any
     short set code seen in the query is recombined with any bare number
     in it, so both spellings reach the same card. */
  foreach cd in array codes loop
    foreach n in array nums_strong loop
      if n ~ '^[0-9]+[A-Z]?$' then
        nums_pre := nums_pre || public.search_norm_number(cd || n);
      end if;
    end loop;
  end loop;

  sets_exact  := coalesce(sets_exact,  '{}');
  sets_family := coalesce(sets_family, '{}');

  /* ---- 3. score ----
     The candidate set is narrowed first by whichever strong signals the
     query actually carried, because scoring a name against all 36,771
     rows costs more than finding the couple of hundred it could possibly
     be. The narrowing is an OR, never an AND: one good signal is enough
     to be considered, and the score decides the order. */
  return query
  with cand as (
    select c.*
    from public.cards c
    where c.language = lang
      and c.set_id <> all (skip_sets)
      and (
           (coalesce(array_length(nums_strong, 1), 0) > 0 and c.number_norm = any(nums_strong))
        or (coalesce(array_length(nums_pre,    1), 0) > 0 and c.number_norm = any(nums_pre))
        or (coalesce(array_length(nums_word,   1), 0) > 0 and c.number_norm = any(nums_word))
        or (coalesce(array_length(nums_weak,   1), 0) > 0 and c.number_norm = any(nums_weak))
        or (coalesce(array_length(sets_exact,  1), 0) > 0 and c.set_id      = any(sets_exact))
        or (coalesce(array_length(sets_family, 1), 0) > 0 and c.set_id      = any(sets_family))
        or (coalesce(array_length(words,       1), 0) > 0 and exists (
              select 1 from unnest(words) w
              where c.name_english ilike '%' || w || '%'
                 or c.name_native  ilike '%' || w || '%'))
      )
  ),
  scored as (
    select c.*,
      (
        case when c.number_norm = any(nums_strong) then 1200 else 0 end
      + case when c.number_norm = any(nums_pre)    then  900 else 0 end
      + case when c.number_norm = any(nums_word)   then  800 else 0 end
      + case when c.number_norm = any(nums_weak)   then  500 else 0 end
      + case when c.set_id      = any(sets_exact)  then  600 else 0 end
      + case when c.set_id      = any(sets_family) then  180 else 0 end
      + case when denom is not null
                  and c.set_total ~ '^[0-9]+$' and denom ~ '^[0-9]+$'
                  and c.set_total::int = denom::int then 250 else 0 end
      + coalesce((
          select sum(case
            when public.search_fold(coalesce(c.name_english, '')) = w             then 300
            when public.search_fold(coalesce(c.name_english, '')) like w || ' %'   then 240
            when public.search_fold(coalesce(c.name_english, '')) like '%' || w || '%' then 170
            when public.search_fold(coalesce(c.name_native,  '')) like '%' || w || '%' then 150
            else 0 end)
          from unnest(words) w), 0)
      + case when exists (
              select 1 from unnest(words) w
              where public.search_fold(coalesce(c.rarity, '')) like '%' || w || '%')
             then 60 else 0 end
      )::int as sc,
      trim(
        case when c.number_norm = any(nums_strong)
               or c.number_norm = any(nums_pre)
               or c.number_norm = any(nums_word)
               or c.number_norm = any(nums_weak) then 'number ' else '' end ||
        case when c.set_id = any(sets_exact)  then 'set '    else '' end ||
        case when c.set_id = any(sets_family) then 'promo '  else '' end ||
        case when exists (
               select 1 from unnest(words) w
               where c.name_english ilike '%' || w || '%'
                  or c.name_native  ilike '%' || w || '%') then 'name ' else '' end
      ) as why
    from cand c
  )
  select s.tcgdex_id, s.dataset_id, s.language, s.set_id,
         coalesce(s.set_name_english, s.set_name_native),
         s.collector_number, s.set_total,
         coalesce(s.name_english, s.name_native), s.name_native,
         s.rarity, s.illustrator, s.regulation_mark, s.image_base, s.release_date,
         s.sc, s.why
  from scored s
  where s.sc > 0
  order by s.sc desc, s.release_date desc nulls last, s.set_id, s.number_norm
  limit lim;

  /* ---- 4. never "not found" ----
     Everything above needed a signal it recognised. This needs nothing:
     it is the whole query, folded, looked for inside a name. It is the
     answer to a misspelling, a half-remembered card, or a set nobody has
     taught the vocabulary yet -- and it is why this function has no
     empty-handed branch. */
  if not found then
    return query
    select c.tcgdex_id, c.dataset_id, c.language, c.set_id,
           coalesce(c.set_name_english, c.set_name_native),
           c.collector_number, c.set_total,
           coalesce(c.name_english, c.name_native), c.name_native,
           c.rarity, c.illustrator, c.regulation_mark, c.image_base, c.release_date,
           1, 'loose'
    from public.cards c
    where c.language = lang
      and c.set_id <> all (skip_sets)
      and (c.name_english ilike '%' || q || '%' or c.name_native ilike '%' || q || '%')
    order by c.release_date desc nulls last, c.set_id, c.number_norm
    limit lim;
  end if;
end;
$$;

comment on function public.search_cards(text, text, int, boolean) is
  'One box, anything typed. Reads set words, numbers and names out of a query, scores every card on what matched and ranks. Never returns empty-handed. Zero external requests.';

-- The catalogue is public, so searching it is public. The movers board
-- set this precedent: strangers meet this app before they sign up.
grant execute on function public.search_cards(text, text, int, boolean) to anon, authenticated;
