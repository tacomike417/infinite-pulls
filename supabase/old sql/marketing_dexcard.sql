-- ============================================================
-- MARKETING — the Infinite Dex card builder.
--
-- Run this once in the Supabase SQL Editor, after marketing.sql and
-- marketing_poster.sql. Safe to re-run: it sets the row rather than
-- patching it, so running it twice leaves the same result.
--
-- SAFE AGAINST LIVE DATA. One new row in marketing_prompts and three new
-- rows in marketing_assets. Creates no tables, alters no columns, touches
-- no other row. The poster prompt is not modified.
--
-- WHY THIS IS A ROW AND NOT A SCHEMA CHANGE
--
-- marketing.sql said it at the time: "the panel finds its sections by slug,
-- so a new section is a new row plus a bit of UI, never a schema change."
-- This is that promise being cashed in. A card builder is a second slug.
--
-- WHAT IT IS FOR
--
-- Every card in the Infinite Dex has the same frame: foil border, the logo
-- top-left, art, then a banner with the name, the task line and a flavour
-- line, then a footer with the collector code. Jeff should never have to
-- describe any of that. He types what is ON the card and picks a colour,
-- and this writes the rest.
-- ============================================================

insert into public.marketing_prompts (slug, name, blurb, enabled, sort)
values ('dexcard', 'Infinite Dex Card', '', true, 2)
on conflict (slug) do nothing;

update public.marketing_prompts set

name = 'Infinite Dex Card',

blurb = 'Type what goes on the card, pick a colour, and it writes the prompt. Send it to ChatGPT and you get a card back.',

template =
   E'You are illustrating a single collectible trading card for Infinite Pulls, a Pokémon TCG and hobby shop. It is part of an existing set called the Infinite Dex, and it has to look like it came out of the same pack as the others.\n'
|| E'\n'
|| E'THE EXAMPLES BELOW ARE THE SET. Open them before you draw anything. Match the frame, the finish and the typography exactly — the only things that change from card to card are the artwork and the colour.\n'
|| E'- Everyday card, holographic frame — THIS IS THE HOUSE STYLE: https://infinitepulls.com/brand-kit/dex-card-example-holo.jpg\n'
|| E'- Milestone card, gold treatment: https://infinitepulls.com/brand-kit/dex-card-example-gold.jpg\n'
|| E'- Event card, with extra lines under the task: https://infinitepulls.com/brand-kit/dex-card-example-event.jpg\n'
|| E'- The logo, placed as a file and never redrawn: https://infinitepulls.com/brand-kit/logo-full.png\n'
|| E'- The exact brand colours: https://infinitepulls.com/brand-kit/colors.txt\n'
|| E'\n'
|| E'SIZE AND SHAPE\n'
|| E'1060 x 1484 pixels. That is 5:7, the real proportions of a trading card, and it is not negotiable — the app lays these out in a grid and a card of the wrong shape sits wrong in it. If you can only produce a fixed size, keep 5:7 and get as close to 1060 wide as you can. Never 2:3, never square, never landscape.\n'
|| E'\n'
|| E'THE ARTWORK\n'
|| E'{{subject}}\n'
|| E'\n'
|| E'It fills the upper two thirds of the card, edge to edge, running behind the banner rather than stopping in a box above it. One hero subject, centred, facing the viewer. Deep detailed background, strong rim light, a sense that the thing is arriving rather than posing.\n'
|| E'\n'
|| E'COLOUR\n'
|| E'{{palette}}\n'
|| E'\n'
|| E'THE FRAME\n'
|| E'- A holographic foil border all the way round, rainbow refraction visible along the edges, with an inner metallic bezel and cut corners.\n'
|| E'- The Infinite Pulls logo sits in the top-left corner at about one fifth of the card width, placed as the supplied file. Do not redraw it, do not retype the words, do not recolour it.\n'
|| E'- A small lightning bolt centred in the very bottom edge, breaking the footer rule.\n'
|| E'\n'
|| E'THE WORDS ON THE CARD, EXACTLY AS TYPED\n'
|| E'Small caps eyebrow, centred, above the name: INFINITE DEX\n'
|| E'Card name, the largest type on the card, heavy italic condensed caps with a metallic bevel: {{cardname}}\n'
|| E'Task line, in a banner directly under the name, bold caps, in the accent colour: {{taskline}}\n'
|| E'{{extra}}\n'
|| E'Flavour line under that, smaller, sentence case with a full stop: {{flavor}}\n'
|| E'Footer rule across the bottom. On the left, in small mono caps: {{code}}. On the right, in the same size: INFINITE PULLS COLLECTION\n'
|| E'\n'
|| E'{{notes}}\n'
|| E'\n'
|| E'RULES\n'
|| E'- Every word I typed appears exactly as I typed it. Do not correct my spelling, do not expand an abbreviation, do not add a word I did not give you, and do not invent a card name, a number or a date.\n'
|| E'- If I left a line out, leave it out. An empty line is not an invitation to write something.\n'
|| E'- Text must be legible at thumbnail size, because that is how the card is first seen. If the name will not fit, reduce the artwork, never the name.\n'
|| E'- No Pokémon characters, no Nintendo or Game Freak artwork, no existing card art, no real trading card copied or traced. Every creature on these cards is an Infinite Pulls original and yours to invent.\n'
|| E'- No lorem ipsum, no placeholder boxes, no "your text here". Every word on the finished card is real.\n'
|| E'\n'
|| E'BEFORE YOU DRAW\n'
|| E'Read back the five text lines you are about to put on the card — eyebrow, name, task, flavour, footer — so I can check them. Then draw it.',

