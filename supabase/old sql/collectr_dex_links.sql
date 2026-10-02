-- ============================================================
-- COLLECTR + DEX ON PROFILES -- 27 Sep 2026 (Mike).
--
-- Two more profile buttons beside Instagram / TikTok / Whatnot:
--   collectr  the share link Collectr gives you (portfolio sharing),
--             only accepted on Collectr's own web addresses
--   dex       your Dex username; the app builds app.dextcg.com/users/<name>
-- Same idea as the other socials: nobody can put an arbitrary link on a
-- profile that looks like one of these buttons.
--
-- SAFE TO RUN TWICE.
-- ============================================================

alter table public.profiles add column if not exists collectr text;
alter table public.profiles add column if not exists dex      text;

alter table public.profiles drop constraint if exists profiles_collectr_link;
alter table public.profiles add constraint profiles_collectr_link
  check (collectr is null or collectr ~* '^https://(([a-z0-9-]+\.)*getcollectr\.com|[a-z0-9-]*collectr[a-z0-9-]*\.(app\.link|page\.link))/[^[:space:]<>"'']{1,200}$');

alter table public.profiles drop constraint if exists profiles_dex_handle;
alter table public.profiles add constraint profiles_dex_handle
  check (dex is null or dex ~ '^[A-Za-z0-9._-]{2,30}$');

-- A correct result: two rows, collectr and dex.
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles' and column_name in ('collectr', 'dex')
 order by column_name;
