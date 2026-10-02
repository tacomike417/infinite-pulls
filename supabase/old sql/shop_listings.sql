-- Infinite Pulls — cards for sale, and the promise that one card sells once
-- =======================================================================
--
-- Replaces the Clover tie-in, which never got developer approval and is a
-- dead end. Forty of Jeff's best cards, photographed in the shop, priced,
-- and live the same afternoon.
--
-- ==========================================================
-- THE ONE THING THIS FILE EXISTS TO GUARANTEE
-- ==========================================================
--
-- Every listing is quantity one. A collector single is not stock -- there
-- is one Base Set Charizard in that case and when it is gone it is gone.
-- So two people buying the same card is not an edge case to tidy up
-- afterwards with an apology and a refund; it is the failure that loses
-- the shop a customer and Jeff his enthusiasm for the whole idea.
--
-- It is made impossible by claim_listing() below, not by the app being
-- careful. One conditional UPDATE decides it, and the loser finds out
-- BEFORE they have typed a card number in, not after their money moved.
--
--     draft ──▶ live ──▶ held ──▶ sold
--                  ▲        │
--                  └────────┘  hold expires, back on sale
--
-- `held` is taken the instant somebody opens Checkout. Only the Stripe
-- webhook may write `sold`, because only Stripe knows whether money
-- actually moved -- the browser saying "I finished" proves nothing.
--
-- ==========================================================
-- WHAT IS DELIBERATELY NOT IN HERE
-- ==========================================================
--
-- Buyer names, emails, addresses, phone numbers. Stripe holds all of it,
-- is built to hold it, and is audited for holding it. This table keeps a
-- session id and a status, which is everything the shop needs to pack a
-- card and nothing it would then have to protect.
--
-- Same line the Customers tab drew: NO CONTACT DETAILS, EVER.
--
-- SAFE TO RUN TWICE.

