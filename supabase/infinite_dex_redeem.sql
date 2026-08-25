-- ============================================================
-- INFINITE DEX — the counter.
--
-- Run this once in the Supabase SQL Editor, after infinite_dex.sql.
-- Safe to re-run.
--
-- A customer walks up and says a username. Somebody behind the counter
-- looks them up, sees what they have earned, hands it over, and marks it
-- off. That is all this file is for, and it is the only part of Infinite
-- Dex where a real discount changes hands, so it is the part that gets
-- checked in the database rather than in a web page.
--
-- WHY THESE ARE FUNCTIONS AND NOT JUST QUERIES
--
-- Row-level security means the admin panel cannot read another person's
-- user_dex_cards at all (the policy allows a visitor their own rows, plus
-- anyone whose profile is public). A customer who turned their public page
-- off would be invisible at the counter — which is exactly the customer
-- most likely to be annoyed about it. Rather than widening that policy and
-- exposing every collection to every signed-in visitor, the two functions
-- below run as their owner and hand back only the four things the counter
-- needs: the name, how many cards, which rewards, which are already paid.
-- ============================================================


-- ============================================================
-- 1. WHO COUNTS AS STAFF
--
--    The rest of this panel treats "signed in" as "staff", because it is
--    behind a login only the shop has. That is a fair trade for a banner.
--    It is a worse trade for a function that decides who gets money off,
--    since a customer signed in to the public app is also "authenticated".
--
--    So: an allowlist. And because an empty allowlist on the day this runs
--    would lock Jeff out of his own counter, an EMPTY TABLE MEANS EVERY
--    SIGNED-IN USER PASSES — exactly today's behaviour, nothing breaks.
--    Adding a single row switches the counter to staff-only, permanently.
--
--    To lock it down, from the Supabase dashboard (SQL Editor):
--
--      insert into public.shop_staff (user_id, label)
--      select id, email from auth.users where email = 'jeff@example.com';
--
--    Do that once and only the named accounts can look a customer up.
-- ============================================================
create table if not exists public.shop_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  label text,
  added_at timestamptz not null default now()
);

alter table public.shop_staff enable row level security;

-- Readable so the panel can say whether the counter is locked down yet.
-- Deliberately NO insert/update/delete policy: rows go in from the
-- Supabase dashboard, which is the one place a customer cannot reach.
drop policy if exists "signed in reads staff list" on public.shop_staff;
create policy "signed in reads staff list"
  on public.shop_staff for select
  to authenticated
  using (true);

create or replace function public.dex_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and (
       not exists (select 1 from public.shop_staff)
       or exists (select 1 from public.shop_staff s where s.user_id = auth.uid())
     );
$$;


-- ============================================================
-- 2. LOOKING SOMEBODY UP
--
--    Takes the username they say out loud. Case and stray spaces do not
--    matter, because it is being typed on a phone by somebody holding a
--    booster box.
--
--    Returns { status, username, cards, rewards[] } where status is 'ok',
--    'not_found' or 'denied'. Never returns anything about the customer
--    beyond their name, their card count, and the state of each reward —
--    not their collection, not their email, not what they have bought.
-- ============================================================
create or replace function public.dex_lookup_customer(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid;
  v_name    text;
  v_avatar  text;
  v_cards   integer;
  v_rewards jsonb;
begin
  if not public.dex_is_staff() then
    return jsonb_build_object('status', 'denied');
  end if;

  if p_username is null or length(trim(p_username)) = 0 then
    return jsonb_build_object('status', 'not_found');
  end if;

  select id, username, avatar_url
    into v_user, v_name, v_avatar
    from public.profiles
   where lower(username) = lower(trim(p_username));

  if v_user is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select count(*) into v_cards
    from public.user_dex_cards where user_id = v_user;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'tier_id',        t.id,
             'cards_required', t.cards_required,
             'reward',         t.reward,
             'description',    t.description,
             'met',            v_cards >= t.cards_required,
             'redeemed_at',    r.redeemed_at,
             'redeemed_by',    r.redeemed_by
           ) order by t.cards_required
         ), '[]'::jsonb)
    into v_rewards
    from public.dex_reward_tiers t
    left join public.dex_reward_redemptions r
      on r.tier_id = t.id and r.user_id = v_user
   where t.enabled;

  return jsonb_build_object(
    'status',   'ok',
    'user_id',  v_user,
    'username', v_name,
    'avatar',   v_avatar,
    'cards',    v_cards,
    'rewards',  v_rewards
  );
end;
$$;


-- ============================================================
-- 3. MARKING IT OFF
--
--    Counts the cards again, here, at the moment of handing it over —
--    rather than trusting the number the panel was showing, which may
--    have been on screen for ten minutes. If it does not add up the
--    answer is 'not_earned' and nothing is written.
--
--    'already' is not an error. Two people behind one counter will
--    eventually both tap the button, and the unique constraint on
--    (user_id, tier_id) means the second one changes nothing.
-- ============================================================
create or replace function public.dex_redeem_reward(
  p_user uuid,
  p_tier uuid,
  p_by   text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_required integer;
  v_reward   text;
  v_cards    integer;
begin
  if not public.dex_is_staff() then
    return jsonb_build_object('status', 'denied');
  end if;

  select cards_required, reward into v_required, v_reward
    from public.dex_reward_tiers
   where id = p_tier and enabled = true;

  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;

  select count(*) into v_cards
    from public.user_dex_cards where user_id = p_user;

  if v_cards < v_required then
    return jsonb_build_object('status', 'not_earned', 'cards', v_cards, 'needed', v_required);
  end if;

  insert into public.dex_reward_redemptions (user_id, tier_id, redeemed_by, note)
  values (p_user, p_tier, nullif(trim(coalesce(p_by, '')), ''), nullif(trim(coalesce(p_note, '')), ''))
  on conflict (user_id, tier_id) do nothing;

  if not found then
    return jsonb_build_object('status', 'already', 'reward', v_reward);
  end if;

  return jsonb_build_object('status', 'recorded', 'reward', v_reward, 'cards', v_cards);
end;
$$;

-- dex_is_staff is the gate, so it is readable but never the door.
grant execute on function public.dex_is_staff()                           to authenticated;
grant execute on function public.dex_lookup_customer(text)                to authenticated;
grant execute on function public.dex_redeem_reward(uuid, uuid, text, text) to authenticated;
revoke all on function public.dex_lookup_customer(text)                   from anon;
revoke all on function public.dex_redeem_reward(uuid, uuid, text, text)   from anon;
