-- ============================================================
-- MARKETING — the poster prompt, rewritten whole.
--
-- SAFE AGAINST LIVE DATA. Rewrites the template on one row. Creates
-- nothing, drops nothing, touches no other table. Safe to re-run: it sets
-- the text rather than patching it, so running it twice leaves the same
-- result.
--
-- REQUIRES marketing.sql and marketing_poster.sql.
-- SUPERSEDES marketing_files_by_url.sql — everything that file added is
-- folded in here. You do not need to run it again, and if you already did,
-- this simply replaces its work with the same thing plus the fix below.
--
-- WHY A WHOLE REWRITE RATHER THAN ANOTHER PATCH
--
-- The last two changes were replace() surgery on a string. That works
-- twice. By the fourth time it is a stack of edits nobody can read, where
-- one changed comma makes an edit silently miss. The template is small
-- enough to just state in full, so it is stated in full, and this file is
-- now the one place the poster prompt lives.
--
-- WHAT ACTUALLY CHANGED — "THE FACTS"
--
-- The old wording said: read the source page, and if you cannot read it,
-- stop. ChatGPT did exactly that. He pointed it at a PokéData card page,
-- which builds its prices after login, so the fetch came back with no
-- figures in it -- and the model stopped and asked him for a screenshot
-- rather than inventing prices. Correct behaviour, wrong outcome.
--
-- The rule was written as though every poster is a price post. Most are
-- not. A set landing, an event, a restock, new opening hours -- none of
-- those have a number on them, and the old prompt treated a missing figure
-- as a dead end instead of as the normal case.
--
-- So the rule is split into the two things it was conflating:
--
--   1. NEVER MAKE A NUMBER UP. Unchanged, and if anything said harder,
--      because this is the one that protects him. A wrong price on a
--      poster taped in the shop window is not a typo, it is an argument
--      at the counter.
--
--   2. A poster with no numbers is a finished poster. New, and the whole
--      point. No figures given means draw it without figures -- do not
--      hunt for some, do not stop and ask.
--
-- And a middle path for when a fact really is needed and really is not
-- available: leave the gap, design around it, and say so in one line. A
-- hole he can see beats a number he cannot check.
-- ============================================================

update public.marketing_prompts set

blurb = 'Fill this in and it writes the prompt for you. Send it to ChatGPT and hit the arrow — it fetches the brand files itself.',

