# Infinite Questions

364 questions and answers at `infinitepulls.com/infinite-questions/`, one
static page each. This is Google fodder first and a good read second: every
page is plain HTML with no JavaScript needed to read it, so a crawler gets
the whole answer on the first request.

## Building it

    node tools/build-questions.mjs
    node tools/check-questions.mjs

The first writes every page. The second reads them all back and fails loudly
if anything is missing, broken or orphaned. **Run both after any change**,
and commit what they produce — GitHub Pages serves the built files, so a page
that is not committed does not exist.

## What is a source file and what is not

| Committed, and edited by hand | Committed, but written by the builder |
|---|---|
| `entries.json` — every question and answer | `<slug>/index.html` × 364 |
| `style.css` — one stylesheet, all 365 pages | `index.html` — the hub |
| `avatars/*.webp` — 30 readers plus Jeff | `sitemap.xml` |
| `og.png` — the share card | |

Editing a built page is wasted work: the next build overwrites it. Fix the
answer in `entries.json` and build again.

## How it decides things

**Topics.** Nothing arrived tagged, so `build-questions.mjs` sorts each entry
by the words in it. The first matching bucket wins, which is why the list is
ordered specific-to-broad — a question about a fake card mentioning "sell"
is about fakes, not about selling. Retune the regexes there, not by hand.

**Further reading.** The three suggestions under each answer are the entries
sharing the most uncommon words, with same-topic worth a point, tie-broken by
entry number. Deterministic on purpose: two builds must produce byte-identical
files or every rebuild churns 364 files in git.

**Cross-references.** 56 answers name another reader. The copy never says
*which* of that reader's questions it means, so the build links the closest
one they asked earlier and labels it as that reader's question rather than
claiming it is the exact one Jeff had in mind.

## Deliberately absent

**Dates.** Nothing here is news and none of it goes stale, so no entry carries
one. A visible date on evergreen answers only ever ages them, and inventing
publication dates for a year of undated copy would be a lie in the markup.

**A comments box, a form, an account.** Nothing on these pages talks to a
server. That is what makes them fast and what keeps them out of the app's
moving parts.

## Avatars

30 reader avatars plus Jeff, at 144px WebP — 195 KB for all 31, down from the
55 MB of source PNGs in the delivery zip. The filename is the username with
everything that is not a letter or a digit removed, because that is the rule
the pages use to build the `src`. `@PopulationOne-ish` is
`populationoneish.webp`; getting that wrong is a 404 on twelve pages with
nothing to announce it, which is exactly what `check-questions.mjs` caught.

## After deploying

Submit `https://infinitepulls.com/infinite-questions/sitemap.xml` in Google
Search Console. There is no root `sitemap.xml` in this repo to add it to, and
a section submitted directly gets crawled just the same.

The reader questions and names are fictional editorial copy, and every page
says so in its footer.
