-- ============================================================
-- THE TCGDEX CACHE — so an outage upstream is not an outage here.
--
-- SAFE AGAINST LIVE DATA. One new table, one view, two functions. Touches
-- nothing that already exists. Re-running it changes nothing.
--
-- ------------------------------------------------------------
-- WHY THIS EXISTS
--
-- On 29 August 2026 api.tcgdex.net and assets.tcgdex.net both stopped
-- answering — not an error, no response at all, connections timing out at
-- the TCP level. Card search and prices were dead for as long as it
-- lasted, and there was nothing to do but wait.
--
-- TCGdex is free, community-run, and has no paid tier and no SLA. You
-- cannot buy uptime from them. TCGplayer's API is closed to new
-- applicants entirely. The commercial middlemen cover prices but not card
-- images and publish no SLA either.
--
-- So there is no API purchase that fixes this. What fixes it is having
-- our own copy. The Supabase project answered in half a second while
-- TCGdex was dead — it is the most reliable thing in this stack, and the
-- card data belongs in it.
--
-- ------------------------------------------------------------
-- WHY ONE TABLE KEYED BY PATH
--
-- The app already funnels every TCGdex call through one function,
-- fetchTcgdex(url), in components/collection.js. Keying the cache by the
-- API path means that function is the only thing that changes: it looks
-- here first and falls back to the network. Nothing else in the app has
-- to know a cache exists.
--
-- A normalised schema of cards, variants and prices would be prettier and
-- would need every call site rewritten to match. This is one table and a
-- twenty-line change.
--
-- ------------------------------------------------------------
-- ON STALENESS, AND ONE THING WORTH BEING PRECISE ABOUT
--
-- Most of what a card response contains never changes — name, set,
-- number, rarity, illustrator, Dex number, energy type, regulation mark,
-- image URL. Once a card is printed those are fixed forever.
--
-- But TCGdex returns prices INSIDE the same card object, so the cache
-- cannot separate the permanent half from the changing half without
-- taking the response apart. It does not take it apart. It stores the
-- whole response with a timestamp and a time-to-live.
--
-- What that means in practice is exactly the behaviour we want anyway:
-- when upstream is down we serve the stored copy, every permanent field
-- is still correct, and only the prices are as-of a date the app can
-- show. Nothing is wrong on screen; some of it is simply from Tuesday.
--
-- THE RULE THAT MATTERS MOST: stale is only stale while upstream is
-- healthy. The moment a refresh fails, the stored copy stops being stale
-- and starts being the answer. Freshness is a preference. Availability is
-- the requirement.
--
-- ------------------------------------------------------------
-- WHY THE BROWSER CANNOT WRITE HERE
--
-- The anon key is public. If a visitor's browser could write to this
-- table, a visitor could write anything into it — a wrong price on a
-- £400 card, a renamed set — and every other customer would then be
-- served that. Writes are service-role only, which in practice means the
-- `tcgdex` edge function and nothing else. Reading is open to everybody,
-- because a cache nobody can read is not a cache.
-- ============================================================


-- ============================================================
-- 1. THE CACHE
-- ============================================================
create table if not exists public.tcgdex_cache (
  -- The API path with no leading slash: 'en/cards/swsh3-136', 'en/sets'.
  -- Not the full URL — the host is not part of the identity of the thing,
  -- and keying on it would silently duplicate every row the day TCGdex
  -- changes domain.
  path        text primary key,

  -- Exactly what TCGdex returned. Untouched.
  payload     jsonb not null,

  --   'set-list'  the list of sets. Small, slow to change.
  --   'set'       one set.
  --   'card'      one card, prices included.
  --   'search'    a query result. Changes as sets are added.
  --   'other'     anything else.
  kind        text not null default 'other'
              check (kind in ('set-list','set','card','search','other')),

  fetched_at  timestamptz not null default now(),

  -- How many times this row has been served. Not decoration: it is how
  -- you find out which cards actually matter to these customers, which is
  -- what a pre-warm should be based on rather than guesswork.
  hits        integer not null default 0,
  last_hit_at timestamptz,

  -- Set when a refresh fails, cleared when one succeeds. Lets the panel
  -- tell the difference between "quiet" and "upstream has been broken for
  -- six hours and everything you are seeing is from this morning".
  last_error       text,
  last_error_at    timestamptz
);

create index if not exists tcgdex_cache_kind_idx
  on public.tcgdex_cache (kind, fetched_at);

-- "What is worth keeping warm" — most-served rows first.
create index if not exists tcgdex_cache_hits_idx
  on public.tcgdex_cache (hits desc);