create table if not exists public.shop_listings (
  id             uuid primary key default gen_random_uuid(),

  -- The catalogue card this is a copy OF, when it is a card we know.
  -- Nullable on purpose: Jeff will want to sell sealed product, lots, and
  -- the occasional oddity that is not in a 36,771-row singles index, and a
  -- listing that cannot be created is worse than one without a link.
  card_id        text,

  -- Typed once, kept forever. Deliberately NOT read live off the
  -- catalogue: this is the description of a physical object as it was
  -- sold, and it must not change under a completed sale because somebody
  -- upstream renamed a set.
  title          text        not null,
  set_name       text,
  number         text,

  -- "Near Mint", "PSA 9", whatever Jeff judged it to be, in his words.
  condition      text,

  -- CENTS. Never a float. $12.10 is not representable in binary floating
  -- point and money that is 0.00000001 out is money somebody argues about.
  price_cents    integer     not null check (price_cents > 0),

  /* PHOTOS OF THE ACTUAL CARD, and never the catalogue art.
     A single is bought on its condition and the buyer is paying for THIS
     copy. Stock art on a specific physical card is how a listing becomes
     an "item not as described" dispute -- and on singles the seller loses
     that one, because condition is a judgement call. The photo is the
     description. Storage paths, in the order Jeff took them; the first is
     the one the grid shows. */
  photos         text[]      not null default '{}',

  status         text        not null default 'draft'
                 check (status in ('draft','live','held','sold','pulled')),

  -- Collect at the shop, shipped, or the buyer's choice.
  fulfilment     text        not null default 'both'
                 check (fulfilment in ('pickup','ship','both')),
  ship_cents     integer     not null default 0 check (ship_cents >= 0),

  -- Set when a hold is taken; the hold is void once it passes.
  hold_expires_at timestamptz,

  -- Stripe's id for the checkout, and nothing else from Stripe.
  stripe_session_id text,

  sold_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.shop_listings is
  'One row per physical card for sale. Quantity is always one. Buyer details are never stored here -- Stripe holds them.';

-- The store page's only question: what is for sale, newest first.
create index if not exists shop_listings_for_sale
  on public.shop_listings (status, created_at desc);
create index if not exists shop_listings_card
  on public.shop_listings (card_id) where card_id is not null;

-- ==========================================================
-- WHO CAN SEE AND TOUCH WHAT
-- ==========================================================

alter table public.shop_listings enable row level security;

/* ANYONE may read a card that is FOR SALE. The store page is public --
   somebody has to be able to see a Charizard before deciding to want it,
   and requiring an account to look in a shop window is absurd.
   `held` is included: a card mid-checkout is still on the page, marked,
   because vanishing stock is how a page looks broken. */
drop policy if exists "for-sale listings are public" on public.shop_listings;
create policy "for-sale listings are public"
  on public.shop_listings for select
  to anon, authenticated
  using (status in ('live','held','sold'));

/* Drafts and pulled cards are the shop's business. Staff see everything,
   through the same is_shop_staff() gate the admin panel already uses. */
drop policy if exists "staff see every listing" on public.shop_listings;
create policy "staff see every listing"
  on public.shop_listings for select
  to authenticated
  using (public.is_shop_staff());

drop policy if exists "staff write listings" on public.shop_listings;
create policy "staff write listings"
  on public.shop_listings for all
  to authenticated
  using (public.is_shop_staff())
  with check (public.is_shop_staff());

-- ==========================================================
-- claim_listing() — the sold-once guarantee, in one statement
-- ==========================================================
--
-- Called as somebody opens Checkout. Returns true if the hold was taken
-- and the caller may proceed to Stripe; false if the card was already
-- gone, in which case they are told so before they see a payment form.
--
-- THE WHOLE THING IS THE `where`. A row can only move to `held` from
-- `live`, or from a `held` whose hold has run out. Two requests in the
-- same instant both run this UPDATE; Postgres serialises them on the row,
-- the first changes it, and the second matches nothing and returns false.
-- No advisory lock, no transaction dance, no application-level check that
-- could be raced past.

create or replace function public.claim_listing(
  p_id      uuid,
  p_minutes int default 20
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  got integer;
begin
  update public.shop_listings
  set status = 'held',
      hold_expires_at = now() + make_interval(mins => greatest(p_minutes, 1)),
      updated_at = now()
  where id = p_id
    and (
      status = 'live'
      or (status = 'held' and hold_expires_at is not null and hold_expires_at < now())
    );
  get diagnostics got = row_count;
  return got = 1;
end;
$$;

comment on function public.claim_listing(uuid, int) is
  'Takes a checkout hold on a listing. True = it is yours for p_minutes; false = somebody else got it. The conditional UPDATE is the whole guarantee -- do not add an application-level check in front of it.';

-- The Edge Function's service role calls this. Nobody else needs to, and
-- a browser that could take holds could take a card off sale for free.
revoke all on function public.claim_listing(uuid, int) from public, anon, authenticated;

-- ==========================================================
-- release_expired_holds() — abandoned checkouts come back
-- ==========================================================
--
-- Somebody opens Checkout, thinks better of it, closes the tab. Stripe
-- does send an expiry event, but a webhook that never arrives must not be
-- able to strand a $900 card off the shelf forever. Belt and braces:
-- schedule this hourly.

create or replace function public.release_expired_holds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  freed integer;
begin
  update public.shop_listings
  set status = 'live', hold_expires_at = null,
      stripe_session_id = null, updated_at = now()
  where status = 'held'
    and hold_expires_at is not null
    and hold_expires_at < now();
  get diagnostics freed = row_count;
  return freed;
end;
$$;

comment on function public.release_expired_holds() is
  'Puts abandoned checkouts back on sale. Scheduled hourly so a lost webhook cannot strand a card off the shelf.';

revoke all on function public.release_expired_holds() from public, anon, authenticated;

-- ==========================================================
-- THE PUBLIC SHOP WINDOW
-- ==========================================================
--
-- What the store page reads. A view rather than the table so the page can
-- never accidentally select a column that should not be public, however
-- the table grows later.

create or replace view public.shop_window as
  select id, card_id, title, set_name, number, condition,
         price_cents, ship_cents, fulfilment, photos,
         case when status = 'sold' then 'sold' else 'available' end as state,
         created_at
  from public.shop_listings
  where status in ('live','held','sold');

comment on view public.shop_window is
  'The public store page. Never exposes buyer data, hold times or Stripe ids.';

grant select on public.shop_window to anon, authenticated;

-- ==========================================================
-- AFTER RUNNING THIS
-- ==========================================================
--
-- Hourly release of abandoned holds (safe to run twice):
--
--   select cron.unschedule('infinite-pulls-release-holds')
--   where exists (select 1 from cron.job
--                 where jobname = 'infinite-pulls-release-holds');
--
--   select cron.schedule('infinite-pulls-release-holds', '7 * * * *',
--                        $$select public.release_expired_holds()$$);
