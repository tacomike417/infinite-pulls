-- ===========================================================================
-- GOALS THAT FINISH THEMSELVES.
-- Run after infinite_rewards.sql. Safe to re-run.
--
-- THE GAP THIS CLOSES. user_collector_goals.completed_at has existed since
-- the goals were built, and exactly one thing ever writes to it: the browser,
-- when somebody taps + on a manual count goal. The five AUTO-TRACKED goals --
-- Gem Mint Ten, Grade Ladder, Monthly Momentum, Yearlong Collector, Value
-- Milestone -- are worked out live for display and never written down.
--
-- So a collector could finish Gem Mint Ten and the database would not know.
-- The badge landed in silence, and 41/50 The Oathkeeper ("a collector goal
-- completed") could never fire for any of them.
--
-- WHAT THIS DOES NOT DO. It never creates a goal. It only stamps completion
-- on goals somebody already picked, so nobody wakes up with goals they did
-- not choose and the goals screen is not touched at all.
--
-- It also never UN-stamps. The browser clears completed_at when a manual
-- count drops back under target; these five do not, on purpose -- a
-- collection that dips under $1,000 for a week should not take the badge
-- back, and 41/50 is not a card anybody should lose.
-- ===========================================================================

-- The number out of "PSA 10", "BGS 9.5", "CGC 10 pristine". Null for
-- "Near Mint" and anything else that is not a grade.
create or replace function public.card_grade(p_condition text)
returns numeric
language sql
immutable
as $$
  select nullif(substring(coalesce(p_condition,'') from '^\s*(?:PSA|BGS|CGC|psa|bgs|cgc)\s*([0-9]+(?:\.[0-9])?)'), '')::numeric;
$$;

create or replace function public.goal_sweep()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  g record;
  met boolean;
  target numeric;
  grade numeric;
  months integer;
  done integer := 0;
begin
  if v_user is null then return 0; end if;

  for g in
    select ug.id, t.goal_type, coalesce(ug.custom_config, t.config, '{}'::jsonb) as cfg
      from public.user_collector_goals ug
      join public.collector_goal_templates t on t.id = ug.template_id
     where ug.user_id = v_user
       and ug.completed_at is null
       and t.enabled
       and coalesce(t.auto_track, false)
  loop
    met := false;
    target := coalesce((g.cfg ->> 'target')::numeric, 0);

    case g.goal_type

      -- Ten DIFFERENT cards at a given grade. distinct card_id, so ten
      -- copies of one Charizard is one card, not ten.
      when 'graded_count' then
        grade := coalesce((g.cfg ->> 'grade')::numeric, 10);
        select count(distinct card_id) >= greatest(target, 1)
          into met
          from public.user_cards
         where user_id = v_user and public.card_grade(condition) = grade;

      -- The same card in every grade from 1 to 10.
      when 'grade_ladder' then
        select exists (
          select 1 from public.user_cards
           where user_id = v_user and public.card_grade(condition) between 1 and 10
           group by card_id
          having count(distinct floor(public.card_grade(condition))) >= 10
        ) into met;

      -- The busiest single calendar month. Copies, not rows.
      when 'added_in_month' then
        select coalesce(max(q), 0) >= greatest(target, 1) into met
          from (select sum(quantity) as q
                  from public.user_cards
                 where user_id = v_user
                 group by date_trunc('month', added_at)) m;

      -- N calendar months in a row with at least one card added. The gaps
      -- between consecutive months are what is counted, not the months.
      when 'monthly_streak' then
        months := coalesce((g.cfg ->> 'months')::int, 12);
        select exists (
          select 1 from (
            select m, m - (row_number() over (order by m)) * interval '1 month' as grp
              from (select distinct date_trunc('month', added_at) as m
                      from public.user_cards where user_id = v_user) d
          ) s
          group by grp
          having count(*) >= months
        ) into met;

      -- Priced HERE, from card_price_history -- not from the cached figure
      -- on the profile, which the browser writes.
      when 'value_total' then
        select coalesce(sum(u.quantity * pr.price), 0) >= greatest(target, 1)
          into met
          from public.user_cards u
          join lateral (
            select h.price from public.card_price_history h
             where h.card_id = u.card_id
             order by (h.variant = 'market') desc, h.recorded_on desc
             limit 1
          ) pr on true
         where u.user_id = v_user;

      else
        met := false;
    end case;

    if met then
      update public.user_collector_goals
         set completed_at = now()
       where id = g.id and completed_at is null;
      if found then done := done + 1; end if;
    end if;
  end loop;

  return done;
end;
$$;

revoke all on function public.card_grade(text) from public;
grant execute on function public.card_grade(text) to authenticated, anon;
grant execute on function public.goal_sweep() to authenticated;

select 'ok' as ready;
