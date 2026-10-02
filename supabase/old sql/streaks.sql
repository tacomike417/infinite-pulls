-- ============================================================
-- STREAKS -- social pack #9, 27 Sep 2026.
--
-- A day counts when you post a photo, comment, or add a card (Ohio time).
-- The streak is how many days in a row, ending today -- or yesterday, so it
-- does not look broken at 8am before you have done anything today.
--
-- Returns: current streak, best ever, and whether today already counts.
-- Only numbers come out, so it runs as the owner and works for anybody.
--
-- SAFE TO RUN TWICE.
-- ============================================================

create or replace function public.user_streak(p_user uuid)
returns table (current_days int, best_days int, today_done boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today    date := (now() at time zone 'America/New_York')::date;
  d        date;
  prev     date := null;
  run      int := 0;
  best     int := 0;
  cur      int := 0;
  done     boolean := false;
  in_first boolean := true;   -- still walking back through the newest run
begin
  for d in
    select distinct x.day from (
      select (added_at   at time zone 'America/New_York')::date as day from public.user_photos   where user_id = p_user
      union
      select (created_at at time zone 'America/New_York')::date       from public.post_comments where user_id = p_user and hidden_at is null
      union
      select (added_at   at time zone 'America/New_York')::date       from public.user_cards    where user_id = p_user
    ) x
    order by 1 desc
  loop
    if prev is null then
      run := 1;
      done := (d = today);
      in_first := (d >= today - 1);     -- newest day is today or yesterday
    elsif prev - d = 1 then
      run := run + 1;
    else
      run := 1;
      in_first := false;                -- a gap: the current streak is over
    end if;
    if in_first then cur := run; end if;
    if run > best then best := run; end if;
    prev := d;
  end loop;
  return query select cur, best, done;
end;
$$;

grant execute on function public.user_streak(uuid) to anon, authenticated;

-- A correct result: one row with your streak numbers.
select * from public.user_streak((select id from public.profiles where username = 'tacomike417'));
