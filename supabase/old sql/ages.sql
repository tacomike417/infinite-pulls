-- ============================================================
-- AGES AND THE TERMS -- 28 Sep 2026 (Mike).
--
--   under 13  : no account (the app shows a stop screen)
--   13 to 17  : everything except private messaging; adults can't find
--               them in Suggested for you or ping them with @mentions
--               unless the teen follows them back
--   18+       : messaging (plus the dm_access list during the private test)
--
-- The birthdate is PRIVATE. It is not on profiles (which is public); it
-- lives in member_ages, which only its owner can read. Set once, at
-- sign-up or on the one-time "Before you keep going" screen, together with
-- agreeing to the Terms. Only staff can change it after that.
--
-- SAFE TO RUN TWICE. Run messages.sql first (this updates dm_can()).
-- ============================================================

create table if not exists public.member_ages (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  birthdate date not null check (birthdate > date '1900-01-01' and birthdate <= current_date),
  terms_at  timestamptz,
  set_at    timestamptz not null default now()
);
alter table public.member_ages enable row level security;

drop policy if exists "people read their own birthdate" on public.member_ages;
create policy "people read their own birthdate"
  on public.member_ages for select to authenticated using (auth.uid() = user_id);
-- no insert/update/delete policies: set_my_birthdate() and the sign-up
-- trigger are the only writers.

-- AGE IN YEARS. Not granted to the app: nobody can look up anyone's age.
create or replace function public.age_years(p_user uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select extract(year from age(current_date, birthdate))::int
    from public.member_ages where user_id = p_user;
$$;
revoke all on function public.age_years(uuid) from public, anon, authenticated;

-- MINOR = under 18, OR no birthdate given yet (strict: unknown counts as a minor).
create or replace function public.is_minor(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.age_years(p_user), 0) < 18; $$;
revoke all on function public.is_minor(uuid) from public, anon, authenticated;

-- WHAT THE APP ASKS ON LOAD: have you given a birthdate and agreed yet?
create or replace function public.my_age_status()
returns table (has_birthdate boolean, age int, agreed boolean)
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.member_ages where user_id = auth.uid()),
         public.age_years(auth.uid()),
         coalesce((select terms_at is not null from public.member_ages where user_id = auth.uid()), false);
$$;
grant execute on function public.my_age_status() to authenticated;

-- THE ONE-TIME SCREEN: birthdate + "I agree". Once only (staff excepted).
-- Returns 'ok', 'under13', 'already', 'terms' or 'bad'.
create or replace function public.set_my_birthdate(p_birth date, p_agree boolean)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  have record;
begin
  if auth.uid() is null then return 'bad'; end if;
  if p_agree is not true then return 'terms'; end if;
  if p_birth is null or p_birth <= date '1900-01-01' or p_birth > current_date then return 'bad'; end if;
  select * into have from public.member_ages where user_id = auth.uid();
  if found then
    -- the date never changes here; agreeing to the Terms still records
    update public.member_ages set terms_at = coalesce(terms_at, now()) where user_id = auth.uid();
    return case when public.age_years(auth.uid()) < 13 then 'under13' else 'already' end;
  end if;
  insert into public.member_ages (user_id, birthdate, terms_at) values (auth.uid(), p_birth, now());
  return case when public.age_years(auth.uid()) < 13 then 'under13' else 'ok' end;
end;
$$;
grant execute on function public.set_my_birthdate(date, boolean) to authenticated;

-- SIGN-UP: the birthdate and the "I agree" ride in the account's metadata
-- (there is no session yet), and this copies them across. Same pattern as
-- save_signup_phone().
create or replace function public.save_signup_age()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  b date;
begin
  begin b := (new.raw_user_meta_data->>'birthdate')::date; exception when others then b := null; end;
  if b is not null and b > date '1900-01-01' and b <= current_date then
    insert into public.member_ages (user_id, birthdate, terms_at)
    values (new.id, b, case when coalesce((new.raw_user_meta_data->>'terms')::boolean, false) then now() end)
    on conflict (user_id) do nothing;
  end if;
  return new;
exception when others then
  return new;
end;
$$;
drop trigger if exists save_signup_age on auth.users;
create trigger save_signup_age
  after insert on auth.users
  for each row execute function public.save_signup_age();

-- MESSAGING NEEDS 18+ (on top of the private-test list).
create or replace function public.dm_can()
returns boolean
language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null
     and exists (select 1 from public.dm_access a where a.user_id = auth.uid())
     and coalesce(public.age_years(auth.uid()), 0) >= 18;
