-- ===========================================================================
-- HOW CLOSE AM I TO THAT CARD
--
-- Jeff wants a progress bar on the reward cards. This is the number behind
-- it. Nothing new is stored and nothing new is written: reward_stats()
-- already returns every figure the triggers compare against, so progress is
-- the same comparison read as a fraction instead of a yes.
--
-- ONE QUERY FOR THE WHOLE SET, not one per card. dex_sweep() was built the
-- other way -- a query per unearned card on every route change -- and it is
-- already noted as something that will not survive 50 cards. This does the
-- whole board in a single pass so the bars cost one round trip.
--
-- THREE KINDS OF CARD, and only one of them gets a bar:
--
--   count   32 cards. 'cards_25' is card_qty >= 25, so 12/25 is real and a
--           bar means something.
--
--   yesno   16 cards. Set an avatar. Write a bio. Own one holo. There is no
--           halfway -- a bar on these would sit at 0% while the person is
--           one tap from done, which reads as further away than it is.
--           Returned with need = 1 and have = 0 or 1 so the UI can show a
--           tick rather than a bar. DO NOT draw these as bars.
--
--   blind    2 cards. app_installed and pokedex_50 are not visible from
--           the database at all. have is null -- not zero. Zero would be a
--           claim we cannot support, and the arrows already refuse to call
--           a card steady without a reading; same rule here.
--
-- Safe to run twice. Reads only -- no inserts, no updates, no deletes.
-- ===========================================================================

create or replace function public.reward_progress(p_user uuid default null)
returns table (
  card_id     uuid,
  code        text,
  card_number integer,
  name        text,
  task_line   text,
  trigger_key text,
  kind        text,      -- 'count' | 'yesno' | 'blind'
  have        numeric,   -- null when kind = 'blind'
  need        numeric,
  pct         integer,   -- 0..100, null when blind
  earned      boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with v_user as (
    select coalesce(p_user, auth.uid()) as id
  ),
  s as (
    select * from public.reward_stats((select id from v_user))
  ),
  mine as (
    select card_id from public.user_reward_cards
     where user_id = (select id from v_user)
  ),
  raw as (
    select
      c.id, c.code, c.card_number, c.name, c.task_line, c.trigger_key,
      case c.trigger_key
        when 'card_1'             then s.card_qty
        when 'cards_10'           then s.card_qty
        when 'cards_25'           then s.card_qty
        when 'cards_50'           then s.card_qty
        when 'cards_100'          then s.card_qty
        when 'sets_5'             then s.distinct_sets
        when 'sets_10'            then s.distinct_sets
        when 'wish_1'             then s.wish_count
        when 'wishes_5'           then s.wish_count
        when 'scan_1'             then s.scan_count
        when 'scans_10'           then s.scan_count
        when 'scans_25'           then s.scan_count
        when 'comment_1'          then s.comment_count
        when 'comments_10'        then s.comment_count
        when 'comments_25'        then s.comment_count
        when 'comment_people_10'  then s.comment_people
        when 'comment_weeks_4'    then s.comment_weeks
        when 'heart_given_1'      then s.hearts_given
        when 'hearts_given_10'    then s.hearts_given
        when 'hearts_received_10' then s.hearts_received
        when 'own_photo_1'        then s.own_photos
        when 'own_photos_5'       then s.own_photos
        when 'posts_5'            then s.photo_posts
        when 'posts_15'           then s.photo_posts
        when 'posts_100'          then s.photo_posts
        when 'card_weeks_4'       then s.card_weeks
        when 'card_weeks_8'       then s.card_weeks
        when 'card_months_3'      then s.card_months
        when 'member_30'          then s.member_days
        when 'member_90'          then s.member_days
        when 'value_100'          then s.coll_value
        when 'value_1000'         then s.coll_value
        else null
      end::numeric as have_count,
      case c.trigger_key
        when 'card_1' then 1 when 'cards_10' then 10 when 'cards_25' then 25
        when 'cards_50' then 50 when 'cards_100' then 100
        when 'sets_5' then 5 when 'sets_10' then 10
        when 'wish_1' then 1 when 'wishes_5' then 5
        when 'scan_1' then 1 when 'scans_10' then 10 when 'scans_25' then 25
        when 'comment_1' then 1 when 'comments_10' then 10 when 'comments_25' then 25
        when 'comment_people_10' then 10 when 'comment_weeks_4' then 4
        when 'heart_given_1' then 1 when 'hearts_given_10' then 10
        when 'hearts_received_10' then 10
        when 'own_photo_1' then 1 when 'own_photos_5' then 5
        when 'posts_5' then 5 when 'posts_15' then 15 when 'posts_100' then 100
        when 'card_weeks_4' then 4 when 'card_weeks_8' then 8
        when 'card_months_3' then 3
        when 'member_30' then 30 when 'member_90' then 90
        when 'value_100' then 100 when 'value_1000' then 1000
        else null
      end::numeric as need_count,
      -- the sixteen that are simply done or not
      case c.trigger_key
        when 'account_created'   then s.has_profile
        when 'graded_any'        then s.graded_any
        when 'graded_ten'        then s.graded_ten
        when 'reverse_holo'      then s.has_reverse
        when 'holo'              then s.has_holo
        when 'wish_fulfilled'    then s.wish_fulfilled
        when 'sealed_1'          then s.sealed_any
        when 'value_up_2'        then coalesce(s.value_up_2, false)
        when 'avatar_set'        then s.avatar_set
        when 'bio_set'           then s.bio_set
        when 'grail_set'         then s.grail_set
        when 'founder_badge'     then s.founder
        when 'collection_public' then s.public_profile
        when 'alerts_on'         then s.alerts_on
        when 'goal_picked'       then s.goal_picked
        when 'goal_done'         then s.goal_done
        else null
      end as yes_no,
      (m.card_id is not null) as is_mine
    from public.reward_cards c
    cross join s
    left join mine m on m.card_id = c.id
    where c.enabled and not c.secret
  )
  select
    r.id, r.code, r.card_number, r.name, r.task_line, r.trigger_key,
    case
      when r.need_count is not null then 'count'
      when r.yes_no is not null     then 'yesno'
      else 'blind'
    end as kind,
    case
      when r.need_count is not null then least(r.have_count, r.need_count)
      when r.yes_no is not null     then (case when r.yes_no then 1 else 0 end)::numeric
      else null
    end as have,
    coalesce(r.need_count, 1) as need,
    case
      when r.need_count is not null then
        least(100, greatest(0, floor(100 * r.have_count / nullif(r.need_count,0))))::int
      when r.yes_no is not null then (case when r.yes_no then 100 else 0 end)
      else null
    end as pct,
    r.is_mine
  from raw r
  order by r.card_number;
$$;

revoke all on function public.reward_progress(uuid) from public;
grant execute on function public.reward_progress(uuid) to authenticated;

comment on function public.reward_progress(uuid) is
  'One row per reward card with how close this person is. kind=count gets a '
  'real bar; kind=yesno is done-or-not and must NOT be drawn as a bar; '
  'kind=blind cannot be measured and returns have = null, never 0.';

-- ===========================================================================
-- WHAT IT LOOKS LIKE — run this after, it changes nothing
-- ===========================================================================
select kind, count(*) as cards
  from public.reward_progress()
 group by kind order by kind;

-- Your own board, closest-to-done first among the ones with a real bar.
select card_number, name, task_line, have, need, pct, earned
  from public.reward_progress()
 where kind = 'count' and not earned
 order by pct desc
 limit 12;
