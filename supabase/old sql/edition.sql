-- EDITIONS (27 Sep 2026): 1st Edition / Shadowless / Unlimited on a card.
-- Its own column, never the printing (`variant`), because variant is the
-- price key. Optional: blank means "not said".
alter table public.user_cards add column if not exists edition text;

alter table public.user_cards drop constraint if exists user_cards_edition_check;
alter table public.user_cards add constraint user_cards_edition_check
  check (edition is null or edition in ('1st Edition', 'Shadowless', 'Unlimited'));

select case when exists (
  select 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'user_cards' and column_name = 'edition'
) then 'edition column: ok' else 'edition column: MISSING' end as status;