$$;
grant execute on function public.dm_can() to authenticated;

-- @MENTIONS: an adult can't ping a minor unless the minor follows them.
create or replace function public.notify_mentions(
  p_text text, p_actor uuid, p_post text, p_comment uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  who uuid;
begin
  if p_text is null or p_actor is null then return; end if;
  for who in
    select distinct p.id
      from regexp_matches(p_text, '(?:^|[^A-Za-z0-9_@.])@([A-Za-z0-9_.]{2,31})', 'g') as m(h)
      join public.profiles p on lower(p.username) = lower(rtrim(m.h[1], '.'))
     limit 10
  loop
    if public.is_minor(who) and not public.is_minor(p_actor)
       and not exists (select 1 from public.follows f
                        where f.follower_id = who and f.followee_id = p_actor and f.following) then
      continue;
    end if;
    perform public.notify_once(who, p_actor, 'mention', p_post, p_comment);
  end loop;
end;
$$;

-- SUGGESTED FOR YOU: adults are never shown minors (or anyone who hasn't
-- given a birthdate yet). Otherwise identical to suggested_follows.sql.
create or replace function public.suggested_follows(p_limit int default 12, p_preview boolean default false)
returns table (id uuid, username text, avatar_url text, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_adult boolean;
begin
  if v_me is null then return; end if;
  if (select count(*) from public.profiles where is_public) < 50
     and not (p_preview and public.is_shop_staff()) then
    return;                                   -- not switched on yet
  end if;
  v_adult := not public.is_minor(v_me);

  return query
  with mine as (                              -- who I follow
    select followee_id from public.follows where follower_id = v_me and following
  ),
  photos as (
    select user_id as id, count(*)::int as n14,
           count(*) filter (where added_at > now() - interval '7 days')::int as n7
      from public.user_photos where added_at > now() - interval '14 days'
     group by user_id
  ),
  talk as (
    select user_id as id, count(*)::int as n
      from public.post_comments
     where created_at > now() - interval '14 days' and hidden_at is null
     group by user_id
  ),
  carddays as (
    select user_id as id, count(distinct (added_at at time zone 'America/New_York')::date)::int as n
      from public.user_cards where added_at > now() - interval '14 days'
     group by user_id
  ),
  mutual as (
    select f.followee_id as id, count(*)::int as n, min(pr.username) as one
      from public.follows f
      join mine m on m.followee_id = f.follower_id
      join public.profiles pr on pr.id = f.follower_id
     where f.following
     group by f.followee_id
  ),
  cand as (
    select p.id, p.username, p.avatar_url,
           coalesce(ph.n14, 0) * 3 + coalesce(t.n, 0) * 2 + coalesce(cd.n, 0) as act,
           coalesce(ph.n7, 0) as week_posts,
           coalesce(mu.n, 0) as mut, mu.one
      from public.profiles p
      left join photos ph on ph.id = p.id
      left join talk t on t.id = p.id
      left join carddays cd on cd.id = p.id
      left join mutual mu on mu.id = p.id
     where p.is_public and p.id <> v_me
       and coalesce(p.avatar_url, '') <> '' and p.username is not null
       and not exists (select 1 from mine where followee_id = p.id)
       and not exists (select 1 from public.user_blocks b
                        where (b.blocker_id = v_me and b.blocked_id = p.id)
                           or (b.blocker_id = p.id and b.blocked_id = v_me))
       and not (v_adult and public.is_minor(p.id))
  )
  select c.id, c.username, c.avatar_url,
         case when c.mut > 1 then 'Followed by @' || c.one || ' and ' || (c.mut - 1) || ' more'
              when c.mut = 1 then 'Followed by @' || c.one
              when c.week_posts > 1 then 'Posted ' || c.week_posts || ' times this week'
              when c.week_posts = 1 then 'Posted this week'
              else 'Active this week' end
    from cand c
   where c.act > 0
   order by c.act + c.mut * 4 desc, random()
   limit least(greatest(coalesce(p_limit, 12), 1), 30);
end;
$$;
grant execute on function public.suggested_follows(int, boolean) to authenticated;

-- A correct result: one row, 'ages: ok'.
select case when to_regclass('public.member_ages') is not null
             and exists (select 1 from pg_trigger where tgname = 'save_signup_age')
             and (select position('age_years' in prosrc) > 0 from pg_proc where proname = 'dm_can' limit 1)
            then 'ages: ok' else 'ages: MISSING' end as status;
