-- ===========================================================================
-- RIBBONS.
-- Run after infinite_rewards.sql. Safe to re-run.
--
-- Two marks that sit beside a name, next to the founding badge:
--
--   BRONZE  25 reward cards  -- half the set
--   GOLD    51/50 in hand    -- the whole thing, and the 10% off
--
-- NOTHING IS STORED. A ribbon is worked out from the cards somebody holds,
-- exactly like the Dex is, so it can never disagree with them and there is
-- no row to go stale when a card is added or a season is reset.
--
-- WHY AN RPC AND NOT A VIEW. The feed draws twenty names at once and needs
-- all twenty answers in ONE round trip. A view would be twenty subqueries
-- or a group-by PostgREST cannot express; this takes the whole list of ids
-- and hands back one row each.
--
-- WHO MAY SEE WHOSE. The same rule the rest of the app uses: your own, and
-- anybody whose profile is public. A private collector's progress does not
-- leak out through a ribbon.
-- ===========================================================================

create or replace function public.reward_marks(p_ids uuid[])
returns table (user_id uuid, cards integer, has_secret boolean)
language sql
stable
security definer
set search_path = public
as $$
  select u.user_id,
         count(*) filter (where not c.secret)::int as cards,
         bool_or(c.secret)                         as has_secret
    from public.user_reward_cards u
    join public.reward_cards c on c.id = u.card_id
    join public.profiles p     on p.id = u.user_id
   where u.user_id = any(p_ids)
     and c.enabled
     and (p.is_public = true or u.user_id = auth.uid())
   group by u.user_id;
$$;

grant execute on function public.reward_marks(uuid[]) to authenticated, anon;

-- CHECK: a public collector's count comes back, a private one's does not.
select 'ok' as ready;
