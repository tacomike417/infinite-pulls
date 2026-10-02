-- ============================================================
-- NEW THIS WEEK -- 27 Sep 2026 (Jeff's rail, Mike's rules).
--
-- People who joined in the last 7 days, newest first, for the row above
-- the videos. Somebody only shows once they have:
--   * a profile picture (Mike: no rows of grey faces), and
--   * at least one post or card, so tapping them never lands on an empty
--     page.
-- Public profiles only. House accounts and the shop are left out -- they
-- are not new people.
--
-- SAFE TO RUN TWICE.
-- ============================================================

create or replace function public.new_members(p_days int default 7, p_limit int default 20)
returns table (id uuid, username text, avatar_url text, joined_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.avatar_url, u.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.is_public
     and u.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 30))
     and coalesce(p.avatar_url, '') <> ''
     and p.username is not null
     and not exists (select 1 from public.house_accounts h where h.user_id = p.id)
     and (exists (select 1 from public.user_photos x where x.user_id = p.id)
          or exists (select 1 from public.user_cards  c where c.user_id = p.id))
   order by u.created_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 40);
$$;

grant execute on function public.new_members(int, int) to anon, authenticated;

-- A correct result: the people who would show in the row right now (can be
-- empty if nobody new this week has a picture and a post yet).
select username, joined_at from public.new_members(7, 20);
