-- ============================================================
-- INFINITE DEX — the cards that arrive on their own.
--
-- Run this once in the Supabase SQL Editor, after infinite_dex.sql.
-- Safe to re-run.
--
-- Nine of the twelve season cards are earned by doing something the
-- database can already see: adding a first card, hitting ten, turning
-- alerts on. This is the one call that checks all of them at once and
-- hands over whatever is owed.
--
-- WHY ONE CALL AND NOT NINE
--
-- The app could ask award_dex_card() about each card in turn, but that is
-- nine round trips from a phone on shop wifi every time somebody opens a
-- page. This does the same work in one, and returns only what actually
-- changed — so the usual answer is an empty array and the usual cost is
-- one cheap query.
--
-- WHAT IT DELIBERATELY WILL NOT DO
--
-- Three triggers are invisible from here: app_installed,
-- first_card_scanned and pokedex_50 (see the note in infinite_dex.sql).
-- dex_trigger_met returns NULL for those, and a sweep NEVER hands out a
-- card on a NULL. Only the app can assert those, one at a time, through
-- award_dex_card() — which keeps "the database decided" and "the browser
-- said so" as two visibly different code paths.
-- ============================================================

create or replace function public.dex_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_card public.infinite_dex_cards%rowtype;
  v_met  boolean;
  v_out  jsonb := '[]'::jsonb;
begin
  if v_user is null then
    return v_out;
  end if;

  for v_card in
    select c.*
      from public.infinite_dex_cards c
     where c.enabled
       and c.award_type = 'auto'
       and (c.active_from  is null or now() >= c.active_from)
       and (c.active_until is null or now() <= c.active_until)
       and not exists (
             select 1 from public.user_dex_cards u
              where u.user_id = v_user and u.card_id = c.id)
     order by c.series, c.number nulls last, c.display_order
  loop
    v_met := public.dex_trigger_met(v_user, v_card.trigger_key);

    -- true only. NULL is "not visible from here" and false is "not yet";
    -- neither earns a card.
    if v_met is true then
      insert into public.user_dex_cards (user_id, card_id)
      values (v_user, v_card.id)
      on conflict (user_id, card_id) do nothing;

      if found then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'card_id',   v_card.id,
          'code',      v_card.code,
          'name',      v_card.name,
          'task_line', v_card.task_line,
          'flavor',    v_card.flavor,
          'rarity',    v_card.rarity,
          'art_url',   v_card.art_url,
          'thumb_url', v_card.thumb_url
        ));
      end if;
    end if;
  end loop;

  return v_out;
end;
$$;

grant execute on function public.dex_sweep() to authenticated;
revoke all on function public.dex_sweep() from anon;
