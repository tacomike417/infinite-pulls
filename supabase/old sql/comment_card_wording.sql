-- ===========================================================================
-- THE TWO COMMENT CARDS COUNT TWO DIFFERENT THINGS, AND SAID SO NOWHERE
--
-- 34 The Conversationalist  "COMMENTED ON TEN PEOPLE"   -> comment_people
-- 36 The Voice              "TWENTY-FIVE COMMENTS"      -> comment_count
--
-- Read off reward_stats(), those are:
--
--   comment_count   count(*)                        every comment you left,
--                                                   including on your OWN posts
--   comment_people  count(distinct post_owner)      other people whose posts
--                   where post_owner <> you         you commented on
--   comment_weeks   count(distinct week)            separate weeks you
--                                                   commented in
--
-- So 15 comments across 6 collectors is not a discrepancy -- it is two
-- honest numbers answering two different questions. The labels were the
-- problem: "TEN COMMENTS" and "TWENTY-FIVE COMMENTS" and "COMMENTED ON TEN
-- PEOPLE" all read like the same counter at different sizes, and
-- "COMMENTED IN FOUR WEEKS" reads like a deadline rather than four separate
-- weeks.
--
-- PART 1 rewrites the four labels. PART 2 checks the numbers are right.
-- Safe to run twice. No DELETE anywhere.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- PART 1 -- say which counter each card is watching
-- ---------------------------------------------------------------------------
update public.reward_cards set task_line = 'TEN COMMENTS IN TOTAL'
 where trigger_key = 'comments_10';

update public.reward_cards set task_line = 'TWENTY-FIVE COMMENTS IN TOTAL'
 where trigger_key = 'comments_25';

-- "COLLECTORS" rather than "PEOPLE": it is the word that carries "a
-- different one each time" without needing the word "different", which
-- pushed this label onto a third line on a phone.
update public.reward_cards set task_line = 'COMMENTED ON TEN COLLECTORS'
 where trigger_key = 'comment_people_10';

-- "IN FOUR WEEKS" was read as a deadline. It is four separate weeks, and
-- there is no clock on it.
update public.reward_cards set task_line = 'COMMENTED IN FOUR SEPARATE WEEKS'
 where trigger_key = 'comment_weeks_4';

-- ---------------------------------------------------------------------------
-- PART 2 -- ARE THE NUMBERS RIGHT?
--
-- The first query is the one that matters. `owner_missing` is the number of
-- your comments that recorded no post owner at all -- those count toward
-- the 25 and are INVISIBLE to the 10, because count(distinct post_owner)
-- skips nulls. If that column is anything but 0, the 6 is genuinely too low
-- and it is a bug on our side, not a miscount on yours.
--
-- Paste both results back.
-- ---------------------------------------------------------------------------

select
  c.user_id,
  count(*)                                              as comments_total,
  count(*) filter (where c.post_owner = c.user_id)      as on_your_own_posts,
  count(*) filter (where c.post_owner is null)          as owner_missing,
  count(distinct c.post_owner)
    filter (where c.post_owner <> c.user_id)            as different_collectors,
  count(distinct date_trunc('week', c.created_at))      as separate_weeks,
  count(*) filter (where c.hidden_at is not null)       as hidden_and_not_counted,
  min(c.created_at)::date                               as first_comment,
  max(c.created_at)::date                               as latest_comment
from public.post_comments c
where c.hidden_at is null
group by c.user_id
order by comments_total desc
limit 10;

-- What KIND of post each comment landed on, for whoever comments most.
-- A 'c-' is a collection card, 'p-' a photo post, 'r-' a reward post.
-- A key that is none of those is a shelf row, which has no owner to credit
-- -- so it moves the total and never the collector count.
select
  left(c.post_key, 2)                                   as post_kind,
  count(*)                                              as comments,
  count(*) filter (where c.post_owner is null)          as owner_missing
from public.post_comments c
where c.hidden_at is null
  and c.user_id = (select user_id from public.post_comments
                    where hidden_at is null
                    group by user_id order by count(*) desc limit 1)
group by left(c.post_key, 2)
order by comments desc;
