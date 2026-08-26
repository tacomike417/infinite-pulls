-- ============================================================
-- LOCKING THE ADMIN PANEL TO STAFF
--
-- ⚠ READ THE NEXT TWENTY LINES BEFORE RUNNING THIS. It will not lock you
--   out — it refuses to run rather than let that happen — but it needs one
--   edit from you first.
--
-- THE PROBLEM
--
-- Every admin policy in this project was written as
--
--     to authenticated using (true)
--
-- which reads as "signed in". A signed-in CUSTOMER is also authenticated.
-- So anyone with an account on the public app could, through the ordinary
-- REST API and without ever opening /admin/:
--
--     rewrite the banner every visitor sees
--     change the shop's address and opening hours
--     edit, disable or delete any Infinite Dex card
--     set a reward tier to "1 card — a free booster box"
--     rewrite the marketing prompts
--     insert a redemption against somebody else's account
--
-- The reward tier is the one that costs money. The banner is the one that
-- would be noticed first.
--
-- WHAT THIS DOES
--
-- Replaces every one of those policies with a check against a named staff
-- list. Reading stays exactly as it was — the app still shows everybody
-- the banner, the hours and the cards. Only writing changes.
--
-- STEP 1 — put yourself on the staff list. Edit the emails below.
-- STEP 2 — run the whole file.
--
-- If the staff list ends up empty, the file stops at step 2 and changes
-- nothing.
-- ============================================================


-- ============================================================
-- 1. WHO IS STAFF
--    Add every account that should be able to run the shop. Emails, as
--    they were typed when the account was made. Safe to re-run, and safe
--    to run again later with a new name added.
-- ============================================================
insert into public.shop_staff (user_id, label)
select id, email
  from auth.users
 where lower(email) in (
   -- ⚠ EDIT THIS LIST ⚠
   'mnasvadi@gmail.com'
   -- , 'jeff@infinitepulls.com'
 )
on conflict (user_id) do nothing;


-- ============================================================
-- 2. THE GUARD
--    A staff list nobody is on would lock the shop out of its own panel,
--    so this stops the file rather than letting that happen. If you see
--    this error: the email above did not match a row in auth.users. Check
--    the spelling, or sign in once with that account first so the row
--    exists.
-- ============================================================
do $$
declare n integer;
begin
  select count(*) into n from public.shop_staff;
  if n = 0 then
    raise exception
      'Nobody is on the staff list, so nothing was changed. Edit the email list in section 1 and run this file again.';
  end if;
  raise notice 'Staff list has % account(s). Locking the panel to them.', n;
end $$;


-- ============================================================
-- 3. THE TEST EVERY POLICY BELOW USES
--
--    Strict: you are staff if you are signed in AND on the list. No
--    "empty means everyone" — that was the temporary shape this had while
--    the counter was the only thing using it, and it is what this file
--    exists to end.
--
--    SECURITY DEFINER so that shop_staff itself can be locked down later
--    without every policy breaking.
-- ============================================================
create or replace function public.is_shop_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_staff s where s.user_id = auth.uid()
  );
$$;

grant execute on function public.is_shop_staff() to authenticated;

-- The counter's own gate now means the same thing as everything else.
create or replace function public.dex_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_shop_staff();
$$;

-- Nobody but staff should be able to read who staff are.
drop policy if exists "signed in reads staff list" on public.shop_staff;
drop policy if exists "staff read the staff list" on public.shop_staff;
create policy "staff read the staff list"
  on public.shop_staff for select
  to authenticated
  using (public.is_shop_staff());


-- ============================================================
-- 4. THE POLICIES
--
--    One per thing a customer could previously have rewritten. Reading is
--    untouched throughout: the existing "public read" policies still let
--    every visitor see the banner, the hours, the cards and the rewards.
-- ============================================================

-- The banner every visitor sees.
drop policy if exists "admin update banner" on public.banner;
create policy "staff update banner"
  on public.banner for update
  to authenticated
  using (public.is_shop_staff())
  with check (public.is_shop_staff());

