-- ============================================================
-- MARKETING — the prompts behind the admin panel's Marketing tab.
--
-- SAFE AGAINST LIVE DATA. Creates two new tables and touches nothing that
-- already exists. No delete, no drop of anything you have, no update to a
-- single existing row. Running it twice does nothing the second time.
--
-- WHAT THIS IS FOR
--
-- The shop owner does not need to learn to write prompts, and should not
-- have to. He needs a poster. So the admin panel gives him a form -- a
-- title, a link to the numbers, a look to use -- and the prompt gets built
-- around those answers from a template kept here.
--
-- The template is the part with the craft in it, and it is the part that
-- will be rewritten twenty times as the posters come back wrong. That is
-- exactly why it lives in a table rather than in the JavaScript: tuning the
-- wording is then a text edit from a phone, not an edit-commit-deploy.
--
-- WHY THE OPTIONS ARE IN THE SAME ROW
--
-- `options` holds the look/palette choices as JSON -- the dropdown he picks
-- from, and the sentence each choice contributes to the prompt. It sits on
-- the prompt row rather than in a table of its own because a palette has no
-- meaning apart from the prompt it feeds, and two tables would mean two
-- editors to keep in step. One row is one editable thing.
-- ============================================================

-- ---------- 1. The prompts ----------------------------------------------
create table if not exists public.marketing_prompts (
  -- 'poster' today. 'facebook-post', 'event-flyer' later -- the panel finds
  -- its sections by slug, so a new section is a new row plus a bit of UI,
  -- never a schema change.
  slug        text primary key,

  name        text not null,                  -- 'Poster Creation'
  blurb       text,                           -- the line under the heading
  -- The template, with {{placeholders}} the panel fills in from the form.
  -- Unknown placeholders are left alone rather than blanked, so a typo in a
  -- template shows up as {{titel}} in the output instead of silently
  -- deleting the title.
  template    text not null default '',
  -- [{ "id":"gold", "label":"Gold", "instruction":"..." }, ...]
  options     jsonb not null default '[]'::jsonb,
  -- What he should attach in ChatGPT before sending. Shown as a checklist.
  attachments jsonb not null default '[]'::jsonb,

  enabled     boolean not null default true,
  sort        integer not null default 1,
  updated_at  timestamptz not null default now()
);

create or replace function public.set_marketing_prompt_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists marketing_prompts_set_updated_at on public.marketing_prompts;
create trigger marketing_prompts_set_updated_at
  before update on public.marketing_prompts
  for each row
  execute function public.set_marketing_prompt_updated_at();

-- ---------- 2. The brand files ------------------------------------------
-- The logo and anything else that goes up with nearly every poster. Just a
-- label and a link: the files already live somewhere (the repo, Drive, the
-- Supabase bucket) and copying them into a second home would mean two
-- versions of a logo and no way to tell which is current.
create table if not exists public.marketing_assets (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,                  -- 'Infinite Pulls logo (PNG)'
  url         text not null,
  note        text,                           -- 'Use this one on dark posters'
  sort        integer not null default 1,
  created_at  timestamptz not null default now()
);

-- ---------- 3. Who can read and write -----------------------------------
-- Same shape as store_info and the banner: readable by the panel, writable
-- by a signed-in account.
--
-- WORTH KNOWING, and it is not new with this file: `to authenticated` means
-- any signed-in CUSTOMER, not "an admin". This app has no admin role -- the
-- panel is gated by a login screen in the UI, and the database does not
-- know the difference. For prompt templates that is a small thing. It is
-- the same policy guarding store_info and the banner, which is a larger
-- one, and it is worth fixing there properly one day rather than pretending
-- this file made it worse.
alter table public.marketing_prompts enable row level security;
alter table public.marketing_assets enable row level security;

drop policy if exists "admin reads marketing prompts" on public.marketing_prompts;
create policy "admin reads marketing prompts"
  on public.marketing_prompts for select
  to authenticated
  using (true);

drop policy if exists "admin manages marketing prompts" on public.marketing_prompts;
create policy "admin manages marketing prompts"
  on public.marketing_prompts for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "admin reads marketing assets" on public.marketing_assets;
