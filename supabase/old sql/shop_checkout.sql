-- ==========================================================
-- SELLING WHAT IS ON THE SHELF
-- ==========================================================
--
-- The Shop page already shows Jeff's real inventory, synced from the
-- till. This is what turns looking into buying.
--
-- THE ONE PROBLEM WORTH BUILDING AROUND
--
-- Nearly every item in that shop is quantity ONE. A single card, a single
-- ETB. So "two people buy the same thing" is not an unlikely edge case,
-- it is the ordinary outcome of a busy Saturday -- and on a card, the
-- buyer paid for THAT copy, so there is no substituting one and no
-- winning the chargeback.
--
-- Clover Hosted Checkout does not touch Clover inventory. Their words.
-- So nothing about a completed sale reduces the count on its own, in
-- either direction. Left alone this sells the same card twice and then
-- keeps offering it.
--
-- Four things stop that, and only all four together:
--
--   1. the inventory sync runs on a schedule, not on a button
--   2. live stock is re-checked with Clover the moment somebody clicks
--      Buy, before any payment page exists
--   3. the item is HELD here while they pay -- claim_shop_item() below,
--      which locks the row so two shoppers cannot both read "1 left"
--   4. when the webhook confirms payment, the count is reduced IN CLOVER
--      by the sync function, using the Inventory:Write permission the
--      token already has
--
-- Step 3 is the guarantee. Steps 1, 2 and 4 keep the two sides agreeing;
-- step 3 is what makes it impossible rather than unlikely, and it is a
-- database lock rather than a promise made by application code.
--
-- SAFE TO RUN TWICE.


-- ==========================================================
-- PART 1 -- the ecommerce credentials
-- ==========================================================
--
-- SEPARATE FROM THE INVENTORY TOKEN ON PURPOSE. clover_connection holds
-- a token scoped to Inventory:Read/Write. This holds the Ecommerce API
-- key, which can take money. Different power, different row, and neither
-- one is readable from any browser.
--
-- Clover allows exactly ONE ecommerce token per merchant account, so
-- generating a second one in the dashboard invalidates whatever is
-- stored here. Worth knowing before somebody tidies up.

create table if not exists public.clover_ecom (
  id             int primary key default 1,
  merchant_id    text,
  private_token  text,
  webhook_secret text,
  updated_at     timestamptz not null default now(),
  constraint clover_ecom_single_row check (id = 1)
);

comment on table public.clover_ecom is
  'The Clover Ecommerce API key that can take payments. RLS on with NO policies: only the Edge Functions, running as the service role, can ever read this.';

-- On, with no policies at all. That is the point: nothing in a browser
-- can read this table, including Mike's own admin session.
alter table public.clover_ecom enable row level security;

/* What the admin panel is allowed to know: whether it is connected, and
   which merchant. Never the key. */
