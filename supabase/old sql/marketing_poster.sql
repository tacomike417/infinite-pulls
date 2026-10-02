-- ============================================================
-- MARKETING — the real poster prompt, and the brand kit behind it.
--
-- SAFE AGAINST LIVE DATA. Adds one nullable column, rewrites the one
-- placeholder prompt row that marketing.sql seeded, and inserts the brand
-- files. Touches nothing else. Safe to re-run.
--
-- REQUIRES marketing.sql.
--
-- WHAT CHANGED AND WHY
--
-- marketing.sql shipped a placeholder prompt written before anybody had
-- seen an Infinite Pulls poster. Then two real ones turned up in
-- /brand-kit/, and they are not a vague style -- they are a system:
--
--   * near-black ground with electric-blue energy behind everything
--   * gold lightning bolts as punctuation
--   * heavy condensed italic caps, chrome for one line, bevelled gold
--     for the line that matters
--   * content in rounded panels with a thin gold border
--   * green badges on anything that went up
--   * a bottom band: QR code, SCAN TO START, INFINITEPULLS.COM
--
-- That is describable, so it is described here rather than left to
-- "match the vibe". The examples are attached as well, because for image
-- work one reference picture outruns two paragraphs of adjectives.
--
-- THE TWO THINGS HE PICKS
--
-- COLOUR, in words, because he is a shop owner and not a designer -- the
-- dropdown says "Red", never "#FF0000". Each choice keeps the house style
-- and swaps only the accent, so no colour can produce a poster that looks
-- like a different business.
--
-- SHAPE, because the two real examples are different: one square for a
-- feed, one tall for a story or a print. Hardcoding either would have
-- quietly made half his posters the wrong shape.
-- ============================================================

-- ---------- 1. Shape needs somewhere to live ----------------------------
alter table public.marketing_prompts
  add column if not exists shapes jsonb not null default '[]'::jsonb;

-- ---------- 2. The brand kit --------------------------------------------
-- Served straight off the repo: anything committed under /brand-kit/ is a
-- public URL on infinitepulls.com about a minute later. No bucket, no
-- upload screen, no storage bill, and the files version with the code.
insert into public.marketing_assets (label, url, note, sort) values
  ('Logo (full wordmark)',   'https://infinitepulls.com/brand-kit/logo-full.png',           'Use on every poster. Never redraw or recolour it.', 1),
  ('Logo (mark only)',       'https://infinitepulls.com/brand-kit/logo-mark.png',           'For tight corners where the wordmark will not fit.', 2),
  ('QR code',                'https://infinitepulls.com/brand-kit/infinite-pulls-qr-code.png','Goes in the bottom band, on a white square.',       3),
  ('Example poster — square','https://infinitepulls.com/brand-kit/poster-example2.jpg',     'Attach this one. It is what "the house style" means.', 4),
  ('Example poster — tall',  'https://infinitepulls.com/brand-kit/poster-example1.png',     'Attach this instead when you pick a tall shape.',    5),
  ('Brand colours',          'https://infinitepulls.com/brand-kit/colors.txt',              'The exact codes, taken off the real posters.',       6)
on conflict do nothing;

-- ---------- 3. The prompt -----------------------------------------------
update public.marketing_prompts set

blurb = 'Fill this in and it writes the prompt for you. Send it to ChatGPT, attach the files it lists, and hit the arrow.',

template =
E'You are a senior graphic designer producing a promotional graphic for Infinite Pulls, a Pokémon TCG and hobby shop.\n'
|| E'\n'
|| E'The attached example posters ARE the brand. Study them before you draw anything: the goal is a graphic that sits beside them and looks like the same shop made it on the same day.\n'
|| E'\n'
|| E'THE GRAPHIC\n'
|| E'{{title}}\n'
|| E'{{notes}}\n'
|| E'\n'
|| E'WHERE THE NUMBERS COME FROM\n'
|| E'Open this page and use the real figures on it. Do not invent, round, estimate or remember card names, prices or percentages. If you cannot read the page, stop and say so rather than guessing:\n'
|| E'{{source}}\n'
|| E'\n'
|| E'HOUSE STYLE — this is not a suggestion\n'
|| E'- Background: pure black (#000000) with electric-blue energy and forked lightning radiating from behind the content. Deep, glossy, high contrast.\n'
|| E'- Blue works in three depths: #3F9FFF at the brightest part of a strike, #007FFF through the middle, #0054FF sinking into the corners.\n'
|| E'- Gold lightning bolts used as punctuation and separators, never as decoration for its own sake.\n'
|| E'- Headline type: heavy condensed italic sans, all caps, tightly set. The supporting line in brushed chrome/silver; the line that matters in bevelled 3D gold. The gold needs all three of its shades to read as metal rather than as flat yellow: #FFD400 on the top bevel, #FFC928 across the face, #BF7F00 in the shadow. Thick black outline and an outer glow on both, so they hold up on a phone.\n'
|| E'- Content sits in rounded rectangular panels on near-black, each with a thin gold border and a soft inner shadow.\n'
|| E'- Anything that went UP gets a solid green (#008000) badge with white text. Anything that went DOWN gets red (#E1252B). Those two colours mean only that and are never used decoratively.\n'
|| E'- Real Pokémon card art, shown as a card, in its own gold-bordered frame.\n'
|| E'- The Infinite Pulls logo from the attached file, unaltered — same proportions, same colours, no redraw.\n'
|| E'- Bottom band: the attached QR code on a clean white square, the words SCAN TO START YOUR COLLECTION, and INFINITEPULLS.COM.\n'
|| E'\n'
|| E'ACCENT\n'
|| E'{{palette}}\n'
|| E'\n'
|| E'SHAPE\n'
|| E'{{shape}}\n'
|| E'\n'
|| E'RULES\n'
|| E'- Every price and percentage must match the source page exactly, to the cent and to two decimal places.\n'
|| E'- Every card name, set name and card number must be spelled exactly as the source has it.\n'
|| E'- Write like a shop talking to collectors who already know the hobby. No "hey kids", no stacked exclamation marks, no talking down, no clip-art enthusiasm.\n'
|| E'- Big enough to read at arm''s length on a phone. If something will not fit legibly, cut an item rather than shrinking the type.\n'
|| E'- No lorem ipsum, no placeholder boxes, no "your text here". Every word on the finished graphic is real.\n'
|| E'\n'
|| E'BEFORE YOU DRAW\n'
|| E'List the exact figures you took from the source page — card name, set, current price, previous price, percentage — so I can check them against the page myself. Then draw it.',