-- The colour schemes, taken off the cards that already exist rather than
-- invented, so a new card lands next to them and looks related.
options = '[
  {
    "id": "vault",
    "label": "Vault Blue & Gold — the everyday one",
    "instruction": "Deep navy ground, electric blue energy, gold filigree and gold type. Cool and regal. This is the default look of the set — use it unless the card is asking for something else."
  },
  {
    "id": "storm",
    "label": "Storm Blue & Gold — for events",
    "instruction": "Night-storm navy, white-blue lightning forking across the frame, heavy gold plate on the creature and the type. Weather and occasion. Use it for anything that happened on a particular day."
  },
  {
    "id": "portal",
    "label": "Portal Purple — digital, arriving",
    "instruction": "Violet and magenta with cyan highlights, particle swarms and a spiral of light. Screen-glow rather than daylight. Use it for anything about the app itself."
  },
  {
    "id": "wish",
    "label": "Wishfinder Green — searching, hunting",
    "instruction": "Emerald and jade with pale gold starlight, constellation lines and map geometry in the background. Use it for anything about looking for something."
  },
  {
    "id": "titan",
    "label": "Titan Red & Chrome — big milestones",
    "instruction": "Brushed chrome and gunmetal with crimson and hot pink neon, a faceted gem at the centre of the chest. Heavy and mechanical. Use it for a serious number."
  },
  {
    "id": "carnival",
    "label": "Snapsnout Carnival — funny, friendly",
    "instruction": "Warm orange fur against teal, lime green highlights, cluttered workbench background. Cartoon energy, googly and grinning rather than heroic. Use it when the card should make somebody laugh."
  },
  {
    "id": "gold",
    "label": "Full Gold — the rarest cards only",
    "instruction": "Everything gold. Black ground, molten and polished gold throughout, gold foil border instead of rainbow, gold type on gold plate. No second colour anywhere. Save this for the top of the set — it means nothing if every card gets it."
  }
]'::jsonb,

-- No QR code on a card, and the logo is fetched by link, so there is
-- usually nothing to attach at all.
attachments = '[
  "Nothing, usually — the prompt links to the examples and the logo, and ChatGPT fetches them.",
  "If it says it cannot open the links, attach the holo example card and the logo.",
  "Check the spelling on the finished card before you upload it. The picture is the card; there is no editing it afterwards."
]'::jsonb,

enabled = true,
sort = 2,
updated_at = now()

where slug = 'dexcard';


-- ============================================================
-- The example cards, in the brand kit alongside the poster examples.
-- /brand-kit/ is served straight off the site, so these are real URLs the
-- moment they are pushed.
-- ============================================================
insert into public.marketing_assets (label, url, note, sort)
select * from (values
  ('Dex card — holo example',
   'https://infinitepulls.com/brand-kit/dex-card-example-holo.jpg',
   'The house style. Match this frame.', 10),
  ('Dex card — gold example',
   'https://infinitepulls.com/brand-kit/dex-card-example-gold.jpg',
   'The milestone treatment.', 11),
  ('Dex card — event example',
   'https://infinitepulls.com/brand-kit/dex-card-example-event.jpg',
   'Shows the extra lines under the task.', 12)
) as v(label, url, note, sort)
where not exists (
  select 1 from public.marketing_assets a where a.url = v.url
);


-- ============================================================
-- Check: every row should say true, and there should be seven colours.
-- A false anywhere means the update did not land on the row.
-- ============================================================
select
  template like '%1060 x 1484%'                        as says_the_real_size,
  template like '%dex-card-example-holo.jpg%'          as links_the_examples,
  template like '%never redraw%' or
    template like '%never redrawn%'                    as protects_the_logo,
  template like '%Infinite Pulls original%'            as no_pokemon_artwork,
  template not like '%QR%'                             as no_qr_code_on_a_card,
  jsonb_array_length(options)                          as colour_schemes,
  length(template)                                     as prompt_characters
from public.marketing_prompts where slug = 'dexcard';
