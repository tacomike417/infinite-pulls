-- ============================================================
-- INVITE A FRIEND -- social pack #5, 27 Sep 2026.
--
-- Your invite link is your profile link (infinitepulls.com/@you). When
-- somebody new arrives through it and signs up within 3 days:
--   * they are marked as invited by you (profiles.invited_by),
--   * they follow you automatically, so their feed is not empty,
--   * you get ONE alert, "@them joined from your invite" -- the automatic
--     follow stays quiet so you are not pinged twice.
-- The reward card for inviting comes later (Mike, 27 Sep).
--
-- SAFE TO RUN TWICE.
-- ============================================================

alter table public.profiles
  add column if not exists invited_by uuid references auth.users(id) on delete set null;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('comment','reply','heart','follow','heat','dex','goal','wishlist','mention','invite'));

-- Same as before, plus: an automatic follow from an invite stays quiet.
create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('ip.quiet_follow', true), '') = 'on' then
    return new;
  end if;
  if new.following is not true then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.following is true then
    return new;
  end if;
  perform public.notify_once(new.followee_id, new.follower_id, 'follow', null, null);
  return new;
end;
$$;

create or replace function public.claim_invite(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me  uuid := auth.uid();
  v_ref uuid;
  v_new timestamptz;
begin
  if v_me is null then return 'signed-out'; end if;
  select id into v_ref from public.profiles
   where lower(username) = lower(regexp_replace(coalesce(p_username, ''), '^@', ''));
  if v_ref is null or v_ref = v_me then return 'no-inviter'; end if;
  if (select invited_by from public.profiles where id = v_me) is not null then return 'already'; end if;
  select created_at into v_new from auth.users where id = v_me;
  if v_new is null or v_new < now() - interval '3 days' then return 'not-new'; end if;

  update public.profiles set invited_by = v_ref where id = v_me;

  perform set_config('ip.quiet_follow', 'on', true);
  insert into public.follows (follower_id, followee_id, following, changed_at)
  values (v_me, v_ref, true, now())
  on conflict (follower_id, followee_id) do update set following = true, changed_at = now();
  perform set_config('ip.quiet_follow', 'off', true);

  perform public.notify_once(v_ref, v_me, 'invite', null, null);
  return 'ok';
end;
$$;

grant execute on function public.claim_invite(text) to authenticated;

create or replace function public.invite_count(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.profiles where invited_by = p_user;
$$;

grant execute on function public.invite_count(uuid) to anon, authenticated;

-- A correct result: one row, 'ok'.
select case when exists (select 1 from information_schema.columns
                          where table_name = 'profiles' and column_name = 'invited_by')
             and to_regproc('public.claim_invite') is not null
            then 'ok' else 'MISSING' end as invites;