options = '[
  {"id":"house","label":"Normal (blue and gold)","instruction":"The house look, unchanged: electric blue (#007FFF) energy and lightning behind everything, bevelled gold (#FFD400 / #FFC928 / #BF7F00) on the hero line, brushed chrome on the supporting line. This is the default and the one to use unless there is a reason not to."},
  {"id":"card","label":"Rare Pokémon card","instruction":"Treat the whole graphic as a single rare holographic Pokémon card: a defined card border framing the entire piece, holo foil sheen washing across the background, subtle rainbow refraction catching the edges, and a surface texture that reads as premium foil stock rather than paper. Keep the blue-and-gold house palette underneath it."},
  {"id":"gold","label":"Gold","instruction":"Drop the blue entirely. Pure black ground with metallic gold as the only accent — gold lightning, gold panel borders, gold bevelled headline (#FFD400 / #FFC928 / #BF7F00), warm highlights. Restrained and expensive."},
  {"id":"red","label":"Red","instruction":"Swap the electric blue energy for deep crimson lightning and glow (#E1252B through the middle of a strike, darker at the edges). Keep the gold headline and gold panel borders exactly as they are — red replaces the blue, it does not replace the gold. Be careful that the background red never sits next to a red down-badge, or the two read as the same thing."},
  {"id":"green","label":"Green","instruction":"Swap the electric blue energy for emerald lightning and glow. Keep the gold headline and gold panel borders. Green also marks a price rise (#008000), so keep the background green deeper and cooler than the badges — the two must never read as the same thing."},
  {"id":"purple","label":"Purple","instruction":"Swap the electric blue energy for violet lightning and glow (#7C3AED), with a magenta edge on the brightest strikes. Keep the gold headline and gold panel borders."},
  {"id":"orange","label":"Orange","instruction":"Swap the electric blue energy for burning orange lightning and glow (#FFAA00). Orange sits close to the gold, so push the headline gold brighter and its outline heavier — otherwise the type sinks into the background."},
  {"id":"white","label":"Clean white","instruction":"Invert the ground: white (#FFFFFF) to pale silver, keeping blue (#007FFF) and gold (#FFC928) as the accents. Headline in bevelled gold with a dark outline so it still separates. Panels become white with grey borders and a soft drop shadow. For print and flyers, where a black background drinks ink."}
]'::jsonb,

shapes = '[
  {"id":"square","label":"Square — Facebook / Instagram post","instruction":"Square, 1:1, 2048x2048. This is the feed format and the most common one."},
  {"id":"tall","label":"Tall — story, phone wallpaper, print","instruction":"Portrait, 4:5 to 2:3, at least 2000px on the long edge. Leave a little clear space top and bottom so nothing important sits under a story interface."},
  {"id":"wide","label":"Wide — Facebook cover / banner","instruction":"Landscape banner, roughly 16:9. Keep the important content centred — the edges get cropped differently on every device."}
]'::jsonb,

attachments = '[
  "The Infinite Pulls logo — brand-kit/logo-full.png",
  "The QR code — brand-kit/infinite-pulls-qr-code.png",
  "An example poster, so it can copy the style — brand-kit/poster-example2.jpg",
  "The colours — brand-kit/colors.txt"
]'::jsonb

where slug = 'poster';

-- ============================================================
-- What you should see: one prompt row, eight colours, three shapes, three
-- files to attach, and five brand files on record.
-- ============================================================
select
  (select jsonb_array_length(options)     from public.marketing_prompts where slug='poster') as colours,
  (select jsonb_array_length(shapes)      from public.marketing_prompts where slug='poster') as shapes,
  (select jsonb_array_length(attachments) from public.marketing_prompts where slug='poster') as files_to_attach,
  (select count(*) from public.marketing_assets)                                             as brand_files;
