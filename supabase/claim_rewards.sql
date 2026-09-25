-- ============================================================
-- CLAIM YOUR REWARDS -- 25 Sep 2026 (SOCIAL-NEXT part 9)
--
-- Mike's call: new reward cards (and the ribbons they add up to) WAIT to
-- be claimed. They are still earned the moment somebody does the thing --
-- reward_sweep() inserts the row exactly as before -- but until the person
-- taps CLAIM NOW on their own profile, the card is not shown anywhere and
-- does not count toward a ribbon.
--
--   claimed_at  null  = earned, waiting
--               a time = claimed, on show
--
-- Every card anybody already had is marked claimed (on the day it was
-- earned), so nobody loses anything when this runs.
-- SAFE TO RUN TWICE: the backfill only happens the first time, when the
-- column is created.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'user_reward_cards' and column_name = 'claimed_at'
  ) then
    alter table public.user_reward_cards add column claimed_at timestamptz;
    update public.user_reward_cards set claimed_at = earned_at;
  end if;
end $$;

-- CLAIM: everything waiting for the signed-in person, handed back in the
-- same shape reward_sweep() uses, so the app's celebration can draw it.
create or replace function public.claim_reward_cards()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_out  jsonb := '[]'::jsonb;
begin
  if v_user is null then return v_out; end if;
  with got as (
    update public.user_reward_cards
       set claimed_at = now()
     where user_id = v_user and claimed_at is null
    returning card_id
  )
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
         ) order by c.card_number), '[]'::jsonb)
    into v_out
    from got
    join public.reward_cards  c on c.id = got.card_id
    join public.dex_creatures d on d.id = c.creature_id;
  return v_out;
end;
$$;

revoke all on function public.claim_reward_cards() from public;
grant execute on function public.claim_reward_cards() to authenticated;

-- RIBBONS COUNT ONLY WHAT HAS BEEN CLAIMED. Same function as
-- reward_ribbons.sql, one line added.
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
     and u.claimed_at is not null
     and (p.is_public = true or u.user_id = auth.uid())
   group by u.user_id;
$$;

grant execute on function public.reward_marks(uuid[]) to authenticated, anon;

-- Check: every existing card is claimed, none waiting yet.
select count(*) as cards_total,
       count(*) filter (where claimed_at is null) as waiting
  from public.user_reward_cards;
