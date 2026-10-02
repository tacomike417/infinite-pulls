-- ============================================================
-- INFINITE MESSENGER -- private test, 28 Sep 2026 (Mike).
--
-- ONLY TWO PEOPLE CAN USE THIS: tacomike417 and Jefleppard. They are the
-- only rows in dm_access. Everybody else gets nothing: no icon in the
-- app, and the database refuses to show them a chat or a message even if
-- they asked for one directly.
--
-- LOCKED TWICE:
--   * Nobody can WRITE a message from the app. Every message goes through
--     the 'messages' server function, which checks the words and the photo
--     (Google SafeSearch) first, and only then saves it.
--   * Nobody can READ a chat unless they are in it AND on the list.
--
-- To let someone else in later: insert their id into dm_access.
-- SAFE TO RUN TWICE.
-- ============================================================

-- WHO MAY MESSAGE AT ALL. No policies: only the functions below read it.
create table if not exists public.dm_access (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.dm_access enable row level security;

insert into public.dm_access (user_id)
select id from public.profiles where lower(username) in ('tacomike417', 'jefleppard')
on conflict do nothing;

create or replace function public.dm_can()
returns boolean
language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null
     and exists (select 1 from public.dm_access a where a.user_id = auth.uid());
$$;
grant execute on function public.dm_can() to authenticated;

-- ONE CHAT BETWEEN TWO PEOPLE. user_a is always the smaller id, so the
-- same two people can only ever have one chat.
create table if not exists public.dm_threads (
  id         uuid primary key default gen_random_uuid(),
  user_a     uuid not null references auth.users(id) on delete cascade,
  user_b     uuid not null references auth.users(id) on delete cascade,
  a_read_at  timestamptz,
  b_read_at  timestamptz,
  last_at    timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint dm_threads_order check (user_a < user_b),
  constraint dm_threads_pair unique (user_a, user_b)
);
create index if not exists dm_threads_a_idx on public.dm_threads (user_a, last_at desc);
create index if not exists dm_threads_b_idx on public.dm_threads (user_b, last_at desc);
alter table public.dm_threads enable row level security;

drop policy if exists "members read their chats" on public.dm_threads;
create policy "members read their chats"
  on public.dm_threads for select to authenticated
  using (public.dm_can() and auth.uid() in (user_a, user_b));
-- no insert / update / delete policies: the server function and
-- dm_mark_read() are the only writers.

create table if not exists public.dm_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.dm_threads(id) on delete cascade,
  sender_id  uuid not null references auth.users(id) on delete cascade,
  body       text check (body is null or char_length(body) <= 2000),
  photo_key  text check (photo_key is null or char_length(photo_key) <= 300),
  share_key  text check (share_key is null or share_key ~ '^[cprl]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  created_at timestamptz not null default now(),
  constraint dm_messages_not_empty check (body is not null or photo_key is not null or share_key is not null)
);
create index if not exists dm_messages_thread_idx on public.dm_messages (thread_id, created_at desc);
alter table public.dm_messages enable row level security;

drop policy if exists "members read their messages" on public.dm_messages;
create policy "members read their messages"
  on public.dm_messages for select to authenticated
  using (public.dm_can() and exists (
    select 1 from public.dm_threads t
     where t.id = dm_messages.thread_id and auth.uid() in (t.user_a, t.user_b)));

-- WHAT THE FILTERS STOPPED. A blocked photo or message is written here,
-- never delivered. Moderators can read it; nobody else can.
create table if not exists public.dm_flags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null,           -- 'photo' | 'words'
  detail     text,
  created_at timestamptz not null default now()
);
alter table public.dm_flags enable row level security;
drop policy if exists "moderators read flags" on public.dm_flags;
create policy "moderators read flags"
  on public.dm_flags for select to authenticated using (public.is_moderator());

-- MARK A CHAT READ (for "Seen" and the unread count).
create or replace function public.dm_mark_read(p_thread uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.dm_can() then return; end if;
  update public.dm_threads set a_read_at = now() where id = p_thread and user_a = auth.uid();
  update public.dm_threads set b_read_at = now() where id = p_thread and user_b = auth.uid();
end;
$$;
grant execute on function public.dm_mark_read(uuid) to authenticated;

-- HOW MANY UNREAD, for the badge on the Messages icon.
create or replace function public.dm_unread()
returns integer
language sql stable security definer set search_path = public
as $$
  select case when not public.dm_can() then 0 else (
    select count(*)::int
      from public.dm_messages m
      join public.dm_threads t on t.id = m.thread_id
     where auth.uid() in (t.user_a, t.user_b)
       and m.sender_id <> auth.uid()
       and m.created_at > coalesce(case when t.user_a = auth.uid() then t.a_read_at else t.b_read_at end, 'epoch'::timestamptz)
  ) end;
$$;
grant execute on function public.dm_unread() to authenticated;

-- WHO YOU CAN START A CHAT WITH: everyone else on the list.
create or replace function public.dm_people()
returns table (id uuid, username text, avatar_url text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.username, p.avatar_url
    from public.dm_access a join public.profiles p on p.id = a.user_id
   where public.dm_can() and a.user_id <> auth.uid()
   order by p.username;
$$;
grant execute on function public.dm_people() to authenticated;

-- LIVE UPDATES: new messages and "Seen" arrive without a refresh.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dm_messages') then
    alter publication supabase_realtime add table public.dm_messages;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dm_threads') then
    alter publication supabase_realtime add table public.dm_threads;
  end if;
end $$;

-- A correct result: one row that says 'messages: ok, 2 people'.
select 'messages: ' ||
       case when (select count(*) from public.dm_access) = 2
             and exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'dm_messages')
            then 'ok, 2 people'
            else 'CHECK: ' || (select count(*) from public.dm_access) || ' people on the list (should be 2)' end as status;
