-- Infinite Pulls — notifications the APP sends, not another person
-- ============================================================================
--
-- Everything in notifications.sql was one person doing something to another:
-- a comment, a heart, a follow. These are different -- nobody did them. You
-- earned a card, you finished a goal. There is no actor.
--
-- WHICH IS WHY actor_id BECOMES NULLABLE. It was `not null` with a
-- constraint saying you are never told about your own doing, and both of
-- those refuse a notification that has no actor at all. A system row now
-- carries a null actor and the constraint tolerates it; a person-to-person
-- row is unchanged and still cannot be about you.
--
-- AND WHY TWO COLUMNS ARE ADDED. A comment notification can look up what it
-- points at. "You earned THE COLLECTION KEEPER" cannot -- the card could be
-- renamed, or the row removed, and either way the notification should still
-- read as the sentence it was when it was sent. So the words are written
-- down at the moment it happens, with the address to go to.
--
-- Run notifications.sql FIRST. SAFE TO RUN TWICE.

do $$
begin
  if to_regclass('public.notifications') is null then
    raise exception 'Run notifications.sql first — this extends that table.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- THE SHAPE
-- ---------------------------------------------------------------------------
alter table public.notifications alter column actor_id drop not null;

alter table public.notifications add column if not exists detail text;
alter table public.notifications add column if not exists href   text;

comment on column public.notifications.detail is
  'What to say, written down when it happened -- a card name, a goal name. '
  'Deliberately a copy: renaming a card later must not rewrite history.';
comment on column public.notifications.href is
  'Where tapping it goes, for the kinds that are not about a post.';

-- Nobody is told about their own doing -- but a row with no actor is the app
-- speaking, and that is allowed.
alter table public.notifications drop constraint if exists notifications_not_self;
alter table public.notifications
  add constraint notifications_not_self
  check (actor_id is null or user_id <> actor_id);

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('comment','reply','heart','follow','heat','dex','goal','wishlist'));

-- ---------------------------------------------------------------------------
-- THE SYSTEM'S OWN notify_once
-- ---------------------------------------------------------------------------
-- Same one-a-day guard as the person-to-person one, keyed on the words
-- rather than on an actor: earning the same card twice cannot happen, but a
-- goal that dips under 100% and back over CAN, and being congratulated
-- twice in an afternoon for the same goal reads as a bug.
create or replace function public.notify_system(
  p_user uuid, p_kind text, p_detail text, p_href text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then return; end if;

  if exists (
    select 1 from public.notifications
     where user_id = p_user
       and kind = p_kind
       and coalesce(detail,'') = coalesce(p_detail,'')
       and created_at > now() - interval '1 day'
  ) then
    return;
  end if;

  insert into public.notifications (user_id, actor_id, kind, detail, href)
  values (p_user, null, p_kind, p_detail, p_href);
end;
$$;

revoke all on function public.notify_system(uuid, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- YOU EARNED AN INFINITE REWARDS CARD
-- ---------------------------------------------------------------------------
-- user_dex_cards already stamps earned_at and is unique per person per card,
-- so one insert IS the moment, exactly once, with nothing to de-duplicate.
create or replace function public.notify_on_dex_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  card_name text;
begin
  select name into card_name from public.infinite_dex_cards where id = new.card_id;
  perform public.notify_system(new.user_id, 'dex',
    coalesce(card_name, 'a new card'), '../?page=dex');
  return new;
end;
$$;

drop trigger if exists notify_on_dex_card on public.user_dex_cards;
create trigger notify_on_dex_card
  after insert on public.user_dex_cards
  for each row execute function public.notify_on_dex_card();

-- ---------------------------------------------------------------------------
-- YOU FINISHED A GOAL
-- ---------------------------------------------------------------------------
-- completed_at is set the first time progress reaches 100% and CLEARED again
-- if a card leaves the collection, so this fires on the transition INTO
-- finished and never on the way back out. A genuine re-completion months
-- later is worth saying again; one this afternoon is not, and notify_system
-- holds that line.
create or replace function public.notify_on_goal_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  goal_name text;
begin
  if new.completed_at is null or old.completed_at is not null then
    return new;
  end if;

  -- A picked goal has a template; a custom one carries its own name.
  select t.name into goal_name
    from public.collector_goal_templates t
   where t.id = new.template_id;

  if goal_name is null then
    goal_name := nullif(btrim(coalesce(new.custom_config->>'name', '')), '');
  end if;

  perform public.notify_system(new.user_id, 'goal',
    coalesce(goal_name, 'a goal'), '../?page=goals');
  return new;
end;
$$;

drop trigger if exists notify_on_goal_done on public.user_collector_goals;
create trigger notify_on_goal_done
  after update of completed_at on public.user_collector_goals
  for each row execute function public.notify_on_goal_done();
