-- =====================================================================
-- PHONE NUMBERS -- 25 Sep 2026
--
-- Mike: "let's start grabbing phone numbers ... we might hook this thing
-- in later and we'll have them all there."
--
-- Nothing texts anybody yet. This only COLLECTS the number and, separately,
-- whether the person said yes to texts -- with the exact words they said
-- yes to and when, because the day texting is switched on, that record is
-- what makes it legal to send. A number with texts_ok = false is a number
-- we hold, not a number we may text.
--
-- PRIVATE. Its own table, not a column on profiles: profiles is readable by
-- everybody (it is the public page). Here you can read your own row, shop
-- staff can read all of them, and nobody else sees anything.
--
-- US numbers only for now, stored as +1XXXXXXXXXX so a texting service can
-- take them as they are.
--
-- Safe to run more than once.
-- =====================================================================

create table if not exists public.contact_phones (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  phone         text not null check (phone ~ '^\+1[2-9][0-9]{9}$'),
  texts_ok      boolean not null default false,
  texts_ok_at   timestamptz,
  consent_words text,
  verified_at   timestamptz,          -- set later, when a code is texted and typed back
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.contact_phones enable row level security;

drop policy if exists "people read their own phone" on public.contact_phones;
create policy "people read their own phone"
  on public.contact_phones for select
  using (auth.uid() = user_id);

drop policy if exists "shop staff read phones" on public.contact_phones;
create policy "shop staff read phones"
  on public.contact_phones for select
  using (public.is_shop_staff());

-- No insert/update policy on purpose: every write goes through
-- save_my_phone() below, which cleans the number and records consent.

-- "(330) 555-1234", "330.555.1234", "+1 330 555 1234" -> "+13305551234".
-- Anything that is not a US number comes back null.
create or replace function public.normalize_us_phone(p text)
returns text
language plpgsql
immutable
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) = 11 and left(d, 1) = '1' then d := substr(d, 2); end if;
  if length(d) = 10 and substr(d, 1, 1) between '2' and '9' then
    return '+1' || d;
  end if;
  return null;
end;
$$;

-- The words on the screen when somebody ticks the box. Kept here as well as
-- on the page so the row records exactly what was agreed to.
create or replace function public.texts_consent_words()
returns text
language sql
immutable
as $$
  select 'Text me when Infinite Pulls drops new cards or goes live. '
      || 'A few texts a month. Msg & data rates may apply. Reply STOP to stop.'::text;
$$;

-- Save, change or remove (blank) your own number.
create or replace function public.save_my_phone(p_phone text, p_texts_ok boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  n  text;
begin
  if me is null then
    raise exception 'Sign in first.';
  end if;

  if p_phone is null or btrim(p_phone) = '' then
    delete from public.contact_phones where user_id = me;
    return null;
  end if;

  n := public.normalize_us_phone(p_phone);
  if n is null then
    raise exception 'That does not look like a US phone number. Ten digits, please.';
  end if;

  insert into public.contact_phones as c
    (user_id, phone, texts_ok, texts_ok_at, consent_words)
  values
    (me, n, coalesce(p_texts_ok, false),
     case when p_texts_ok then now() end,
     case when p_texts_ok then public.texts_consent_words() end)
  on conflict (user_id) do update set
    phone         = excluded.phone,
    texts_ok      = excluded.texts_ok,
    -- keep the ORIGINAL yes if they already said yes; a new yes gets now()
    texts_ok_at   = case when excluded.texts_ok
                         then coalesce(case when c.texts_ok then c.texts_ok_at end, now())
                    end,
    consent_words = case when excluded.texts_ok
                         then coalesce(case when c.texts_ok then c.consent_words end,
                                       public.texts_consent_words())
                    end,
    -- a different number is an unconfirmed number
    verified_at   = case when c.phone = excluded.phone then c.verified_at end,
    updated_at    = now();

  return n;
end;
$$;

revoke all on function public.save_my_phone(text, boolean) from public, anon;
grant execute on function public.save_my_phone(text, boolean) to authenticated;

-- A NUMBER TYPED AT SIGN-UP. The sign-up form puts it in the account's
-- metadata (the person has no session yet while the confirmation email is
-- out). This copies it across the moment the account exists. It can never
-- block a sign-up: any problem and the account is made without the number.
create or replace function public.save_signup_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n  text;
  ok boolean;
begin
  n  := public.normalize_us_phone(new.raw_user_meta_data->>'phone');
  ok := coalesce((new.raw_user_meta_data->>'texts_ok')::boolean, false);
  if n is not null then
    insert into public.contact_phones (user_id, phone, texts_ok, texts_ok_at, consent_words)
    values (new.id, n, ok,
            case when ok then now() end,
            case when ok then public.texts_consent_words() end)
    on conflict (user_id) do nothing;
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists save_signup_phone on auth.users;
create trigger save_signup_phone
  after insert on auth.users
  for each row execute function public.save_signup_phone();

-- CHECK: you should see 1 | 1 | 1 | 0 or more
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'contact_phones')      as table_should_be_1,
  (select count(*) from pg_proc where proname = 'save_my_phone')          as function_should_be_1,
  (select count(*) from pg_trigger where tgname = 'save_signup_phone')    as trigger_should_be_1,
  (select count(*) from public.contact_phones)                            as numbers_so_far;
