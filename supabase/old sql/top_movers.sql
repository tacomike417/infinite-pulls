-- Infinite Pulls — top_movers(): the public Movers & Shakers board
-- ================================================================
--
-- WHAT IT IS FOR
--
-- A page anybody can read without an account: the cards that rose and
-- fell most this week. It is the front door -- somebody searches "pokemon
-- card prices going up", lands here, sees real numbers, and taps a card.
--
-- WHY IT IS A FUNCTION AND NOT A QUERY
--
-- card_price_history is readable by SIGNED-IN users only, and that is
-- correct: it is the app's own working data. This board has to be readable
-- by a stranger. So rather than opening the table to the world, one narrow
-- door is opened instead -- security definer, fixed shape, no arguments
-- that could widen it, and nothing in the returned rows but public market
-- data and the catalogue identity of a card. No user is named, no
-- collection is touched, no table other than these two is read.
--
-- ==========================================================
-- THE PENNY CARD PROBLEM, which is the whole design
-- ==========================================================
--
-- Rank by raw percentage with no floor and this board is worthless. A
-- common going $0.03 -> $0.09 is +200% and beats every real event on the
-- market. One rounding tick on a bulk card would outrank a Charizard
-- gaining sixty dollars, and the page would look like a random number
-- generator to exactly the people whose trust it needs.
--
-- THE FLOOR IS ON THE STARTING PRICE. p_min_price is checked against
-- then_price, not now_price, and not both. That one choice is what makes
-- both halves of the board work:
--
--   RISERS   a $6 card that doubled qualifies. A 3-cent common cannot,
--            because it was never a $5 card to begin with.
--   FALLERS  a $50 card that collapsed to $3 qualifies -- which is the
--            single most newsworthy row the board can carry. Requiring
--            the CURRENT price to clear the floor would have thrown that
--            story away, and requiring both ends would throw it away too.
--
-- Checking now_price instead would let $0.10 -> $5.00 onto the board at
-- +4,900%, which is a data artefact wearing a headline.
--
-- p_max_pct is a garbage filter, not an opinion about markets. A card up
-- 4,000% in a week is a bad reading from TCGdex, and one absurd row at the
-- top of a public board discredits the twenty-four honest ones under it.
-- Raise it if a genuine move ever gets caught by it.
--
-- ==========================================================
-- ONE MARKETPLACE, ONE CURRENCY
-- ==========================================================
--
-- TCGplayer only, so every row on the board is dollars and every
-- percentage is comparable to every other. Cardmarket is euros and would
-- have to be either converted (which folds the exchange rate into the
-- ranking -- a card could "move" because the euro did) or shown alongside
-- dollars in one column of numbers, which is how a reader misreads a page
-- they are about to screenshot.
--
-- The cost is real and worth stating: TCGplayer is null on all 13,223
-- Japanese cards, so no Japanese card can ever appear here. That is a
-- second board for another day, in euros, ranked separately.
--
-- SAFE TO RUN TWICE.

-- ADDING A COLUMN TO THE RETURN TYPE MEANS DROPPING FIRST.
-- `create or replace function` cannot change the shape of what a function
-- gives back -- Postgres answers "cannot change return type of existing
-- function" and stops, which in a multi-file paste takes every migration
-- after it down too. The drop below makes this file re-runnable no matter
-- which version is already installed. `if exists` so a first install is
-- just as quiet, and the signature is spelled out because that is what
-- identifies a function in Postgres, not its name.
drop function if exists public.top_movers(text, int, int, numeric, numeric);

create or replace function public.top_movers(
  p_direction  text    default 'up',
  p_limit      int     default 25,
  p_days       int     default 7,
  p_min_price  numeric default 5,
  p_max_pct    numeric default 400
)
returns table (
  card_id    text,
  name       text,
  set_name   text,
  number     text,
  variant    text,
  image_base text,
  then_price numeric,
  now_price  numeric,
  pct        numeric,
  then_on    date,
  now_on     date
)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select h.card_id, h.variant, h.price, h.recorded_on
    from public.card_price_history h
    where h.source = 'tcgplayer'          -- one market, one currency
  ),
  latest as (
    select distinct on (card_id, variant)
           card_id, variant, price, recorded_on
    from scoped
    order by card_id, variant, recorded_on desc
  ),
  -- The newest reading old enough to be a week ago. Not the oldest we
  -- hold: comparing today against a price from a month back and calling
  -- it a seven-day move would be a lie with a true number on it.
  older as (
    select distinct on (card_id, variant)
           card_id, variant, price, recorded_on
    from scoped
    where recorded_on <= (current_date - greatest(p_days, 1))
    order by card_id, variant, recorded_on desc
  ),
  moved as (
    select l.card_id, l.variant,
           o.price as then_price, o.recorded_on as then_on,
           l.price as now_price,  l.recorded_on as now_on,
           ((l.price - o.price) / o.price) * 100 as pct
    from latest l
    join older o
      on o.card_id = l.card_id
     and o.variant = l.variant
    where o.price >= greatest(p_min_price, 0.01)   -- the floor, on the START
      and o.recorded_on < l.recorded_on
  ),
  -- A card with several printings is ONE card on this board. Reverse
  -- Holofoil and Normal moving together would otherwise take two of the
  -- twenty-five slots and say the same thing twice, and a reader would
  -- fairly read that as the list padding itself.
  best_per_card as (
    select distinct on (card_id) *
    from moved
    where abs(pct) >= 3                      -- the same floor the arrows use
      and abs(pct) <= greatest(p_max_pct, 3)
      and case when lower(p_direction) = 'down' then pct < 0 else pct > 0 end
    order by card_id, abs(pct) desc
  )
  select b.card_id,
         coalesce(c.name_english, c.name_native, b.card_id) as name,
         c.set_name_english as set_name,
         c.collector_number
           || case when c.set_total is not null and c.set_total <> ''
                   then '/' || c.set_total else '' end as number,
         b.variant,
         c.image_base,
         round(b.then_price, 2),
         round(b.now_price, 2),
         round(b.pct, 1),
         b.then_on,
         b.now_on
  from best_per_card b
  -- lateral, because tcgdex_id is not unique across languages and a plain
  -- join would show the same card twice under two names.
  left join lateral (
    select cc.name_english, cc.name_native, cc.set_name_english,
           cc.collector_number, cc.set_total, cc.image_base
    from public.cards cc
    where cc.tcgdex_id = b.card_id
    order by (cc.language = 'en') desc
    limit 1
  ) c on true
  order by case when lower(p_direction) = 'down' then b.pct else -b.pct end
  limit least(greatest(p_limit, 1), 100);
$$;

comment on function public.top_movers(text, int, int, numeric, numeric) is
  'Public Movers & Shakers board: the biggest TCGplayer risers or fallers over p_days. Floored on the STARTING price so bulk commons cannot rank and a genuine crash still can. One row per card. Market data only -- no user is named and no collection is read.';

-- The point of the whole exercise: a stranger with no account can read it.
grant execute on function public.top_movers(text, int, int, numeric, numeric) to anon, authenticated;

-- card_price_history stays shut to anon. This function is the only way in,
-- and it hands back nothing but prices and card names.
