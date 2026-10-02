-- ===========================================================================
-- INFINITE REWARDS — S26-12 "The Portal Opens" (APP INSTALLED)
--
-- THE BUG THIS FIXES. Jeff uses the installed app every day and never got
-- this card. Nobody has. It was never earnable by any code path that
-- existed:
--
--   * reward_sweep() skips 'app_installed' on purpose -- the database
--     genuinely cannot see it -- and leaves it to the app to assert.
--   * award_reward_card() was written to take that assertion... and nothing
--     in the front end has ever called it. Zero callers in the whole repo.
--   * The one piece of install detection that does exist lives in
--     components/infinite-dex.js, which is the RETIRED system. It awards
--     through award_dex_card() into user_dex_cards -- a table Infinite
--     Rewards does not read -- and it only loads on the root page, not on
--     /feed-next/ where Rewards actually lives.
--
-- So three separate reasons, and the card sat there looking like a bug in
-- somebody's account instead of a gap in ours.
--
-- WHAT THIS ADDS. One function the browser can call with no arguments. The
-- browser is the only thing that knows it is running as an installed app,
-- so this is taken on the app's word -- deliberately, and deliberately in
-- its own function rather than folded into the sweep, so "the database
-- decided" and "the app told us" never blur together.
--
-- It cannot be abused into anything interesting: it awards exactly the one
-- card whose trigger_key is 'app_installed', to the caller and nobody else,
-- once. The worst a determined person can do is award themselves a card
-- they could have earned by tapping Install.
--
-- SAFE TO RUN TWICE. create or replace, one signature, no DELETE anywhere.
-- ===========================================================================

-- Belt and braces on the lesson from reward_progress(): a function with a
-- DIFFERENT argument list does not replace, it OVERLOADS, and then every
-- call fails with 42725 "function is not unique". This name is new as of
-- today, but drop the exact signature first so a re-run can never stack.
drop function if exists public.reward_assert_installed();

create or replace function public.reward_assert_installed()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_out  jsonb := '[]'::jsonb;
begin
  -- Signed out there is nobody to give it to. Not an error; the app calls
  -- this hopefully, on page load, and a quiet empty array is the answer.
  if v_user is null then
    return v_out;
  end if;

  with won as (
    insert into public.user_reward_cards (user_id, card_id)
    select v_user, c.id
      from public.reward_cards c
     where c.enabled
       and c.trigger_key = 'app_installed'
       and not exists (
             select 1 from public.user_reward_cards u
              where u.user_id = v_user and u.card_id = c.id)
    on conflict (user_id, card_id) do nothing
    returning card_id
  )
  -- Same shape reward_sweep() returns, key for key, so the reveal panel in
  -- feed.js draws this card with the code it already has and nothing
  -- downstream needs a special case for it.
  select coalesce(jsonb_agg(jsonb_build_object(
           'card_id',   c.id,
           'code',      c.code,
           'number',    c.card_number,
           'name',      c.name,
           'task_line', c.task_line,
           'creature',  d.name,
           'dex',       d.dex_number,
           'form',      c.form_name,
           'rarity',    c.rarity,
           'art_url',   c.art_url,
           'thumb_url', c.thumb_url
         )), '[]'::jsonb)
    into v_out
    from won
    join public.reward_cards  c on c.id = won.card_id
    join public.dex_creatures d on d.id = c.creature_id;

  return v_out;
end;
$$;

grant execute on function public.reward_assert_installed() to authenticated;

-- ---------------------------------------------------------------------------
-- WHAT A CORRECT RESULT LOOKS LIKE
--
-- Run the two lines below after the function is created.
--
-- The first names the card this will hand out. You want exactly ONE row:
--   S26-12 | 12 | The Portal Opens | APP INSTALLED
-- If it comes back empty, the card is disabled or its trigger_key was
-- renamed, and nothing will ever be awarded.
--
-- The second is the collision check that caught us last time. You want
-- exactly ONE row for reward_assert_installed. Two means an overload stacked
-- and every call will fail with 42725.
-- ---------------------------------------------------------------------------

select code, card_number, name, task_line, enabled
  from public.reward_cards
 where trigger_key = 'app_installed';

select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('reward_assert_installed', 'award_reward_card')
 order by p.proname;
