-- ============================================================
-- THE GREETER, PART 4: PEOPLE CAN ANSWER -- 4 Oct 2026 (Mike: "Let 18+ reply to her").
--
-- oddballemon's welcome says "if you have any questions lemme know", but the Messages
-- rules made answering impossible: both sides had to be 18+, a week old, active, and
-- following each other, and a house account has no birthday on file.
--
-- NOW: when a HOUSE ACCOUNT has messaged somebody first, those two can talk.
--   * The member still has to be 18 or older, with a confirmed email, not banned,
--     not frozen. Blocking still works both ways.
--   * What is waived, for that one chat only: the week-old rule, the "post something
--     first" rule, and following each other.
--   * A house account can see Messages (so Mike can switch to oddballemon and read
--     her inbox). A house account still cannot START a chat with a stranger from the
--     app; only the greeter does that.
-- Nothing changes between two ordinary members.
--
-- SAFE TO RUN TWICE.
-- ============================================================

-- true when one of the two is a house account that has already messaged the other
create or replace function public.dm_house_pair(p_me uuid, p_other uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.dm_threads t
      join public.dm_messages m on m.thread_id = t.id
      join public.house_accounts h on h.user_id = m.sender_id
     where t.user_a = least(p_me, p_other) and t.user_b = greatest(p_me, p_other)
       and m.sender_id in (p_me, p_other));
$$;
revoke all on function public.dm_house_pair(uuid, uuid) from public, anon, authenticated;

create or replace function public.dm_pair_why(p_me uuid, p_other uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  w text;
  hp boolean;
begin
  if p_me = p_other then return 'self'; end if;
  hp := public.dm_house_pair(p_me, p_other);

  -- me: a house account in a chat it started is fine; a member in that chat skips "new" and "active"
  if not (hp and exists (select 1 from public.house_accounts where user_id = p_me)) then
    w := public.dm_self_why(p_me);
    if w is not null and not (hp and w in ('new', 'active')) then return 'me:' || w; end if;
  end if;
  -- them: the same, the other way round
  if not (hp and exists (select 1 from public.house_accounts where user_id = p_other)) then
    w := public.dm_self_why(p_other);
    if w is not null and not (hp and w in ('new', 'active')) then return 'them:' || w; end if;
  end if;

  if exists (select 1 from public.user_blocks b
              where (b.blocker_id = p_me and b.blocked_id = p_other)
                 or (b.blocker_id = p_other and b.blocked_id = p_me)) then
    return 'blocked';
  end if;
  if not hp and not (exists (select 1 from public.follows where follower_id = p_me and followee_id = p_other and following)
      and exists (select 1 from public.follows where follower_id = p_other and followee_id = p_me and following)) then
    return 'follow';
  end if;
  return null;
end;
$$;
revoke all on function public.dm_pair_why(uuid, uuid) from public, anon, authenticated;
grant execute on function public.dm_pair_why(uuid, uuid) to service_role;

-- who sees the Messages icon: adults who are allowed, and the house accounts
create or replace function public.dm_can()
returns boolean
language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null
     and public.dm_allowed(auth.uid())
     and (coalesce(public.age_years(auth.uid()), 0) >= 18
          or exists (select 1 from public.house_accounts where user_id = auth.uid()));
$$;
grant execute on function public.dm_can() to authenticated;

-- A correct result: one row, status 'replies: ok', oddballemon_is_house = true.
select 'replies: ok' as status,
       exists (select 1 from public.house_accounts h join public.profiles p on p.id = h.user_id
                where lower(p.username) = 'oddballemon') as oddballemon_is_house;
