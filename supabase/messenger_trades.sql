-- ============================================================
-- MESSENGER: TRADES + ASK TO CHAT -- 28 Sep 2026 (Mike).
--
-- TRADES (the board's Step 3):
--   * In a chat, tap ⇄: see YOUR cards and THEIR cards (even a private
--     collection -- but only to someone who can already message them),
--     pick what goes each way, and the analyzer adds up both sides from
--     the app's own market prices (your own value on a graded card).
--   * It's sent as a trade card: Accept, Counter or Decline. The sender
--     can Cancel while it's open.
--   * Infinite Pulls isn't part of any trade. Nothing moves between
--     collections; accepting just says "deal" -- the rest is between them.
--
-- ASK TO CHAT (Step 1's last piece):
--   * People who could message each other except they don't follow each
--     other get "Ask to chat" instead of Message. It's a one-tap knock:
--     no words, no pictures, once a week per person. The other person sees
--     it in Messages with "Follow back" or "No thanks". A block ends it.
--
-- Run messages.sql, ages.sql and messenger_safety.sql first.
-- SAFE TO RUN TWICE.
-- ============================================================

-- ---------------------------------------------------------------- PRICES
-- What ONE copy of each card is worth, the same way the rest of the app
-- decides it: a graded card with an owner value uses that; otherwise the
-- newest TCGplayer price for the card's own printing, then any TCGplayer
-- printing. Null = no price known.
create or replace function public.trade_prices(p_ids uuid[])
returns table (id uuid, value numeric)
language sql stable security definer set search_path = public
as $$
  select u.id,
         coalesce(
           case when u.condition ~* '^(PSA|CGC|BGS|BECKETT|TAG|SGC|ACE)' then u.owner_value end,
           (select h.price from public.card_price_history h
             where h.card_id = u.card_id and coalesce(h.source, 'tcgplayer') = 'tcgplayer' and h.variant = u.variant
             order by h.recorded_on desc limit 1),
           (select h.price from public.card_price_history h
             where h.card_id = u.card_id and coalesce(h.source, 'tcgplayer') = 'tcgplayer'
             order by (h.variant = 'market') desc, h.recorded_on desc limit 1)
         )::numeric(12,2)
    from public.user_cards u
   where u.id = any(p_ids)
   limit 1000;
$$;
grant execute on function public.trade_prices(uuid[]) to authenticated;
grant execute on function public.trade_prices(uuid[]) to service_role;

-- THEIR COLLECTION, for the trade picker. Only if you two can message.
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
   order by u.added_at desc
   limit 1000;
$$;
grant execute on function public.dm_their_cards(uuid) to authenticated;

-- ---------------------------------------------------------------- TRADES
create table if not exists public.dm_trades (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.dm_threads(id) on delete cascade,
  from_id     uuid not null references auth.users(id) on delete cascade,
  to_id       uuid not null references auth.users(id) on delete cascade,
  give_ids    uuid[] not null,          -- from_id's cards
  get_ids     uuid[] not null,          -- to_id's cards
  give_value  numeric(12,2),
  get_value   numeric(12,2),
  status      text not null default 'open' check (status in ('open', 'accepted', 'declined', 'countered', 'cancelled')),
  replaces    uuid references public.dm_trades(id) on delete set null,
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists dm_trades_thread_idx on public.dm_trades (thread_id, created_at desc);
alter table public.dm_trades enable row level security;
-- no policies: read through dm_trade_details(); written by the server only.

alter table public.dm_messages add column if not exists trade_id uuid references public.dm_trades(id) on delete set null;
alter table public.dm_messages drop constraint if exists dm_messages_not_empty;
alter table public.dm_messages add constraint dm_messages_not_empty
  check (body is not null or photo_key is not null or share_key is not null or trade_id is not null);

-- A TRADE CARD'S DETAILS: the trade plus a picture/name/value for every
-- card on it. Only the two people in it (or a moderator on a reported chat).
create or replace function public.dm_trade_details(p_ids uuid[])
returns table (id uuid, from_id uuid, to_id uuid, status text, give_value numeric, get_value numeric,
               created_at timestamptz, give jsonb, get jsonb)
language sql stable security definer set search_path = public
as $$
  select t.id, t.from_id, t.to_id, t.status, t.give_value, t.get_value, t.created_at,
    coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.card_name, 'set', u.set_name, 'img', u.image_url,
                     'cond', u.condition, 'value', p.value) order by p.value desc nulls last)
                from public.user_cards u left join public.trade_prices(t.give_ids) p on p.id = u.id
               where u.id = any(t.give_ids)), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.card_name, 'set', u.set_name, 'img', u.image_url,
                     'cond', u.condition, 'value', p.value) order by p.value desc nulls last)
                from public.user_cards u left join public.trade_prices(t.get_ids) p on p.id = u.id
               where u.id = any(t.get_ids)), '[]'::jsonb)
    from public.dm_trades t
   where t.id = any(p_ids)
     and (auth.uid() in (t.from_id, t.to_id)
          or (public.is_moderator() and exists (select 1 from public.dm_reports r
                                                  where r.thread_id = t.thread_id and r.handled_at is null)));