create or replace function public.clover_ecom_status()
returns table (connected boolean, merchant_id text, has_webhook boolean, updated_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select
    (c.private_token is not null and c.private_token <> '') as connected,
    c.merchant_id,
    (c.webhook_secret is not null and c.webhook_secret <> '') as has_webhook,
    c.updated_at
  from public.clover_ecom c
  where c.id = 1
$$;

grant execute on function public.clover_ecom_status() to authenticated;

create or replace function public.clover_save_ecom(
  p_merchant_id    text,
  p_private_token  text,
  p_webhook_secret text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_shop_staff() then
    raise exception 'Not allowed';
  end if;

  -- Empty values disconnect, same shape as the inventory token.
  if coalesce(p_merchant_id, '') = '' and coalesce(p_private_token, '') = '' then
    delete from public.clover_ecom where id = 1;
    return;
  end if;

  insert into public.clover_ecom (id, merchant_id, private_token, webhook_secret, updated_at)
  values (1, nullif(trim(p_merchant_id), ''), nullif(trim(p_private_token), ''),
          nullif(trim(coalesce(p_webhook_secret, '')), ''), now())
  on conflict (id) do update set
    merchant_id    = excluded.merchant_id,
    private_token  = excluded.private_token,
    -- A blank webhook secret leaves the stored one alone, so saving the
    -- key again does not silently switch webhook verification off.
    webhook_secret = coalesce(excluded.webhook_secret, public.clover_ecom.webhook_secret),
    updated_at     = now();
end;
$$;

grant execute on function public.clover_save_ecom(text, text, text) to authenticated;


-- ==========================================================
-- PART 2 -- holds
-- ==========================================================
--
-- One row per attempt to buy something. It exists from the moment
-- somebody clicks Buy until either the payment lands or the hold expires
-- on its own.
--
-- NOTHING PERSONAL IS KEPT HERE. No name, no address, no email, no card.
-- Clover holds all of that and is built to. This table knows an item, a
-- quantity, a session id and a status -- everything the shop needs to not
-- sell the same card twice, and nothing it would have to protect.

create table if not exists public.shop_holds (
  id              uuid primary key default gen_random_uuid(),
  clover_item_id  text not null,
  qty             int  not null default 1 check (qty > 0),
  fulfilment      text not null default 'pickup' check (fulfilment in ('pickup', 'ship')),
  session_id      text,
  status          text not null default 'held' check (status in ('held', 'paid', 'released')),
  expires_at      timestamptz not null,
  paid_at         timestamptz,
  created_at      timestamptz not null default now()
);

comment on table public.shop_holds is
  'One row per attempt to buy. Holds an item out of stock while the customer pays. No personal data, ever -- Clover keeps that.';

create index if not exists shop_holds_live
  on public.shop_holds (clover_item_id, status, expires_at);
create index if not exists shop_holds_session
  on public.shop_holds (session_id);

alter table public.shop_holds enable row level security;

-- Shoppers never read this table; the Edge Functions do all the work as
-- the service role. Staff can look, to answer "did that go through".
drop policy if exists "staff read holds" on public.shop_holds;
create policy "staff read holds"
  on public.shop_holds for select using (public.is_shop_staff());


-- ==========================================================
-- PART 3 -- the guarantee
-- ==========================================================
--
-- THE ONLY DOOR OUT OF STOCK.
--
-- `for update` on the inventory row is the whole thing. Two shoppers
-- tapping Buy on the last Charizard within the same second both reach
-- this function; the first one takes the lock, sees 1 available, and
-- inserts a hold. The second waits for that lock, then reads the SAME
-- row and now counts one live hold against it, so it sees 0 available
-- and gets nothing. It is a lock rather than a check-then-write for
-- exactly that reason -- the version without the lock passes every test
-- and fails on the one Saturday it matters.
--
-- Returns the hold id, or null for "gone". The caller must treat null as
-- gone and never as an error to retry.

create or replace function public.claim_shop_item(
  p_item_id    text,
  p_qty        int  default 1,
  p_fulfilment text default 'pickup'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  have   int;
  held   int;
  new_id uuid;
begin
  if coalesce(p_qty, 0) < 1 then return null; end if;

  select i.stock_count into have
  from public.shop_inventory i
  where i.clover_item_id = p_item_id
  for update;

  -- No such item, or Clover never told us a count. Refusing to sell
  -- something whose stock we do not know is the correct answer.
  if have is null then return null; end if;

  select coalesce(sum(h.qty), 0) into held
  from public.shop_holds h
  where h.clover_item_id = p_item_id
    and (h.status = 'paid' or (h.status = 'held' and h.expires_at > now()));

  if have - held < p_qty then return null; end if;

  insert into public.shop_holds (clover_item_id, qty, fulfilment, expires_at)
  values (p_item_id, p_qty,
          case when p_fulfilment = 'ship' then 'ship' else 'pickup' end,
          -- A Clover checkout session dies after 15 minutes. Five more
          -- here so a hold never outlives its session by much, and an
          -- abandoned basket puts the card back on sale on its own.
          now() + interval '20 minutes')
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.claim_shop_item(text, int, text) from public, anon, authenticated;

/* The session id arrives after the hold, because the hold has to be taken
   BEFORE Clover is asked for a checkout page -- otherwise the gap between
   the two is a window where the same card is sold twice. */
create or replace function public.attach_checkout_session(p_hold uuid, p_session text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.shop_holds set session_id = p_session where id = p_hold;
$$;

revoke all on function public.attach_checkout_session(uuid, text) from public, anon, authenticated;

/* Called by the webhook, and by nothing else. Returns the item and
   quantity so the caller can reduce the count in Clover. */
create or replace function public.mark_hold_paid(p_session text)
returns table (hold_id uuid, clover_item_id text, qty int, already boolean)
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  select * into r from public.shop_holds
   where session_id = p_session
   order by created_at desc
   limit 1
   for update;

  if not found then return; end if;

  -- Clover may send the same webhook more than once. Saying so rather
  -- than pretending it is new is what stops stock being decremented
  -- twice for one sale.
  if r.status = 'paid' then
    return query select r.id, r.clover_item_id, r.qty, true;
    return;
  end if;

  update public.shop_holds
     set status = 'paid', paid_at = now()
   where id = r.id;

  return query select r.id, r.clover_item_id, r.qty, false;
end;
$$;

revoke all on function public.mark_hold_paid(text) from public, anon, authenticated;

/* Housekeeping. Expired holds stop counting against stock the moment
   they expire -- claim_shop_item already ignores them -- so this is only
   tidying, and it is safe to run whenever. */
create or replace function public.release_expired_shop_holds()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare n bigint;
begin
  update public.shop_holds
     set status = 'released'
   where status = 'held' and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.release_expired_shop_holds() from public, anon, authenticated;


-- ==========================================================
-- PART 4 -- what the Shop page is allowed to sell
-- ==========================================================
--
-- Available = what the till says, minus anything currently held or paid
-- for and not yet synced away. The page reads THIS, never stock_count
-- directly, so a card somebody is in the middle of buying stops being
-- offered to the next person immediately rather than at the next sync.

create or replace view public.shop_available as
select
  i.clover_item_id,
  i.name,
  i.price,
  i.stock_count,
  greatest(i.stock_count - coalesce(h.taken, 0), 0) as available,
  i.updated_at
from public.shop_inventory i
left join (
  select clover_item_id, sum(qty) as taken
  from public.shop_holds
  where status = 'paid' or (status = 'held' and expires_at > now())
  group by clover_item_id
) h on h.clover_item_id = i.clover_item_id;

comment on view public.shop_available is
  'shop_inventory minus live holds. The Shop page reads this so a card being paid for right now is not still on sale to the next visitor.';

grant select on public.shop_available to anon, authenticated;
