-- ============================================================
-- SEALED PRODUCT — booster boxes, ETBs, blisters, bundles, tins.
--
-- SAFE AGAINST LIVE DATA. Creates three new tables and touches nothing
-- that already exists. No delete, no drop of anything you have, no update
-- to a single existing row. Running it twice does nothing the second time.
--
-- Sealed is its own table rather than a row type inside user_cards: a
-- booster box has no card number, no variant, no rarity and no
-- illustrator, and it is priced by a completely different route. Same
-- reasoning that keeps wishlist_cards separate.
--
-- WHERE THE CATALOGUE COMES FROM, which differs by language and was
-- settled by probing the real APIs rather than by reading docs:
--
--   English — PokemonPriceTracker returns a REAL product list per set,
--     with TCGplayer product ids, product photos and prices. Surging
--     Sparks alone has 26 of them, including things nobody would guess
--     from a template: Half Booster Box, Sleeved Booster Pack Case,
--     Single Pack Blister [Wooper], Pokemon Center Elite Trainer Box
--     (Exclusive). That list is fetched once per set and kept here
--     forever, because product names and photos don't change — only
--     prices do. They bill per product returned, so caching the
--     catalogue is the difference between paying once per set and paying
--     every time somebody opens a page.
--
--   Japanese — the same API returns NOTHING for Japanese sealed
--     (verified: language=japanese gives zero rows for every query). So
--     Japanese products are derived instead, as set x product type, and
--     priced from eBay. Rows for those carry a 'derived:' product_id.
-- ============================================================

-- ---------- 1. The catalogue, and the current price ---------------------
-- One row per real product. Catalogue fields and price live together
-- because they are one-to-one and always read together; splitting them
-- would mean a join on every render for no benefit.
create table if not exists public.sealed_products (
  -- 'tcgplayer:565606' for a real product, or
  -- 'derived:SV8:booster-box:ja' for a Japanese one we inferred.
  -- The prefix is deliberately part of the id so it is always obvious
  -- which kind of row you are looking at.
  product_id text primary key,

  source     text not null default 'tcgplayer',   -- 'tcgplayer' | 'derived'
  name       text not null,                        -- 'Surging Sparks Booster Box'
  set_code   text,                                 -- 'SV08' — parsed off "SV08: Surging Sparks"
  set_label  text not null,                        -- 'Surging Sparks'
  card_lang  text not null default 'en',
  image_url  text,
  external_url text,                               -- the TCGplayer product page

  price          numeric(12,2),
  price_source   text,                             -- 'tcgplayer' | 'ebay'
  -- eBay quotes what live listings are ASKING, not what anything sold
  -- for. Stored as a flag rather than left to the reader, so the app can
  -- never accidentally present one as the other.
  is_asking_price boolean not null default false,
  -- Set when a lookup found nothing. A derived Japanese catalogue asks
  -- about products that were never made; remembering that is what stops
  -- it asking again every day.
  not_found      boolean not null default false,
  checked_at     timestamptz,

  created_at timestamptz not null default now(),

  constraint sealed_products_lang_known check (card_lang in ('en','ja'))
);

create index if not exists sealed_products_set_idx on public.sealed_products(card_lang, set_label);

alter table public.sealed_products enable row level security;

-- Anyone may read the catalogue; nobody may write it from a browser.
-- There is deliberately NO insert/update/delete policy — with RLS on and
-- no write policy, only the service role (the edge function, which is the
-- only thing holding the API keys) can write.
drop policy if exists "anyone reads sealed products" on public.sealed_products;
create policy "anyone reads sealed products"
  on public.sealed_products for select
  to anon, authenticated
  using (true);

-- ---------- 2. Which sets we've already paid to catalogue ---------------
-- PokemonPriceTracker bills one credit per product returned, so fetching
-- a set's catalogue twice is money for nothing. This records that a set
-- has been fetched so the edge function can skip it.
create table if not exists public.sealed_set_catalog (
  set_label  text not null,
  card_lang  text not null default 'en',
  product_count integer not null default 0,
  fetched_at timestamptz not null default now(),
  primary key (set_label, card_lang)
);

alter table public.sealed_set_catalog enable row level security;

drop policy if exists "anyone reads sealed set catalog" on public.sealed_set_catalog;
create policy "anyone reads sealed set catalog"
  on public.sealed_set_catalog for select
  to anon, authenticated
  using (true);

-- ---------- 3. What somebody owns ---------------------------------------
create table if not exists public.user_sealed (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  product_id text not null,
  -- Name, set and picture are copied onto the row rather than only joined
  -- from the catalogue, so somebody's collection still reads correctly if
  -- a product is ever renamed upstream or dropped from the catalogue.
  product_name text not null,
  set_label    text,
  card_lang    text not null default 'en',
  image_url    text,

  condition text not null default 'Sealed',
  quantity  integer not null default 1 check (quantity > 0),
  added_at  timestamptz not null default now(),

  constraint user_sealed_lang_known check (card_lang in ('en','ja'))
);

create index if not exists user_sealed_user_id_idx on public.user_sealed(user_id);

-- One row per product per person per condition. Adding the same box again
-- bumps quantity instead of creating a duplicate line — enforced here and
-- not only in the app, so a double-tap or a retry can't quietly make two.
create unique index if not exists user_sealed_one_row_per_holding
  on public.user_sealed(user_id, product_id, condition);

alter table public.user_sealed enable row level security;

drop policy if exists "users manage their own sealed" on public.user_sealed;
create policy "users manage their own sealed"
  on public.user_sealed for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Same visibility rule as user_cards: readable by others only when that
-- account has chosen to make its profile public.
drop policy if exists "public reads sealed of public profiles" on public.user_sealed;
create policy "public reads sealed of public profiles"
  on public.user_sealed for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = user_sealed.user_id and p.is_public = true
    )
  );

-- ============================================================
-- The result you should see: three tables, RLS on for all three, and a
-- read policy with NO write policy on the two the edge function owns.
-- ============================================================
select
  c.relname as table_name,
  c.relrowsecurity as rls_on,
  count(p.polname) filter (where p.polcmd in ('r','*'))     as read_or_all_policies,
  count(p.polname) filter (where p.polcmd in ('a','w','d')) as write_policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relname in ('sealed_products','sealed_set_catalog','user_sealed')
group by c.relname, c.relrowsecurity
order by c.relname;