template =
E'You are a senior graphic designer producing a promotional graphic for Infinite Pulls, a Pokémon TCG and hobby shop.\n'
|| E'\n'
|| E'The example posters linked below ARE the brand. Study them before you draw anything: the goal is a graphic that sits beside them and looks like the same shop made it on the same day.\n'
|| E'\n'
|| E'THE GRAPHIC\n'
|| E'{{title}}\n'
|| E'{{notes}}\n'
|| E'\n'
|| E'THE FACTS\n'
|| E'Everything factual on this graphic has to be real — card names, set names, card numbers, prices, percentages, dates, times, opening hours. Do not invent one, do not round one, do not estimate one, and do not fill one in from memory.\n'
|| E'Read this page and take the real figures off it. If you cannot open it, or it loads without the figures on it, say so in one line and ask me for the numbers rather than guessing: {{source}}\n'
|| E'Plenty of posters have no figures on them at all — a set landing, an event, a restock, an announcement. If no numbers are given to you, that is not a problem to solve and not a reason to stop. Make the poster without them. Do not go looking for numbers to add, and do not add one because a panel looks like it wants filling.\n'
|| E'If a fact is genuinely needed and you genuinely cannot get it, leave it off, design around the gap, and tell me in one line what you left out. A blank space is something I can fix in a minute. A wrong price printed and taped up in the shop window is not.\n'
|| E'\n'
|| E'THE FILES — fetch these first\n'
|| E'Open these before you draw anything. They are public, no login needed. If any will not load, say which one and stop rather than approximating it from memory:\n'
|| E'- Logo (use exactly as-is, never redraw): https://infinitepulls.com/brand-kit/logo-full.png\n'
|| E'- QR code — PLACE THIS FILE, NEVER DRAW ONE: https://infinitepulls.com/brand-kit/infinite-pulls-qr-code.png\n'
|| E'- Example poster, square — THIS IS THE HOUSE STYLE: https://infinitepulls.com/brand-kit/poster-example2.jpg\n'
|| E'- Example poster, tall: https://infinitepulls.com/brand-kit/poster-example1.png\n'
|| E'- The exact brand colours: https://infinitepulls.com/brand-kit/colors.txt\n'
|| E'\n'
|| E'If you cannot fetch images from a link, say so in one line and ask me to attach them — do not carry on and invent a logo.\n'
|| E'\n'
|| E'THE QR CODE — READ THIS TWICE\n'
|| E'The QR code is not artwork. It is a machine-readable pattern, and every square in it carries data.\n'
|| E'- Place the supplied PNG exactly as it is. Pixel for pixel.\n'
|| E'- Do NOT redraw it, regenerate it, trace it, restyle it, recolour it, round its corners, add a logo to the middle, put a gradient on it, add a border inside it, or "clean it up".\n'
|| E'- Do NOT generate your own QR code for infinitepulls.com. Yours will not be the same code.\n'
|| E'- Scale it only in proportion, keep it perfectly square, and leave clear white space around all four sides.\n'
|| E'- Black on white only. Never invert it, tint it gold, or place it on a dark panel.\n'
|| E'WHY THIS MATTERS: a redrawn QR code is not a slightly imperfect QR code. It is a dead one — it either fails to scan or sends people somewhere else, and it looks completely fine while doing it. The poster goes up in the shop and every customer who scans it gets nothing.\n'
|| E'If you cannot place the exact supplied file, leave a plain white square where it goes and tell me in one line. Do not substitute one you have made.\n'
|| E'\n'
|| E'HOUSE STYLE — this is not a suggestion\n'
|| E'- Background: pure black (#000000) with electric-blue energy and forked lightning radiating from behind the content. Deep, glossy, high contrast.\n'
|| E'- Blue works in three depths: #3F9FFF at the brightest part of a strike, #007FFF through the middle, #0054FF sinking into the corners.\n'
|| E'- Gold lightning bolts used as punctuation and separators, never as decoration for its own sake.\n'
|| E'- Headline type: heavy condensed italic sans, all caps, tightly set. The supporting line in brushed chrome/silver; the line that matters in bevelled 3D gold. The gold needs all three of its shades to read as metal rather than as flat yellow: #FFD400 on the top bevel, #FFC928 across the face, #BF7F00 in the shadow. Thick black outline and an outer glow on both, so they hold up on a phone.\n'
|| E'- Content sits in rounded rectangular panels on near-black, each with a thin gold border and a soft inner shadow.\n'
|| E'- Anything that went UP gets a solid green (#008000) badge with white text. Anything that went DOWN gets red (#E1252B). Those two colours mean only that and are never used decoratively.\n'
|| E'- Real Pokémon card art, shown as a card, in its own gold-bordered frame.\n'
|| E'- The Infinite Pulls logo from the linked file, unaltered — same proportions, same colours, no redraw.\n'
|| E'- Bottom band: the supplied QR code file on a clean white square, the words SCAN TO START YOUR COLLECTION, and INFINITEPULLS.COM.\n'
|| E'\n'
|| E'ACCENT\n'
|| E'{{palette}}\n'
|| E'\n'
|| E'SHAPE\n'
|| E'{{shape}}\n'
|| E'\n'
|| E'RULES\n'
|| E'- If there are prices or percentages on it, every one matches the source exactly, to the cent and to two decimal places.\n'
|| E'- Every card name, set name and card number is spelled exactly as the source has it. If I gave you no source, use only the names I typed in — never one you remembered.\n'
|| E'- Write like a shop talking to collectors who already know the hobby. No "hey kids", no stacked exclamation marks, no talking down, no clip-art enthusiasm.\n'
|| E'- Big enough to read at arm''s length on a phone. If something will not fit legibly, cut an item rather than shrinking the type.\n'
|| E'- No lorem ipsum, no placeholder boxes, no "your text here". Every word on the finished graphic is real.\n'
|| E'- The QR code is the supplied file, placed unaltered. Not one you drew. See THE QR CODE above.\n'
|| E'\n'
|| E'BEFORE YOU DRAW\n'
|| E'If the graphic has figures on it, list them first — card name, set, current price, previous price, percentage — so I can check them before you draw. If it has no figures on it, say "no figures on this one" and go straight to drawing.',

-- Attaching is the fallback now, not the first move.
attachments = '[
  "Nothing, usually — the prompt links to the files and ChatGPT fetches them.",
  "If it says it cannot open the links, attach these three: the logo, the QR code, and the square example poster.",
  "Always scan the QR code on the finished poster with your own phone before you post it."
]'::jsonb

where slug = 'poster';

-- ============================================================
-- Check: every row should say true, and the prompt should be about 5700
-- characters. A false anywhere means the update did not land on the row.
-- ============================================================
select
  template like '%THE FACTS%'                          as facts_section_is_in,
  template like '%no figures on this one%'             as no_figures_is_ok,
  template like '%not a reason to stop%'               as wont_dead_end_on_a_missing_number,
  template like '%do not fill one in from memory%'     as still_cannot_make_one_up,
  template like '%READ THIS TWICE%'                    as qr_rule_is_in,
  template like '%brand-kit/logo-full.png%'            as links_the_files,
  template not like '%WHERE THE NUMBERS COME FROM%'    as old_wording_is_gone,
  length(template)                                     as prompt_characters
from public.marketing_prompts where slug = 'poster';
