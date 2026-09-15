# Site audit — what the new design has not accounted for

Read from the source on 15 Sep 2026, against the old app's `components/navbar.js`
(which is the authoritative list of what a person can actually reach) and the new
feed's `menuHTML`, `mineHTML` and `shopHTML`. Nothing here is from memory.

---

## 1. One thing that is broken right now

**CARD DETAILS is a dead link on every collection card in the feed.**

`pillLinks()` builds it as:

```
/<username>/collection/<card-slug>
```

Those pages have never been generated. `tools/build-gallery-pages.mjs` writes to
`/pulls/` only, and `tools/build-post-pages.mjs` writes `/<username>/post/<id>/`.
I listed `tacomike417/` on your machine: it contains `post` and nothing else. Same
for all six accounts that have generated pages.

`404.html` rescues `/<user>/post/<id>` and nothing else, so this falls through to a
real GitHub Pages 404.

It is live now, on most posts in the feed, because most posts are collection cards.
Three ways out, and this is a decision rather than a fix I should just pick:

| | |
|---|---|
| **Build the pages** | A third builder, or a mode on the post builder. More SEO surface — a page per card per collector. Biggest job of the three. |
| **Point it at the post permalink** | `/<user>/post/c-<id>` already exists and already has the picture, the caption and the OG tags. One line. But then CARD DETAILS and SHARE go the same place, which is the "two buttons, one destination" problem you had me remove once already. |
| **Drop the pill on collection cards** | It already only appears on shop cards when there is something behind it. Two pills instead of three on a collection card is honest. |

---

## 2. What loses its only door the moment you flip

These exist, work, and are reachable **only** from the old navbar. When `/` becomes
the feed, nothing in the new design points at any of them.

| Thing | Where it was | Still exists? |
|---|---|---|
| **Card Lookup** | Its own slot in the old bar, top five | Yes — `components/card-lookup.js`, 84 KB |
| **Movers & Shakers** | Menu → Your stuff | Yes — `components/movers.js` |
| **About Infinite Pulls** | Menu → The shop | Yes, and it is in `sitemap.xml` |
| **Infinite Questions** | Menu → The shop | Yes — **767 files** of static SEO pages |
| **The Gallery** | Menu → The shop, and a home tile | Yes — you have called this one: dropping |
| **Events** | Menu, hidden until filled | Never filled |
| **Deals & Specials** | Menu, hidden until filled | Never filled |
| **`/pulls/` photo posts** | Home gallery tile | Yes — 2 posts, both in `sitemap.xml` |

**Card Lookup is the one I would look at hardest.** The feed's own search
(`searchAll`) covers three things: people, the shop's shelf, and cards that people
in the roster already own. It does **not** search the card catalog. So "what is this
card worth" for a card nobody in the app owns has no entry point at all in the new
design. The LOOK UP pill on a post reaches it, but only with a card already in hand
— you cannot open it cold.

**Infinite Questions is 767 pages of Google bait** with no link from the site once
the old menu goes. It keeps ranking on its own for a while; internal links are part
of why it ranks at all.

---

## 3. What is safely covered (so you can stop worrying about these)

| Old | New route in |
|---|---|
| Home | FEED |
| Shop | SHOP sheet → Browse the shop |
| My Collection | COLLECTION sheet, and the MENU |
| My Wish List | COLLECTION sheet |
| My Pokédex | COLLECTION sheet |
| My Infinite Rewards | COLLECTION sheet, when the shop has it switched on |
| My Account | MENU |
| Collector Goals | MENU |
| Hours / Location / Contact | SHOP sheet |
| Collection import | Inside My Collection, which has a door |
| Sealed products, barcode scan, notify invite, price trend | Inside pages that have doors |

---

## 4. The old home page is six things, and five have nowhere to go

`/` today is not one page — it is a stack, and flipping replaces all of it:

1. **The logo hero** — fine to lose
2. **The scoreboard** — three live numbers (`home-stats.js`), above the fold on a phone
3. **The quick rail** — six chips at thumb height (`home-rails.js`)
4. **The gallery tile** — you are dropping this
5. **Jeff's tutorial videos** — a rail that renders nothing until he adds one (`home-rails.js`)
6. **home-mine** — My Collection / Collector Goals / Infinite Rewards for a signed-in
   collector who owns cards

You already flagged the gallery and videos as "continuing below the feed." The one
I would think about separately is **the scoreboard** — three numbers that say the
place is alive, in the highest-value spot on the site, seen by everybody including
people with no account. The feed's first screen says nothing equivalent. Jeff's
pinned welcome post is the closest thing and it retires itself once somebody adds
their first card.

---

## 5. Outside the nav, but still yours to decide

- **The admin panel** — 20 files under `/admin/`. Untouched by the flip and has its
  own door. Worth confirming Jeff still reaches it the same way after `/` changes.
- **`sitemap.xml` points at pages that are about to lose their links** — `?page=gallery`,
  `?page=events`, `?page=deals`, `?page=about`. `build-gallery-pages.mjs` rewrites
  this file, so whatever you decide has to be decided there, not by hand.
- **`post-sitemap.xml` is separate** and is not referenced from `sitemap.xml` or, as
  far as I can see, `robots.txt`. Worth checking before you submit it to Search Console.
- **Both workflows exist now** — `.github/workflows/gallery-pages.yml` and
  `post-pages.yml` are on your machine. Post pages have run: 159 generated across six
  accounts.
- **`?page=thanks`** — the post-checkout page. Reached from the checkout flow, not the
  nav, so it survives. Just noting it so it is not a surprise.
- **The old chrome** — `topbar.js` and `breadcrumb.js` become dead weight once `/` is
  the feed. Not urgent, but they are loaded on every page today.

---

## 6. What only you can answer

1. **CARD DETAILS** — build the pages, point it at the permalink, or drop the pill?
2. **Card Lookup** — does it get a door in the new design, or does the feed's search
   grow to cover the catalog? Right now neither is true.
3. **The scoreboard** — does "this place is alive" belong somewhere on the new first
   screen, or does the feed itself do that job?
4. **Movers & Shakers** — real feature, no door. Keep it, fold it into the feed as a
   kind of post, or retire it?
5. **Infinite Questions** — 767 SEO pages. A footer link somewhere, or let it stand
   on its own?
6. **About / Events / Deals** — About is real and in the sitemap; the other two have
   never had content. Fold About into the SHOP sheet as a fifth row?

---

## What I did not check

- The admin panel's internals — I listed the files but did not read them.
- Whether every `?page=` route still renders correctly today. I confirmed the routes
  exist in `app.js` and that the components are still present and still loaded by
  `index.html`; I did not open each page.
- `infinite-questions` content quality or whether its 767 pages are currently indexed.