$$;
grant execute on function public.dm_trade_details(uuid[]) to authenticated;

-- ---------------------------------------------------------------- ASK TO CHAT
create table if not exists public.dm_asks (
  from_id     uuid not null references auth.users(id) on delete cascade,
  to_id       uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  answered_at timestamptz,
  answer      text check (answer in ('yes', 'no')),
  primary key (from_id, to_id)
);
alter table public.dm_asks enable row level security;
-- no policies: only the functions below touch it.

-- People you could message if you followed each other (for the button).
create or replace function public.dm_askable()
returns table (id uuid)
language sql stable security definer set search_path = public
as $$
  select a.user_id from public.dm_access a
   where public.dm_can() and a.user_id <> auth.uid()
     and public.dm_pair_why(auth.uid(), a.user_id) = 'follow';
$$;
grant execute on function public.dm_askable() to authenticated;

-- KNOCK. Returns 'ok', 'wait' (asked in the last week) or 'no'.
create or replace function public.dm_ask(p_to uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  had record;
begin
  if auth.uid() is null or public.dm_pair_why(auth.uid(), p_to) is distinct from 'follow' then return 'no'; end if;
  select * into had from public.dm_asks where from_id = auth.uid() and to_id = p_to;
  if found and had.created_at > now() - interval '7 days' then return 'wait'; end if;
  insert into public.dm_asks (from_id, to_id) values (auth.uid(), p_to)
  on conflict (from_id, to_id) do update set created_at = now(), answered_at = null, answer = null;
  return 'ok';
end;
$$;
grant execute on function public.dm_ask(uuid) to authenticated;

-- ASKS WAITING FOR ME (blocked people never show).
create or replace function public.dm_my_asks()
returns table (from_id uuid, username text, avatar_url text, created_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select q.from_id, p.username, p.avatar_url, q.created_at
    from public.dm_asks q join public.profiles p on p.id = q.from_id
   where q.to_id = auth.uid() and q.answered_at is null
     and q.created_at > now() - interval '30 days'
     and not exists (select 1 from public.user_blocks b
                      where (b.blocker_id = auth.uid() and b.blocked_id = q.from_id)
                         or (b.blocker_id = q.from_id and b.blocked_id = auth.uid()))
   order by q.created_at desc;
$$;
grant execute on function public.dm_my_asks() to authenticated;

-- ANSWER: 'yes' follows them back (so you can now message), 'no' just closes it.
create or replace function public.dm_answer_ask(p_from uuid, p_yes boolean)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return 'no'; end if;
  update public.dm_asks set answered_at = now(), answer = case when p_yes then 'yes' else 'no' end
   where from_id = p_from and to_id = auth.uid() and answered_at is null;
  if not found then return 'no'; end if;
  if p_yes then
    insert into public.follows (follower_id, followee_id, following, changed_at)
    values (auth.uid(), p_from, true, now())
    on conflict (follower_id, followee_id) do update set following = true, changed_at = now();
  end if;
  return 'ok';
end;
$$;
grant execute on function public.dm_answer_ask(uuid, boolean) to authenticated;

-- A correct result: one row, 'trades: ok'.
select case when to_regclass('public.dm_trades') is not null
             and to_regclass('public.dm_asks') is not null
             and exists (select 1 from information_schema.columns where table_name = 'dm_messages' and column_name = 'trade_id')
            then 'trades: ok' else 'trades: MISSING' end as status;
