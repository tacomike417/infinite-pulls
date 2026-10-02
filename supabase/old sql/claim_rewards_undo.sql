-- ============================================================
-- UNDO "rewards wait to be claimed" -- 25 Sep 2026
--
-- Mike: the CLAIM NOW pill is for the little badge by people's names,
-- not the Infinite Rewards cards. Cards go back to arriving on their own
-- with the celebration. So: every card counts as claimed, and every card
-- earned from now on is claimed the moment it lands (default now()).
-- claim_reward_cards() stays in the database, unused and harmless.
-- SAFE TO RUN TWICE.
-- ============================================================
update public.user_reward_cards set claimed_at = earned_at where claimed_at is null;
alter table public.user_reward_cards alter column claimed_at set default now();

select count(*) as cards_total,
       count(*) filter (where claimed_at is null) as waiting
  from public.user_reward_cards;