-- ============================================================
-- 2. HOW LONG EACH KIND STAYS FRESH
--
--    These are deliberately generous. A price twelve hours old is fine
--    for a shop window; a price nobody can see because the API is down is
--    not. Longer lives mean fewer upstream calls, which also means fewer
--    chances to be caught by an outage mid-request.
-- ============================================================
create or replace function public.tcgdex_ttl(p_kind text)
returns interval
language sql
immutable
as $$
  select case p_kind
    when 'set-list' then interval '7 days'    -- a new set appears a few times a year
    when 'set'      then interval '7 days'
    when 'card'     then interval '12 hours'  -- this one is really about prices
    when 'search'   then interval '6 hours'
    else                 interval '6 hours'
  end;
$$;


-- ============================================================
-- 3. WHAT THE APP READS
--
--    `fresh` is advisory. The client is expected to use a stale row
--    rather than nothing at all — see the note at the top of this file.
--    It is exposed so the app can decide whether to ALSO kick off a
--    refresh, not so it can decide whether to show the card.
-- ============================================================
create or replace view public.tcgdex_cache_public as
  select
    path,
    payload,
    kind,
    fetched_at,
    (now() - fetched_at) < public.tcgdex_ttl(kind) as fresh,
    age(now(), fetched_at)                          as age
  from public.tcgdex_cache;

grant select on public.tcgdex_cache_public to anon, authenticated;


-- ============================================================
-- 4. COUNTING WHAT GETS USED
--
--    security definer, because the visitor reading the cache has no write
--    access to it and should not get any. This function can do exactly
--    one thing: add one to a counter.
-- ============================================================
create or replace function public.tcgdex_cache_hit(p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tcgdex_cache
     set hits = hits + 1,
         last_hit_at = now()
   where path = p_path;
end;
$$;

grant execute on function public.tcgdex_cache_hit(text) to anon, authenticated;


-- ============================================================
-- 5. WHO CAN READ AND WRITE
-- ============================================================
alter table public.tcgdex_cache enable row level security;

drop policy if exists "anyone reads the cache" on public.tcgdex_cache;
create policy "anyone reads the cache"
  on public.tcgdex_cache for select
  to anon, authenticated
  using (true);

-- Deliberately no insert or update policy for anon or authenticated. The
-- edge function writes with the service role, which bypasses RLS. If a
-- write policy ever appears here, a customer can rewrite prices.

drop policy if exists "staff clear the cache" on public.tcgdex_cache;
create policy "staff clear the cache"
  on public.tcgdex_cache for delete
  to authenticated
  using (public.is_shop_staff());


-- ============================================================
-- 6. WHAT TO PRE-WARM
--
--    A cache that starts empty protects nobody on the day it ships. This
--    answers "which cards do these particular customers care about", and
--    the answer is not a guess: it is what they already own and what they
--    are already hunting.
--
--    Returns the card ids that are NOT yet cached, most-wanted first, so
--    the warm-up spends its first calls where they matter. Safe to call
--    repeatedly — the list shrinks as it fills.
-- ============================================================
create or replace function public.tcgdex_warm_list(p_limit integer default 200)
returns table (card_id text, want integer)
language sql
stable
security definer
set search_path = public
as $$
  with wanted as (
    select c.card_id, count(*)::integer as want
      from public.user_cards c
     where c.card_id is not null
     group by c.card_id
  )
  select w.card_id, w.want
    from wanted w
   where not exists (
     select 1 from public.tcgdex_cache tc
      where tc.path like '%/cards/' || w.card_id
   )
   order by w.want desc, w.card_id
   limit greatest(p_limit, 0);
$$;

grant execute on function public.tcgdex_warm_list(integer) to authenticated;


-- ============================================================
-- 7. HOUSEKEEPING
--
--    Not scheduled, and deliberately so. A cache that prunes itself on a
--    timer will always choose to do it five minutes before an outage.
--    Call it by hand, or from the daily cron, when the table gets big.
--
--    It never removes anything that is still being used: `hits = 0` and
--    untouched for the given period means nobody has looked at that card
--    since it was fetched.
-- ============================================================
create or replace function public.tcgdex_cache_prune(older_than_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  with gone as (
    delete from public.tcgdex_cache
     where hits = 0
       and fetched_at < now() - make_interval(days => older_than_days)
    returning 1
  )
  select count(*) into removed from gone;
  return removed;
end;
$$;


-- ============================================================
-- What you should see: an empty cache, and a count of how many distinct
-- cards your customers already own that are worth warming.
-- ============================================================
select
  (select count(*) from public.tcgdex_cache)                       as cached_rows,
  (select count(*) from public.tcgdex_cache_public where fresh)    as fresh_rows,
  (select count(*) from public.tcgdex_warm_list(100000))           as cards_worth_warming;
