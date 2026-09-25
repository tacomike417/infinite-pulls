-- ===========================================================================
-- SAY WHAT EACH CARD IS ACTUALLY COUNTING
--
-- "FIVE OF YOUR OWN PHOTOS" and "FIVE PHOTO POSTS" sit two tiles apart and
-- read like the same thing twice. They are not, and worse, ONE CONTAINS THE
-- OTHER:
--
--   own_photos   card_photos where kind = 'mine'
--                -> your own photograph, on a card in your collection
--   photo_posts  user_photos + card_photos where kind = 'mine'
--                -> ANY photo you put up, standalone OR on a card
--
-- So photographing one of your cards moves BOTH counters, which is exactly
-- the kind of thing nobody can work out from four words on a tile. It is
-- why 25 sits at 1/5 while 27 is already earned.
--
-- A TILE CANNOT CARRY THE EXPLANATION. Four words is all that fits under
-- the artwork, and stretching the task line to hold a definition would push
-- every tile in the grid onto three lines to fix two of them.
--
-- So the tile keeps the short line, and a new `explainer` column carries a
-- plain sentence shown when somebody TAPS the card -- the screen that
-- already has room and is already where you go when you want to know more.
--
-- A NEW COLUMN RATHER THAN `flavor`, which already exists here and is
-- unused. flavor means flavor -- "Your collection begins." -- in the old
-- Infinite Dex and in its admin panel. Filling it with a rules definition
-- would be a lie in the schema that somebody has to discover later.
--
-- Safe to run twice. Nothing is deleted.
-- ===========================================================================

alter table public.reward_cards
  add column if not exists explainer text;

comment on column public.reward_cards.explainer is
  'One plain sentence saying exactly what this card counts, shown on the card''s own screen. The task_line is the label; this is the rule.';


-- ---------------------------------------------------------------------------
-- THE PHOTO FAMILY -- the pair that started this
-- ---------------------------------------------------------------------------
update public.reward_cards set
  task_line = 'A PHOTO OF ONE OF YOUR CARDS',
  explainer = 'Take your own photograph of a card in your collection. The catalog picture does not count. This one is the card in your hand.'
 where trigger_key = 'own_photo_1';

update public.reward_cards set
  task_line = 'FIVE OF YOUR CARDS PHOTOGRAPHED',
  explainer = 'Your own photograph on five DIFFERENT cards in your collection. Standalone photos do not count toward this one. It is about the cards.'
 where trigger_key = 'own_photos_5';

update public.reward_cards set
  task_line = 'FIVE PHOTOS POSTED',
  explainer = 'Any five photos you have put up, added together: standalone photos AND your own card photos. Photographing one of your cards moves this card and the Portrait Set both.'
 where trigger_key = 'posts_5';

update public.reward_cards set
  task_line = 'FIFTEEN PHOTOS POSTED',
  explainer = 'Any fifteen photos you have put up, standalone photos and your own card photos counted together.'
 where trigger_key = 'posts_15';

update public.reward_cards set
  task_line = 'ONE HUNDRED PHOTOS POSTED',
  explainer = 'Any hundred photos you have put up, standalone photos and your own card photos counted together. This one takes a season.'
 where trigger_key = 'posts_100';


-- ---------------------------------------------------------------------------
-- THE COMMENT FAMILY -- the other pair that read as one counter
-- ---------------------------------------------------------------------------
update public.reward_cards set
  explainer = 'Every comment you have left anywhere in the app, including comments on your own posts.'
 where trigger_key in ('comment_1', 'comments_10', 'comments_25');

update public.reward_cards set
  explainer = 'Ten DIFFERENT collectors whose posts you have commented on. Commenting ten times on one person is one collector, and your own posts do not count at all.'
 where trigger_key = 'comment_people_10';

update public.reward_cards set
  explainer = 'Four separate weeks with at least one comment in each. There is no deadline. The weeks do not have to be in a row.'
 where trigger_key = 'comment_weeks_4';


-- ---------------------------------------------------------------------------
-- THE REST OF THE ONES THAT CANNOT BE GUESSED FROM A LABEL
-- ---------------------------------------------------------------------------
update public.reward_cards set
  explainer = 'HEAT on your posts and hearts on your comments, added together. Your own marks on your own things never count.'
 where trigger_key = 'hearts_received_10';

update public.reward_cards set
  explainer = 'HEAT and hearts you GAVE other people, added together. Either button counts.'
 where trigger_key in ('heart_given_1', 'hearts_given_10');

update public.reward_cards set
  explainer = 'Fifty different Pokemon across your whole collection. Six Charizards are one Pokemon.'
 where trigger_key = 'pokedex_50';

update public.reward_cards set
  explainer = 'Copies, not different cards. Ten of the same Pikachu is ten cards.'
 where trigger_key in ('card_1', 'cards_10', 'cards_25', 'cards_50', 'cards_100');

update public.reward_cards set
  explainer = 'A card that was already on your wish list and is now in your collection. Tidying the wish off after you buy it means this one never fires, so leave it there until it lands.'
 where trigger_key = 'wish_fulfilled';

update public.reward_cards set
  explainer = 'Open the installed app while signed in. Your browser knows; the database cannot see it on its own.'
 where trigger_key = 'app_installed';


-- ---------------------------------------------------------------------------
-- WHAT A CORRECT RESULT LOOKS LIKE
--
-- The two cards that started this, side by side. Read the two explainer
-- sentences -- if they do not make the difference obvious, tell me and I
-- will reword rather than leave it half clear.
-- ---------------------------------------------------------------------------

select card_number, name, task_line, explainer
  from public.reward_cards
 where trigger_key in ('own_photos_5', 'posts_5')
 order by card_number;

-- How many cards still have no explainer at all. These are the ones whose
-- label is genuinely self-explanatory -- "A GRADED CARD", "FIRST SCAN" --
-- and the count is here so the gap is a decision rather than an oversight.
select count(*) filter (where explainer is null) as no_explainer,
       count(*) filter (where explainer is not null) as explained,
       count(*) as total
  from public.reward_cards
 where enabled;
