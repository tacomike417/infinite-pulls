-- The three 2026 prize tiers. Run once, in the Supabase SQL Editor.
--
-- The panel hides "+ New Reward" from Jeff on purpose, so the rows have to
-- exist before he has anywhere to type. After this runs he sees three prizes
-- and can only edit what each one IS -- not how many cards it takes, and not
-- how many prizes there are.
--
-- Safe to run more than once: cards_required is unique, so a second run
-- updates the wording rather than making duplicates.

insert into public.dex_reward_tiers (cards_required, reward, description, enabled, display_order)
values
  (6,  'Prize to be decided', null, true, 1),
  (8,  'Prize to be decided', null, true, 2),
  (10, 'Prize to be decided', null, true, 3)
on conflict (cards_required) do update
  set reward        = excluded.reward,
      display_order = excluded.display_order,
      enabled       = true;

-- What you should see: three rows, 6 / 8 / 10.
select cards_required, reward, enabled, display_order
  from public.dex_reward_tiers
 order by cards_required;
