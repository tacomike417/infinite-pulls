-- ===========================================================================
-- A REWARD CARD LANDING RINGS THE BELL.
-- Run after infinite_rewards.sql. Safe to re-run.
--
-- notify_on_dex_card already does this, but it watches user_dex_cards --
-- the OLD table. Nothing writes there any more, so cards were arriving in
-- silence. This is the same idea pointed at user_reward_cards.
--
-- The href is ./?rewards=1 rather than a page address, because the rewards
-- sheet has no address of its own: the feed opens it on arrival and takes
-- the parameter back out.
-- ===========================================================================

create or replace function public.notify_on_reward_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  card_name text;
  is_secret boolean;
begin
  select name, secret into card_name, is_secret
    from public.reward_cards where id = new.card_id;

  perform public.notify_system(
    new.user_id, 'dex',
    coalesce(card_name, 'a new card')
      || case when is_secret then ' — 10% off is yours' else '' end,
    './?rewards=1');

  return new;
end;
$$;

drop trigger if exists notify_on_reward_card on public.user_reward_cards;
create trigger notify_on_reward_card
  after insert on public.user_reward_cards
  for each row execute function public.notify_on_reward_card();

-- The old trigger is left alone. Nothing writes to user_dex_cards any more,
-- so it never fires; removing it is a job for whenever those tables go.

select tgname from pg_trigger
 where tgrelid = 'public.user_reward_cards'::regclass and not tgisinternal;
