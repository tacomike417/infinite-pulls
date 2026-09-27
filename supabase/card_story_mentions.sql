-- TAG PEOPLE IN A CARD'S STORY (27 Sep 2026)
-- An @name written in the story on a card (user_cards.note) tells that
-- person, the same way a caption or a comment does. Only when the story
-- is new or changed, and only for a public profile -- a private shelf's
-- card is a link nobody else can open.
create or replace function public.notify_mentions_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.note is not null and position('@' in new.note) > 0
     and (tg_op = 'INSERT' or coalesce(new.note, '') is distinct from coalesce(old.note, ''))
     and exists (select 1 from public.profiles p where p.id = new.user_id and p.is_public is not false)
  then
    perform public.notify_mentions(new.note, new.user_id, 'c-' || new.id::text, null);
  end if;
  return new;
end;
$$;

drop trigger if exists notify_mentions_card on public.user_cards;
create trigger notify_mentions_card
  after insert or update of note on public.user_cards
  for each row execute function public.notify_mentions_card();

select case when exists (select 1 from pg_trigger where tgname = 'notify_mentions_card')
            then 'card story tags: ok' else 'card story tags: MISSING' end as status;
