# The Gallery — how it works

## For him

`/admin/` → **Gallery**.

Three cards, in the order he meets them.

**Master Switch** is everything that can be turned on or off, in one
place. The gallery itself, whether customers can send photos in, whether
the caption helper appears, reactions, and the tile on the home page.
Anything switched off stays switched off until he says otherwise, and
nothing already posted is lost either way.

**Post a photo** is the whole job:

    Add a photo  →  tap what it is about  →  tap the caption he likes  →  Post it

Nothing on that form is required. A bare photo with no caption still
publishes and still gets a sensible page built around it. If he gets
called away mid-post — and he will — the photo and everything with it is
still sitting there when he comes back, because the draft is kept in the
browser rather than in the form.

The moment it goes live he gets the link to share, the square and story
versions to save for Instagram, the hashtags on their own, and a separate
**Let them know about this** button. That last one sends a notification to
every phone that has them turned on. It cannot be recalled and it works
once. Everything else on the page can be edited or taken down afterwards.

**Waiting for you** is anything customers have sent in. Nobody but him can
see it until he taps *Put it up*. *Not this one* does not delete anything
— it goes to a bin it can be pulled back out of for 30 days, because it is
somebody else's photo and they may not have another copy.

Below that is what he has already posted, and what each one did: how many
people looked, liked and shared it. That is the part worth checking in the
morning.

---

## For you

### Where the writing lives

The caption prompt is **not** in the JavaScript. It is a row in
`marketing_prompts`, slug `gallery-caption`, edited at:

    /admin/?prompts=1

Same editor the poster prompt uses. Change the wording, save, and the next
photo he posts uses it. No commit, no deploy. He never sees that editor.

The chips he taps — Just Pulled, Restock, Case Break and the rest — are the
`options` on that same row, exactly like the poster's palette. `label` is
the word on the button; `instruction` is the sentence that actually
reaches the model. So the shop's categories can change without a deploy
either.

### The guardrails are code, not requests

Worth being clear about, because it is the reason he can be trusted with
this and a plain text box would be a problem.

The prompt asks for 8–18 words, one keyword used once, no urgency
language, and could-never-should. `supabase/functions/gallery-caption`
then **checks all of it and rejects the answer if it is wrong**, feeds the
problem back, and asks again. Anything that fails twice never reaches the
panel — he gets a plain caption box instead, which is a fine outcome.

The never-write list is the `BANNED` array in that function. Add to it
there, not in the prompt, if something slips through.

He picks from three. There is no "make it funnier" input anywhere, on
purpose.

### Why 8–18 words

Facebook posts of 80 characters or fewer see meaningfully higher
engagement, because past roughly that length Facebook folds the rest
behind *See More* and most people never open it. 80 characters is about 13
words. Instagram's sweet spot is a little longer, so a caption written to
the Facebook number works on both and the reverse is not true.

### Why the SEO text is separate from the caption

You cannot fit a keyword three times into thirteen words without it
reading like spam. So the keyword appears **once, naturally, in the
caption**, and its variants live in the slug, the page title, the alt text
and the meta description — where Google reads and no customer looks.

### The pages Google and Facebook actually see

`components/gallery.js` renders `/pulls/<slug>` for a person browsing the
app. That is not what a crawler gets.

Facebook's crawler does not run JavaScript, and GitHub Pages answers a
clean path with `404.html` at an actual HTTP 404 status — so a photo page
that only existed in JavaScript would unfurl with the site's generic card
and would never be indexed. Both failures are silent and look fine to
anybody testing by clicking around.

So `tools/build-gallery-pages.mjs` writes a genuine file at
`pulls/<slug>/index.html`, with the preview tags baked in and the caption
in the HTML. `.github/workflows/gallery-pages.yml` runs it. It needs no
secrets — it reads the public Supabase URL and anon key out of `config.js`
and only ever reads published photos.

It also writes `sitemap.xml` with `<image:image>` entries. For a shop
whose customers search Google Images for card names, that is the half that
matters.

**Set up the webhook** (in the workflow file's own comments) and a page is
live within seconds of him posting. Without it the schedule catches it
within ten minutes, and the panel already tells him the preview takes
about a minute.

### Old links never die

Every address a photo has ever had is kept in `gallery_slug_aliases`, and
the trigger that records them cannot be forgotten. Rename a slug and the
old one keeps working — as a `noindex` redirect that canonicals to the new
address, so the two never compete in search.

This matters more than it sounds. A link Jeff posted to Facebook in March
lives on his page forever. Breaking it later is the kind of thing nobody
would ever tell him about.

### Nothing hard-deletes

`status` goes `draft → pending → published → hidden → trashed`, and
`trashed` is a 30-day bin. `gallery_empty_bin(30)` actually removes rows
and is deliberately **not** scheduled — call it from the same daily cron as
the price alerts if you want it, or leave it and the bin keeps everything.
Doing nothing is the safe failure.

Note it only removes the row. Image files stay in the bucket, because a
storage delete is the one genuinely irreversible thing in this feature.

### There are no comments, on purpose

Reactions are a tap and cannot turn on the shop. A comment thread is a job
somebody does every day and the surface most likely to produce a bad
afternoon. If comments are ever wanted they are a new table and a switch —
not a change to anything here.

### The language

Could, never should. Every number in the panel counts up and is a
challenge, never a scold: "three up this week", "that number is beatable",
and never "you haven't posted since Tuesday". Guilt works on fitness apps
because people already feel bad about the gym. On a man running a shop
alone it produces avoidance, and he stops opening the panel.

There are tests that fail the build if "should" or scolding language turns
up in a user-facing string. Keep them.

---

## Setup

In order. All of it is safe to re-run.

1. `supabase/admin_lockdown.sql` — if it has not been run already. The
   gallery's policies depend on `is_shop_staff()`.
2. `supabase/marketing.sql` — if it has not been run already. The caption
   prompt is a row in its table.
3. `supabase/gallery.sql` — tables, storage bucket, policies, Master
   Switch.
4. `supabase/gallery_caption.sql` — the prompt and the chips.
5. Deploy the caption writer and give it a key:

       supabase functions deploy gallery-caption
       supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

   `OPENAI_API_KEY` works instead if you would rather. `CAPTION_MODEL`
   overrides the default model on either.
6. Commit `.github/workflows/gallery-pages.yml` and run it once by hand
   from the Actions tab, to check it can write to the repo.
7. Optional, and it is the difference between "seconds" and "up to ten
   minutes": the Supabase webhook described in the workflow's comments.

Then open `/admin/` → Gallery, turn the Master Switch on, and post
something.

Customer submissions are **off** by default. Turn them on when there is
somebody willing to look at the queue.
