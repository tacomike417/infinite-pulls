-- Infinite Pulls — tier_cards(): browse a price bracket
-- ====================================================
--
-- WHAT IT IS FOR
--
-- "Show me the Grails." A price bracket, twenty cards, and what each of
-- them did this week. It is a companion to top_movers(), not a copy of
-- it, and the difference is worth stating because it is the entire design:
--
--   top_movers()  ranks by MOVEMENT. A card that did nothing is not on it.
--   tier_cards()  fills a BRACKET. Movement decides the order, not
--                 membership, so a quiet week still returns twenty cards.
--
-- THE PADDING RULE, WHICH FALLS OUT FOR FREE
--
-- The ask was "twenty cards, and if fewer than twenty moved, pad it with
-- ones that stayed steady". Ordering by the SIZE of the move does exactly
-- that with no special case anywhere: the biggest movers sort to the top,
-- the flat cards sink to the bottom, and cutting at twenty takes movers
-- first and steady only to fill. On a wild week the list is all movement;
-- on a dead one it is mostly steady; and nothing had to decide which kind
-- of week it was.
--
-- WHAT CANNOT PAD IT
--
-- A card with no week-old reading. We cannot call it steady, because we do
-- not know that it is -- that is the same line price-trend.js draws when
-- it refuses to put a grey arrow on a card it has never priced. If a
-- bracket cannot fill twenty from cards we genuinely have history for, it
-- returns fewer. A short list is a true one.
--
-- MEMBERSHIP IS THE CURRENT PRICE
--
-- Deliberately different from top_movers(), which floors on the STARTING
-- price so that a $500 card crashing to $3 stays on the fallers board
-- where the story is. Here the question is not "what moved" but "what is
-- a Grail", and a card worth $180 today is not a Grail today whatever it
-- was on Monday. Browsing asks what a thing IS; a movers board asks what
-- happened to it. Different questions, different anchors, on purpose.
--
-- THE TIERS (agreed 7 Sep 2026, populations measured the same day)
--
--   Notable      $50-99      934 cards
--   High-value   $100-249    688
--   Premium      $250-499    241
--   Grails       $500+       128
--
-- p_max is exclusive, so those ranges tile with no gap and no overlap.
-- Pass null for the open-ended top tier.
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
drop function if exists public.tier_cards(numeric, numeric, int, int);

create or replace function public.tier_cards(
  p_min   numeric,
  p_max   numeric default null,
  p_limit int     default 20,
  p_days  int     default 7
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
  older as (
    select distinct on (card_id, variant)
           card_id, variant, price, recorded_on
    from scoped
    where recorded_on <= (current_date - greatest(p_days, 1))
    order by card_id, variant, recorded_on desc
  ),
  in_band as (
    select l.card_id, l.variant,
           o.price as then_price, o.recorded_on as then_on,
           l.price as now_price,  l.recorded_on as now_on,
           ((l.price - o.price) / o.price) * 100 as pct
    from latest l
    join older o
      on o.card_id = l.card_id
     and o.variant = l.variant
    where o.price > 0
      and o.recorded_on < l.recorded_on
      and l.price >= p_min                       -- membership: TODAY's price
      and (p_max is null or l.price < p_max)
  ),
  -- One card, not one printing. Otherwise a card whose Normal and Reverse
  -- Holofoil both sit in the bracket takes two of the twenty slots to say
  -- one thing, and the tier looks half as deep as it is.
  best_per_card as (
    select distinct on (card_id) *
    from in_band
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
  left join lateral (
    select cc.name_english, cc.name_native, cc.set_name_english,
           cc.collector_number, cc.set_total, cc.image_base
    from public.cards cc
    where cc.tcgdex_id = b.card_id
    order by (cc.language = 'en') desc
    limit 1
  ) c on true
  -- Movement first, steady to fill. The whole padding rule, in one line.
  order by abs(b.pct) desc, b.now_price desc
  limit least(greatest(p_limit, 1), 100);
$$;

comment on function public.tier_cards(numeric, numeric, int, int) is
  'Twenty cards from a price bracket, biggest movers first and steady cards padding the rest. Membership is the CURRENT price (unlike top_movers, which floors on the starting price). Market data only -- no user is named.';

grant execute on function public.tier_cards(numeric, numeric, int, int) to anon, authenticated;