-- The address, the hours, the events, the deals.
drop policy if exists "admin update store_info" on public.store_info;
create policy "staff update store_info"
  on public.store_info for update
  to authenticated
  using (public.is_shop_staff())
  with check (public.is_shop_staff());

-- Collector Goals.
drop policy if exists "admin manage collector goal templates" on public.collector_goal_templates;
create policy "staff manage collector goal templates"
  on public.collector_goal_templates for all
  to authenticated
  using (public.is_shop_staff())
  with check (public.is_shop_staff());

-- The Infinite Dex catalogue.
drop policy if exists "admin manage dex cards" on public.infinite_dex_cards;
create policy "staff manage dex cards"
  on public.infinite_dex_cards for all
  to authenticated
  using (public.is_shop_staff())
  with check (public.is_shop_staff());

-- What a pile of cards is worth. This is the one that costs real money.
drop policy if exists "admin manage dex reward tiers" on public.dex_reward_tiers;
create policy "staff manage dex reward tiers"
  on public.dex_reward_tiers for all
  to authenticated
  using (public.is_shop_staff())
  with check (public.is_shop_staff());

-- Redemptions. A customer could previously write one against anybody's
-- account. They are still readable by their owner and by staff, and are
-- still written only through dex_redeem_reward(), which counts the cards.
drop policy if exists "admin record redemptions" on public.dex_reward_redemptions;
create policy "staff record redemptions"
  on public.dex_reward_redemptions for insert
  to authenticated
  with check (public.is_shop_staff());

drop policy if exists "admin read redemptions" on public.dex_reward_redemptions;
create policy "staff read redemptions"
  on public.dex_reward_redemptions for select
  to authenticated
  using (public.is_shop_staff());

-- The marketing prompts and the brand file list.
drop policy if exists "admin manages marketing prompts" on public.marketing_prompts;
create policy "staff manage marketing prompts"
  on public.marketing_prompts for all
  to authenticated
  using (public.is_shop_staff())
  with check (public.is_shop_staff());

drop policy if exists "admin manages marketing assets" on public.marketing_assets;
create policy "staff manage marketing assets"
  on public.marketing_assets for all
  to authenticated
  using (public.is_shop_staff())
  with check (public.is_shop_staff());

-- Card art uploads.
drop policy if exists "admin manage dex art" on storage.objects;
create policy "staff manage dex art"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'dex-art' and public.is_shop_staff())
  with check (bucket_id = 'dex-art' and public.is_shop_staff());


-- ============================================================
-- 5. WHAT IS DELIBERATELY LEFT ALONE
--
--    user_cards, wishlist_cards, user_sealed, user_collector_goals,
--    profiles, profile_videos — all already scoped to auth.uid() = the
--    owner, which is correct and has always been correct.
--
--    push_subscriptions stays open to insert and update. An endpoint URL
--    is a secret token in its own right and holds nothing personal; this
--    is documented in schema.sql and is not the same mistake.
--
--    Every "public read" policy stays exactly as it is. Locking down
--    reading would break the app for everybody who is not signed in.
-- ============================================================


-- ============================================================
-- 6. CHECK
--    Every row should say 'staff only'. Anything still saying 'ANYONE
--    SIGNED IN' did not get replaced — read the policy name in that row
--    and look for a second, older policy on the same table.
-- ============================================================
select
  tablename,
  policyname,
  cmd,
  case
    when qual like '%is_shop_staff%' or with_check like '%is_shop_staff%'
      then 'staff only'
    else '⚠ ANYONE SIGNED IN'
  end as who_can_write
from pg_policies
where schemaname = 'public'
  and cmd <> 'SELECT'
  and 'authenticated' = any(roles)
  and tablename in (
    'banner','store_info','collector_goal_templates','infinite_dex_cards',
    'dex_reward_tiers','dex_reward_redemptions','marketing_prompts','marketing_assets'
  )
order by who_can_write desc, tablename;
