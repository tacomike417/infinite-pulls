-- ============================================================
-- AUTOMATIC BADGES
--
--     Some goals have nothing to choose. Gem Mint Ten, Grade
--     Ladder, Monthly Momentum, Yearlong Collector and Value
--     Milestone carry no setting -- there is no set to pick, no
--     region, no Pokemon. Every collector is already working on
--     all five whether they have heard of them or not, so asking
--     somebody to press "+ Add This Goal" first is asking them to
--     opt in to a fact that is already true. Nobody opts in to an
--     achievement.
--
--     Goals that DO carry a setting stay picked, because the app
--     cannot guess which set or which region somebody means.
--
--     auto_track is what separates the two, and it is data rather
--     than a list in the JavaScript -- so a goal can change sides
--     later without a deploy.
--
--     Safe to re-run.
-- ============================================================


-- ============================================================
-- 1. THE FLAG
-- ============================================================
alter table public.collector_goal_templates
  add column if not exists auto_track boolean not null default false;


-- ============================================================
-- 2. THE FIVE THAT EARN THEMSELVES
--    Matched by goal_type rather than by name, so any future goal
--    of the same shape is automatic the day it is added.
-- ============================================================
update public.collector_goal_templates
   set auto_track = true
 where goal_type in ('graded_count', 'grade_ladder', 'added_in_month',
                     'monthly_streak', 'value_total');


-- ============================================================
-- 3. EVERYTHING ELSE STAYS PICKED
--    Explicit rather than assumed, so re-running this file after
--    a goal changes type puts it back on the right side.
-- ============================================================
update public.collector_goal_templates
   set auto_track = false
 where goal_type not in ('graded_count', 'grade_ladder', 'added_in_month',
                         'monthly_streak', 'value_total');


-- ============================================================
-- 4. CHECK — five true, the rest false.
-- ============================================================
select auto_track, count(*) as goals,
       string_agg(name, ', ' order by display_order) as which
  from public.collector_goal_templates
 where enabled
 group by auto_track
 order by auto_track desc;
