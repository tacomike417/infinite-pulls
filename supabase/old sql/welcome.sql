-- Infinite Pulls — THE FIRST MINUTE
-- ============================================================================
--
-- Six people signed up and not one of them held a reward card, because
-- nothing on the feed ever told them there was anything to earn. The fifty
-- cards ARE the instructions -- 06/50 is "add a card", 02/50 is "leave a
-- comment" -- but only to somebody who knows they exist.
--
-- So the feed now shows one panel, once, on a member's first visit after
-- signing up. This is the single column that remembers they have seen it.
--
-- WHY A COLUMN AND NOT localStorage. localStorage is one browser. It would
-- show again on their laptop, again after they clear their history, and
-- again on a new phone -- and a welcome that keeps coming back stops being a
-- welcome. On the profile it follows the person.
--
-- WHY NULL MEANS "NOT YET". Every existing member gets null, so everybody
-- who is already here sees it once too. That is deliberate: they are exactly
-- the people who have been using the app without knowing about the cards.
-- If you would rather the existing members never saw it, the last statement
-- in this file does that -- it is commented out.
--
-- NO FUNCTION, NO POLICY, NO TRIGGER. profiles already carries "users can
-- update their own profile", so the feed stamps this itself. Nothing here
-- can be used to set anybody else's.
--
-- SAFE TO RUN TWICE.
-- ============================================================================

alter table public.profiles
  add column if not exists welcomed_at timestamptz;

comment on column public.profiles.welcomed_at is
  'When this member was shown the first-run welcome panel on the feed. '
  'NULL means they have not seen it and it is due on their next visit. '
  'Written by the browser through the profile''s own update policy.';

-- Optional: uncomment to skip the welcome for everybody who is already here,
-- so only accounts made from now on ever see it.
-- update public.profiles set welcomed_at = now() where welcomed_at is null;

-- CHECK: who is due one.
select count(*) filter (where welcomed_at is null) as due,
       count(*) filter (where welcomed_at is not null) as seen
  from public.profiles;
