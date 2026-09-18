-- ============================================================
-- HYDE-BOT POSTED INTO THE VOID — find out why, and fix it.
--
-- WHAT WENT WRONG
--
-- A photo post is only readable by other people when its owner has a
-- PUBLIC PROFILE. That is the rule the whole site runs on, and it is the
-- policy on user_photos:
--
--   "public reads photos of public profiles"
--     using (exists (select 1 from profiles p
--                     where p.id = user_photos.user_id and p.is_public))
--
-- The account Hyde-Bot is signed in as has no row in public.profiles (or
-- has one with is_public = false). So the insert worked, the picture
-- uploaded, Facebook took it -- and the row is invisible to everybody
-- except the account that wrote it. It is not on the roster either, so it
-- never reaches the feed, and the permalink says the post is gone.
--
-- Likely cause of the missing row: handle_new_user() names a new profile
-- after the email, and 'infinitepulls' is on the reserved-username list in
-- usernames.sql, so that name cannot be held by a profile.
--
-- SAFE TO RUN TWICE.
-- ============================================================

-- ------------------------------------------------------------
-- 1. LOOK FIRST. Which accounts have posted photos, and which of them
--    can actually be seen?
-- ------------------------------------------------------------
select u.id,
       u.email,
       p.username,
       p.is_public,
       count(ph.id) as photo_posts,
       case
         when p.id is null      then 'NO PROFILE — every post is invisible'
         when not p.is_public   then 'PRIVATE — every post is invisible'
         else                        'ok'
       end as verdict
  from auth.users u
  left join public.profiles    p  on p.id  = u.id
  left join public.user_photos ph on ph.user_id = u.id
 group by u.id, u.email, p.id, p.username, p.is_public
 having count(ph.id) > 0
 order by photo_posts desc;

-- Where the post from the Facebook link actually lives:
select ph.id, ph.user_id, u.email, ph.caption, ph.added_at,
       (p.id is not null and p.is_public) as visible_to_everybody
  from public.user_photos ph
  join auth.users u on u.id = ph.user_id
  left join public.profiles p on p.id = ph.user_id
 where ph.id = '4cb9c27d-06a4-4514-8088-4b5de00163a2';


-- ------------------------------------------------------------
-- 2. FIX IT. Give the posting account a public profile.
--
--    EDIT THE TWO LINES IN THE `pick` BLOCK and run the rest as is.
--    The handle must be 3-24 letters/numbers/_/- and must not be on the
--    reserved list -- 'infinitepulls', 'infinite', 'official', 'jeff',
--    'staff', 'shop' and friends are all taken by the site itself.
-- ------------------------------------------------------------
do $$
declare
  pick_email    text := 'CHANGE-ME@example.com';   -- the account Hyde-Bot signs in as
  pick_username text := 'CHANGE-ME';               -- the handle its posts appear under
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(pick_email);
  if uid is null then
    raise exception 'No account with email %', pick_email;
  end if;
  if public.is_reserved_username(pick_username) then
    raise exception '% is on the reserved list — pick another handle.', pick_username;
  end if;

  insert into public.profiles (id, username, is_public)
  values (uid, pick_username, true)
  on conflict (id) do update
    set username  = excluded.username,
        is_public = true;

  raise notice 'Profile ready: % is now %, public.', pick_email, pick_username;
end $$;


-- ------------------------------------------------------------
-- 3. CHECK. Both of these should come back with rows now.
-- ------------------------------------------------------------
select id, username, is_public from public.profiles
 where id = (select user_id from public.user_photos
              where id = '4cb9c27d-06a4-4514-8088-4b5de00163a2');

select count(*) as posts_now_visible
  from public.user_photos ph
  join public.profiles p on p.id = ph.user_id and p.is_public;
