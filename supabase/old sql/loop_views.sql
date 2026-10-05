-- ============================================================
-- INFINITE PULLS: VIEWS ON LOOPS. 4 Oct 2026.
-- Run in the INFINITE PULLS Supabase project. SAFE TO RUN TWICE.
--
-- record_views() already counts views for card posts, photo posts and reward posts.
-- This lets Loops in too (their keys start with l-). Nothing else changes.
-- ============================================================
create or replace function public.record_views(p_keys text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.post_view_counts as v (post_key, n)
  select distinct k, 1
    from unnest(p_keys[1:50]) as k
   where k ~ '^(c|p|r|l)-[0-9a-zA-Z_-]{3,80}$'
  on conflict (post_key) do update set n = v.n + 1;
end;
$$;
revoke all on function public.record_views(text[]) from public;
grant execute on function public.record_views(text[]) to anon, authenticated;

-- A correct result: one row that says 'loop views: ok'.
select 'loop views: ok' as status, (select count(*) from public.post_view_counts where post_key like 'l-%') as loops_with_views_so_far;
