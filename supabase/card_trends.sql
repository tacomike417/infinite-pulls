-- Infinite Pulls — card_trends(): every card's movement in ONE round trip
-- =====================================================================
--
-- WHY THIS EXISTS
--
-- price-trend.js could already answer "did this card move?", but only one
-- card at a time: a select per card, per printing, per marketplace. That
-- was fine when the only arrow on screen was the one on the card you had
-- opened. It stops being fine the moment a list of results, a collection
-- rail, or a page of thirty cards each wants the same answer -- that is
-- thirty round trips before anything is drawn, and it is the same shape
-- of mistake that once made a number search look hung.
--
-- So the client asks once, for every card on screen, and gets back one
-- row per card + printing + marketplace with the two figures the arrow
-- is made of.
--
-- WHAT IT RETURNS
--
--   now_price / now_on     the newest reading we hold
--   then_price / then_on   the newest reading AT LEAST p_days old
--
-- Both from the SAME source, always. A TCGplayer figure is never handed
-- back paired with a Cardmarket one -- different markets, different
-- currencies, and the gap between them is not a price movement. That rule
-- lives in the join below and cannot be opted out of by a caller.
--
-- A card with no reading old enough simply does not come back. That is
-- the honest answer: "no history" is not "it did not move", and the
-- caller draws nothing rather than a flat arrow.
--
-- SECURITY
--
-- security INVOKER, deliberately. card_price_history is already readable
-- by any signed-in user (it is public market data with no owner), so this
-- needs no elevated rights and gets none. RLS still applies underneath.
--
-- SAFE TO RUN TWICE.

create or replace function public.card_trends(
  p_card_ids text[],
  p_days     int default 7
)
returns table (
  card_id    text,
  variant    text,
  source     text,
  then_price numeric,
  then_on    date,
  now_price  numeric,
  now_on     date
)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select h.card_id, h.variant, h.source, h.price, h.recorded_on
    from public.card_price_history h
    where h.card_id = any(p_card_ids)
  ),
  -- The newest figure we hold for each series.
  latest as (
    select distinct on (card_id, variant, source)
           card_id, variant, source, price, recorded_on
    from scoped
    order by card_id, variant, source, recorded_on desc
  ),
  -- The newest figure that is old enough to compare against. NOT the
  -- oldest one we have: comparing today against a price from six months
  -- ago and calling it a seven-day move would be a lie with a true
  -- looking arrow on it.
  older as (
    select distinct on (card_id, variant, source)
           card_id, variant, source, price, recorded_on
    from scoped
    where recorded_on <= (current_date - p_days)
    order by card_id, variant, source, recorded_on desc
  )
  select l.card_id, l.variant, l.source,
         o.price, o.recorded_on,
         l.price, l.recorded_on
  from latest l
  join older o
    on  o.card_id = l.card_id
    and o.variant = l.variant
    and o.source  = l.source     -- same marketplace, never across
  where o.price > 0
    and o.recorded_on < l.recorded_on;
$$;

comment on function public.card_trends(text[], int) is
  'One row per card/printing/marketplace: the newest price and the newest price at least N days old. Feeds every up/down/steady indicator in the app. Same-source only.';

grant execute on function public.card_trends(text[], int) to authenticated;

-- The index card_price_history_lookup (card_id, variant, recorded_on desc)
-- already serves both distinct-on walks. Nothing further to add.
