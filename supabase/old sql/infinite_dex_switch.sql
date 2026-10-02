-- ============================================================
-- THE INFINITE DEX ON/OFF SWITCH
--
-- ⚠ RUNNING THIS FILE TURNS THE INFINITE DEX OFF FOR EVERY CUSTOMER.
--   That is deliberate. Jeff is not ready for the rewards side yet, and a
--   half-ready rewards system is worse than none: a customer who collects
--   five cards and is told a discount is waiting, then finds nobody at the
--   counter knows what they are talking about, has been lied to by the app.
--
--   Turn it back on in /admin/ → Infinite Dex → Infinite Dex & Rewards.
--   Nothing here deletes a card, a reward tier, or anybody's collection.
--   Off means hidden, never destroyed.
--
-- Safe to re-run. Re-running does NOT reset the switches to off — the seed
-- only inserts when the row does not already exist.
--
-- TWO SWITCHES, NOT ONE
--
--   dex_on      the ∞ tab, the home-screen card, the code box, and every
--               card a customer can earn
--   rewards_on  the reward tiers, the progress line, and redemption
--
-- Rewards cannot be on while the Dex is off — a discount for collecting
-- cards nobody can collect is not a state worth allowing, so the database
-- refuses it rather than trusting the panel to.
--
-- This is what lets the Grand Opening card ship on September 12th without
-- Jeff having decided anything about discounts: dex_on = true,
-- rewards_on = false. Codes work, cards land, people collect. The reward
-- half stays dark until he says so.
-- ============================================================


-- ============================================================
-- 1. THE SWITCHES — one row, read by everybody, written by staff.
--    Same shape as public.banner, for the same reason: it is one
--    setting the shop controls and every visitor obeys.
-- ============================================================
create table if not exists public.dex_settings (
  id smallint primary key default 1,
  dex_on boolean not null default false,
  rewards_on boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint dex_settings_singleton check (id = 1),
  -- The database will not hold the impossible state.
  constraint dex_settings_rewards_need_dex check (rewards_on = false or dex_on = true)
);

insert into public.dex_settings (id, dex_on, rewards_on)
values (1, false, false)
on conflict (id) do nothing;

create or replace function public.set_dex_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists dex_settings_set_updated_at on public.dex_settings;
create trigger dex_settings_set_updated_at
  before update on public.dex_settings
  for each row
  execute function public.set_dex_settings_updated_at();

alter table public.dex_settings enable row level security;

-- Everybody reads it, signed in or not. The app has to know whether to
-- draw the ∞ tab before it knows who is looking.
drop policy if exists "public read dex settings" on public.dex_settings;
create policy "public read dex settings"
  on public.dex_settings for select
  to anon, authenticated
  using (true);

-- Only staff flip it. Written against is_shop_staff() from
-- admin_lockdown.sql — if that file has not been run yet, run it first or
-- this policy will refuse everybody, which is the safe direction to fail.
drop policy if exists "staff update dex settings" on public.dex_settings;
create policy "staff update dex settings"
  on public.dex_settings for update
  to authenticated
  using (public.is_shop_staff())
  with check (public.is_shop_staff());

-- No insert and no delete policy. There is one row and there is only ever
-- one row.


-- ============================================================
-- 2. THE ANSWERS, AS FUNCTIONS
--    So nothing has to remember to also check dex_on when it asks
--    about rewards.
-- ============================================================
create or replace function public.dex_is_on()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select dex_on from public.dex_settings where id = 1), false);
$$;

create or replace function public.dex_rewards_are_on()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select dex_on and rewards_on from public.dex_settings where id = 1), false);
$$;

grant execute on function public.dex_is_on()         to anon, authenticated;
grant execute on function public.dex_rewards_are_on() to anon, authenticated;


-- ============================================================
-- 3. ENFORCEMENT — at the table, not in the app
--
-- WHY A TRIGGER AND NOT A CHECK INSIDE EACH FUNCTION
--
-- award_dex_card(), claim_dex_card() and dex_sweep() would each need the
-- same three lines, which means re-stating all three function bodies in
-- this file. Then infinite_dex.sql and this file both define them, and
-- whichever ran last wins — the exact trap MARKETING.md already warns
-- about with the poster prompt. A trigger on the table catches every one
-- of those paths, plus whatever gets written next year, and duplicates
-- nothing.
--
-- WHY IT IS SILENT RATHER THAN AN ERROR
--
-- dex_sweep() runs on every page load. If it threw while the Dex was off,
-- every visitor would collect an error on every navigation for a feature
-- they cannot even see. Skipping the insert is the honest no-op: no card
-- is handed over, nothing is said, and the app's own "did I get one?"
-- check comes back no.
--
-- The app is also gated client-side, so this should never actually fire.
-- It exists for the case that matters: a phone holding an old copy of
-- app.js out of the service worker cache, still sweeping away, days after
-- the switch was thrown.
-- ============================================================
create or replace function public.dex_block_awards_when_off()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.dex_is_on() then
    return new;
  end if;
  return null;   -- skip the insert, quietly
end;
$$;

drop trigger if exists dex_awards_respect_switch on public.user_dex_cards;
create trigger dex_awards_respect_switch
  before insert on public.user_dex_cards
  for each row
  execute function public.dex_block_awards_when_off();


-- A redemption is different: it is Jeff, standing at the counter, pressing
-- a button. If that does not work he needs to be told why, in words, right
-- now — not to watch it silently do nothing.
create or replace function public.dex_block_redemptions_when_off()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.dex_rewards_are_on() then
    return new;
  end if;
  raise exception
    'Infinite Rewards are switched off. Turn them on in the admin panel under Infinite Dex before redeeming.'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists dex_redemptions_respect_switch on public.dex_reward_redemptions;
create trigger dex_redemptions_respect_switch
  before insert on public.dex_reward_redemptions
  for each row
  execute function public.dex_block_redemptions_when_off();


-- ============================================================
-- 4. WHERE THINGS STAND RIGHT NOW
--    Read this after running the file.
-- ============================================================
select
  case when dex_on     then 'ON  — customers can see the Infinite Dex'
                       else 'OFF — the ∞ tab and the home card are hidden' end as infinite_dex,
  case when rewards_on then 'ON  — tiers, progress and redemption are live'
                       else 'OFF — cards still collect, no rewards shown'   end as infinite_rewards,
  updated_at
from public.dex_settings
where id = 1;