create policy "admin reads marketing assets"
  on public.marketing_assets for select
  to authenticated
  using (true);

drop policy if exists "admin manages marketing assets" on public.marketing_assets;
create policy "admin manages marketing assets"
  on public.marketing_assets for all
  to authenticated
  using (true)
  with check (true);

-- ---------- 4. The starter poster prompt --------------------------------
-- A PLACEHOLDER, and deliberately labelled as one in its own text. It is
-- structured the way a good poster prompt is structured -- role, source,
-- what to make, what not to do, output format -- so there is something real
-- to react to and rewrite, rather than a blank box.
--
-- Rewrite it from the panel. `on conflict do nothing` means re-running this
-- file will never overwrite what you have written.
insert into public.marketing_prompts (slug, name, blurb, template, options, attachments, sort)
values (
  'poster',
  'Poster Creation',
  'Fill this in and it writes the prompt for you. Copy it into ChatGPT, attach the brand files, and send.',
  E'You are a senior graphic designer making a promotional poster for Infinite Pulls, a Pokémon TCG and hobby shop.\n'
  || E'\n'
  || E'THE POSTER\n'
  || E'Title: {{title}}\n'
  || E'{{notes}}\n'
  || E'\n'
  || E'WHERE THE INFORMATION COMES FROM\n'
  || E'Read this page and use the real numbers on it. Do not invent card names, prices or percentages — if you cannot read the page, stop and tell me instead of guessing:\n'
  || E'{{source}}\n'
  || E'\n'
  || E'LOOK AND FEEL\n'
  || E'{{palette}}\n'
  || E'\n'
  || E'RULES\n'
  || E'- Use the attached logo. Do not redraw it, recolour it or alter its proportions.\n'
  || E'- Every price and percentage must match the source page exactly.\n'
  || E'- Write like a shop talking to collectors who know the hobby. No "hey kids", no exclamation-mark stacking, no talking down.\n'
  || E'- Keep the text short enough to read from across a room.\n'
  || E'- Leave clear space at the bottom for the shop name and website.\n'
  || E'\n'
  || E'OUTPUT\n'
  || E'A single portrait poster image at 2:3, print-ready at 300 DPI.\n'
  || E'Before you draw it, list the exact figures you took from the source page so I can check them.\n'
  || E'\n'
  || E'[This is the starter template. Rewrite it in the admin panel — Marketing → Edit prompt.]',
  '[
    {"id":"normal","label":"Normal","instruction":"Clean, modern retail poster. Bold headline, generous white space, high contrast, easy to read at a glance."},
    {"id":"raredcard","label":"Rare Pokémon card","instruction":"Treat the whole poster like a rare holographic Pokémon card: a defined border frame, holo foil sheen across the background, subtle rainbow refraction, and a texture that reads as premium cardboard rather than paper."},
    {"id":"gold","label":"Gold","instruction":"Deep black background with metallic gold as the only accent. Gold foil lettering, thin gold rules, warm highlights. Expensive and restrained — no other colour."},
    {"id":"purple","label":"Purple","instruction":"Rich purple and near-black, with violet glow behind the focal elements and a cooler lilac for secondary text."},
    {"id":"blue","label":"Blue","instruction":"Electric blue on deep navy, with a cold glow behind the focal elements. Crisp, technical, high-contrast."},
    {"id":"red","label":"Red","instruction":"Bold red on charcoal, high energy without looking like a clearance sale. Red for emphasis only, never for body text."},
    {"id":"green","label":"Green","instruction":"Emerald green on near-black, with a soft green glow. Fresh and confident rather than neon."}
  ]'::jsonb,
  '["The Infinite Pulls logo (PNG, transparent background)"]'::jsonb,
  1
)
on conflict (slug) do nothing;

-- ============================================================
-- What you should see: one prompt row named 'poster', however many brand
-- files you have added (0 the first time), and today''s date on the prompt.
-- ============================================================
select
  slug,
  name,
  length(template)                      as template_characters,
  jsonb_array_length(options)           as look_choices,
  jsonb_array_length(attachments)       as files_to_attach,
  updated_at::date                      as last_edited
from public.marketing_prompts
order by sort;
