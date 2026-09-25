-- ============================================================
-- PROFILE, INSTAGRAM-STYLE -- 25 Sep 2026 (SOCIAL-NEXT part 5)
--
-- Four new, optional fields for the new profile header:
--   display_name  the line above the numbers ("Mike N.")
--   instagram, tiktok, whatnot   the three social buttons
--
-- HANDLES, NOT LINKS. Each social field holds only the handle
-- (tacomike417), never a web address. The app builds the link itself
-- (instagram.com/<handle>), so nobody can put an arbitrary link on a
-- profile that looks like an Instagram button. The checks below refuse
-- anything that is not a plain handle.
--
-- Blank is the normal case: a field left empty simply does not show.
-- SAFE TO RUN TWICE.
-- ============================================================

alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists instagram    text;
alter table public.profiles add column if not exists tiktok       text;
alter table public.profiles add column if not exists whatnot      text;

alter table public.profiles drop constraint if exists profiles_display_name_len;
alter table public.profiles add constraint profiles_display_name_len
  check (display_name is null or char_length(btrim(display_name)) between 1 and 40);

alter table public.profiles drop constraint if exists profiles_instagram_handle;
alter table public.profiles add constraint profiles_instagram_handle
  check (instagram is null or instagram ~ '^[A-Za-z0-9._]{1,30}$');

alter table public.profiles drop constraint if exists profiles_tiktok_handle;
alter table public.profiles add constraint profiles_tiktok_handle
  check (tiktok is null or tiktok ~ '^[A-Za-z0-9._]{2,24}$');

alter table public.profiles drop constraint if exists profiles_whatnot_handle;
alter table public.profiles add constraint profiles_whatnot_handle
  check (whatnot is null or whatnot ~ '^[A-Za-z0-9._-]{1,30}$');

-- Proof it took: four rows, one per new column.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles'
   and column_name in ('display_name','instagram','tiktok','whatnot')
 order by column_name;
