-- ============================================================
-- LOOPS: TAG THE CARD -- 28 Sep 2026 (Mike).
--
-- A Loop can say which card it is about ("this is the Charizard I
-- pulled"). The card comes from the poster's OWN collection, so the name,
-- set and picture are copied from their user_cards row by the database --
-- the app only says which row, and cannot make up a card name.
--
-- Then the Loop shows on that card's page in the feed (Everyone with
-- Charizard) and on its #tag page, and wears a card chip in the player.
--
-- SAFE TO RUN TWICE. Run it BEFORE pushing the app update.
-- ============================================================

alter table public.user_loops
  add column if not exists user_card_id uuid references public.user_cards(id) on delete set null;
alter table public.user_loops add column if not exists card_name  text;
alter table public.user_loops add column if not exists card_set   text;
alter table public.user_loops add column if not exists card_image text;

create index if not exists user_loops_card_idx
  on public.user_loops (lower(card_name)) where card_name is not null;

-- The guard, now knowing about the card. Everything it did before is kept:
-- owners change caption, sound, pin -- and now the card -- nothing else,
-- and no more than 3 pinned.
create or replace function public.user_loops_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uc record;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if new.user_id is distinct from old.user_id
       or new.video_guid is distinct from old.video_guid
       or new.status is distinct from old.status
       or new.created_at is distinct from old.created_at
       or new.expires_at is distinct from old.expires_at
       or new.length_s is distinct from old.length_s
       or new.width is distinct from old.width
       or new.height is distinct from old.height
       or new.resolutions is distinct from old.resolutions then
      raise exception 'Only the caption, sound, pin and card can be changed.' using errcode = '42501';
    end if;
  end if;

  -- THE CARD. Only one of your own, and its details come from your
  -- collection, never from the app.
  if new.user_card_id is distinct from old.user_card_id
     or new.card_name is distinct from old.card_name
     or new.card_set is distinct from old.card_set
     or new.card_image is distinct from old.card_image then
    if new.user_card_id is null then
      new.card_name := null; new.card_set := null; new.card_image := null;
    else
      select card_name, set_name, image_url into uc
        from public.user_cards
       where id = new.user_card_id and user_id = new.user_id;
      if not found then
        raise exception 'You can only tag a card from your own collection.' using errcode = '42501';
      end if;
      if coalesce(uc.image_url, '') = '' then
        raise exception 'Only cards with a picture can be tagged.' using errcode = '23514';
      end if;
      new.card_name := uc.card_name; new.card_set := uc.set_name; new.card_image := uc.image_url;
    end if;
  end if;

  if new.pinned and not old.pinned
     and (select count(*) from public.user_loops l
           where l.user_id = new.user_id and l.pinned and l.id <> new.id) >= 3 then
    raise exception 'You can keep 3 Loops pinned. Unpin one first.' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- A correct result: one row, 'loops card tag: ok'.
select case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'user_loops' and column_name = 'card_name')
             and (select position('user_cards' in prosrc) > 0 from pg_proc where proname = 'user_loops_guard' limit 1)
            then 'loops card tag: ok' else 'loops card tag: MISSING' end as status;
