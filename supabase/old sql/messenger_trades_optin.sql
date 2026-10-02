-- ============================================================
-- TRADES: EACH PERSON TURNS THEM ON -- 29 Sep 2026 (Mike).
--
-- A switch at the top of Messages. Off by default. The first time someone
-- turns it on, Infinite Pulls (the shop account) sends them a message
-- explaining how trades work and that the prices are ESTIMATES (raw, Near
-- Mint market prices -- no condition or grading data; check Dex or
-- Collectr for exact values).
--
-- A trade needs BOTH people to have Trades on. Your collection only shows
-- in someone's trade picker if you have Trades on.
--
-- Run after messenger_trades.sql. SAFE TO RUN TWICE.
-- ============================================================

create table if not exists public.dm_prefs (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  trades      boolean not null default false,
  welcomed_at timestamptz,
  changed_at  timestamptz not null default now()
);
alter table public.dm_prefs enable row level security;
drop policy if exists "people read their own message settings" on public.dm_prefs;
create policy "people read their own message settings"
  on public.dm_prefs for select to authenticated using (auth.uid() = user_id);
-- written only by the messages function

create or replace function public.dm_trades_on(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select trades from public.dm_prefs where user_id = p_user), false); $$;
revoke all on function public.dm_trades_on(uuid) from public, anon;
grant execute on function public.dm_trades_on(uuid) to authenticated, service_role;

-- their collection in the trade picker: only if you can message them AND they have Trades on
create or replace function public.dm_their_cards(p_other uuid)
returns table (id uuid, card_name text, set_name text, image_url text, variant text, condition text, value numeric)
language sql stable security definer set search_path = public
as $$
  select u.id, u.card_name, u.set_name, u.image_url, u.variant, u.condition, p.value
    from public.user_cards u
    left join public.trade_prices(array(select x.id from public.user_cards x where x.user_id = p_other)) p on p.id = u.id
   where u.user_id = p_other
     and auth.uid() is not null
     and public.dm_pair_why(auth.uid(), p_other) is null
     and public.dm_trades_on(p_other)
   order by u.added_at desc
   limit 1000;
$$;
grant execute on function public.dm_their_cards(uuid) to authenticated;

select 'trades switch: ok' as status,
       (select id is not null from public.profiles where lower(username) = 'infinitepullstcg') as shop_account_found;
