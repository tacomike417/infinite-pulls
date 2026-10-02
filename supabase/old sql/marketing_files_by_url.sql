-- ============================================================
-- MARKETING — fetch the brand kit by URL, and never redraw the QR code.
--
-- SAFE AGAINST LIVE DATA. Rewrites two fields on one row. Safe to re-run:
-- the whole edit is skipped if it has already been applied, so running this
-- twice cannot paste the same block in twice.
--
-- REQUIRES marketing.sql and marketing_poster.sql.
--
-- WHY — THE FILES
--
-- A URL cannot carry a file. So the first version listed what to attach and
-- left him to drag three things in, and ChatGPT -- correctly -- opened by
-- asking for them. That is a step, and a step is where somebody stops.
--
-- The kit is public: /brand-kit/ is served straight off the site. So the
-- prompt can simply say where the files are and let ChatGPT go and get
-- them. No attaching, no dragging, nothing to forget.
--
-- What this does NOT promise: fetching a logo from a URL is not identical
-- to attaching it. Reading an image over the web is reliable; using it as a
-- faithful visual reference while GENERATING a new image is less so, and it
-- may still come back having approximated the logo. So the attach list
-- stays as the fallback and the prompt says so in a line it is told to act
-- on. He is not stuck either way.
--
-- WHY — THE QR CODE
--
-- It was redrawing it. An image model sees a QR code as a black-and-white
-- pattern and cheerfully draws something that looks like one -- and a
-- redrawn QR code is not a slightly-wrong QR code, it is a dead one. It
-- either fails to scan or resolves somewhere else entirely, and NOBODY CAN
-- TELL BY LOOKING. The poster goes up in the shop, it looks perfect, and
-- every customer who scans it gets nothing.
--
-- That is a different class of error from "the gold looks flat", so it gets
-- its own rule, said in three places, and it is told WHY -- a model given
-- the reason complies far more reliably than one given an instruction.
--
-- NOTE ON THE SQL: both edits are nested into ONE assignment. Postgres
-- refuses two `template =` clauses in a single UPDATE, which is what the
-- first draft of this file tried to do.
-- ============================================================

update public.marketing_prompts set

template = case
  -- Already applied. Leave it exactly as it is -- including any wording you
  -- have since changed by hand in the panel.
  when template like '%READ THIS TWICE%' then template
  else
    replace(
      replace(
        template,
        E'HOUSE STYLE — this is not a suggestion',
        E'THE FILES — fetch these first\n'
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
        || E'HOUSE STYLE — this is not a suggestion'
      ),
      -- Said once more at the end of RULES: the last thing read before it draws.
      E'- No lorem ipsum, no placeholder boxes, no "your text here". Every word on the finished graphic is real.',
      E'- No lorem ipsum, no placeholder boxes, no "your text here". Every word on the finished graphic is real.\n'
      || E'- The QR code is the supplied file, placed unaltered. Not one you drew. See THE QR CODE above.'
    )
end,

-- Reworded: attaching is now the fallback, not the first move.
attachments = '[
  "Nothing, usually — the prompt links to the files and ChatGPT fetches them.",
  "If it says it cannot open the links, attach these three: the logo, the QR code, and the square example poster.",
  "Always scan the QR code on the finished poster with your own phone before you post it."
]'::jsonb

where slug = 'poster';

-- ============================================================
-- Check: every row should say true, and the prompt should be about 5000
-- characters. If qr_rule_is_in says false, the edit did not land.
-- ============================================================
select
  template like '%brand-kit/logo-full.png%'      as links_the_logo,
  template like '%brand-kit/infinite-pulls-qr%'  as links_the_qr,
  template like '%poster-example2.jpg%'          as links_the_example,
  template like '%READ THIS TWICE%'              as qr_rule_is_in,
  template like '%See THE QR CODE above%'        as qr_rule_repeated_at_the_end,
  template like '%BEFORE YOU DRAW%'              as still_shows_its_working,
  length(template)                               as prompt_characters
from public.marketing_prompts where slug = 'poster';
