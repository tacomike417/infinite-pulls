-- ============================================================
-- THE GRAIL CARD IS RETIRED -- 25 Sep 2026 (Mike)
--
-- The grail no longer shows on the new profile, so it goes everywhere:
-- the My Account setting, the old collector page, the price-alert push,
-- and the stored picks. Nothing else depended on it except one reward:
--
--   Infinite Rewards #11, The Namer, was "GRAIL CARD NAMED". Without a
--   grail nobody could earn it -- and the secret 51st card needs all 50 --
--   so it is now "NAME ADDED": earned by filling in Name on Edit profile.
--   Everyone who already holds #11 keeps it.
--
-- The internal trigger key is still called grail_set; it now checks the
-- display name. This edits the LIVE reward_stats() in place (swapping that
-- one line), so it cannot drift from whatever version is running.
-- SAFE TO RUN TWICE.
-- ============================================================

do $$
declare
  d   text;
  old text := '(select grail_card_id  is not null from public.profiles where id = p_user)';
begin
  d := pg_get_functiondef('public.reward_stats(uuid)'::regprocedure);
  if position(old in d) = 0 then
    if position('display_name' in d) > 0 then
      raise notice 'reward_stats already checks the name -- nothing to do';
      return;
    end if;
    raise exception 'reward_stats does not have the grail line -- nothing was changed';
  end if;
  execute replace(d, old, '(select coalesce(btrim(display_name), '''') <> '''' from public.profiles where id = p_user)');
end $$;

update public.reward_cards
   set task_line = 'NAME ADDED',
       explainer = case when explainer ilike '%grail%' then null else explainer end
 where code = 'S26-11';

update public.profiles
   set grail_card_id = null, grail_note = null
 where grail_card_id is not null or grail_note is not null;

-- Check: The Namer now says NAME ADDED, and nobody has a grail left.
select code, name, task_line,
       (select count(*) from public.profiles where grail_card_id is not null) as grails_left
  from public.reward_cards where code = 'S26-11';
