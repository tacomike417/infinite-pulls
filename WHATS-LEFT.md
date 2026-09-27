# Infinite Pulls — the one list

Last updated 26 September 2026.

**This is the only to-do list.** On 26 Sep every open item from every
planning file (SOCIAL-NEXT, EDITIONS-NEXT, FEED-NEXT, GOALS-NEXT,
MOVERS-NEXT, SHOP-NEXT, CARD-ART-NEXT, SITE-AUDIT, SEASON-26, SEASON-26-FIFTY,
REWARDS-FLOW, STORE-PLAN, FINISH-TODAY, DROP-RADAR, GALLERY, INFINITE-DEX)
was pulled in here. Those files are now **reference only** — design detail
and history. When something new comes up, it goes HERE, not in a new file.
The file named after each item is where its full write-up lives.

Ask Claude to pull this up and it will know where things stand. Nothing here
is on fire. The app works.

---

## Coming up (dates)

- **Mon 28 Sep** — Email every distributor the Retailer Packet (Mike + Claude). *SOCIAL-NEXT*
- **Mon 28 Sep** — Dex scanner partnership email: API/embed/licensing, cost, rate limits, branding, does it return card id + set + number. *SOCIAL-NEXT*
- **Tue 6 Oct** — Start the Facebook foot-traffic ads. Waiting on Jeff's shop photos. *SOCIAL-NEXT*
- **Early Oct** — Growth Streak goal can switch on (needs a month of snapshots, started 7 Sep). *GOALS-NEXT*
- **~26 Oct** — Revisit helping people FIND the house accounts (see House accounts below).
- **Mid-Dec** — Swap Hyde-Bot's Facebook token for a System User token (full note at the bottom).

---

## Waiting on Jeff

- **His new YouTube channel** → then the LIVE ring on his photo, the Start-here card turning into the stream with BID/SHOP, the Go Live page and first stream. `supabase/live_status.sql` is written, not run. *SOCIAL-NEXT Part 7*
- **Shop answers:** markup $1 or $2, the bulk floor, the price-alert rule, and how Make Offer works (auto 95% / review each / per-item floor). Scanner "Add to Clover" is blocked on these. *SHOP-NEXT*
- **Rewards:** fixed dollars or percent, the four amounts (5/10/15/25), and a register test (make "Infinite Dex $5" on Clover, check it takes exactly $5 off). ⚠ Two plans disagree: REWARDS-FLOW says four dollar tiers, SEASON-26-FIFTY says one 50-cards → 10% off tier. REWARDS-FLOW is the newer word. *REWARDS-FLOW*
- **What's in his case** → fills `chase_list`, which unlocks 6 goals. *GOALS-NEXT*
- **Sales tax** — ask his bookkeeper before the first out-of-state sale. *STORE-PLAN*
- **Tell Jeff** (Mike): nobody can reach the 10%-off reward in under ~3 months. *SEASON-26-FIFTY*

---

## Needs Mike's decision

- **Card Lookup** — a second search screen behind the gold SCAN A CARD ring. Kill it and point all seven links at My Collection, or teach My Collection `?scan=1`/`?q=` and redirect. *EDITIONS-NEXT, SITE-AUDIT*
- **CARD DETAILS pill** on collection cards is a dead link — build the page, point it at the permalink, or drop the pill. *SITE-AUDIT*
- **Movers & Shakers** after the feed flip — keep a door to it, fold it into the feed, or retire it. Plus the parked $500+ board (tier chips on the existing board is the lean). *MOVERS-NEXT, SITE-AUDIT*
- **The scoreboard numbers** — keep them somewhere on the first screen? *SITE-AUDIT*
- **Infinite Questions** — 767 SEO pages with no link; add a footer link? *SITE-AUDIT*
- **About / Events / Deals** — fold About into the SHOP sheet? *SITE-AUDIT*
- **Duplicate cards in Clover** — match on SKU and bump stock instead of adding twice? *SHOP-NEXT*
- **"Earned and stays earned"** — store goal progress when it changes (plus a toast when a badge lands). Unlocks badges in the feed header, a goal timeline, and reward card #41 The Oathkeeper. *GOALS-NEXT, FEED-NEXT, SEASON-26-FIFTY*
- **Small badge art** for the feed header — simplified small art, or a name + color. *FEED-NEXT, GOALS-NEXT*
- **Ask what they paid** (optional) so a card can show gain/loss? *FEED-NEXT*
- **Species Quest / Illustrator Archive** need a target number. **Birth-Year Binder** needs birth years (kids use this — careful). *GOALS-NEXT*
- **Reward cards 28 / 50 / 46** (Appraiser, Thousand, Climber) rely on a collection value the phone writes — OK to count toward the discount? *SEASON-26-FIFTY*
- **Shop purchases tied to an account** — `shop_holds` has no user, so there can't be a "bought something" card. *SEASON-26*
- **Card art hosting** — hotlink pkmncards or copy to R2 (licensing). And do Japanese cards need art at all (9,341 missing)? *CARD-ART-NEXT*
- **Jeff undoing a redemption** — an admin undo button that logs who and when? *REWARDS-FLOW*

---

## Social pack (decided 27 Sep 2026)

- **DONE 27 Sep:** @mentions notify (#1) · Report + block (#11) · View counts (#12) · Edit caption (#13) · Turn-on-notifications nudge (#2) · Hot this week strip (#8) · Streaks on profiles (#9) · Share to your story with QR (#4) · Invite friends — INVITE FRIENDS button, newcomer auto-follows you, "joined from your invite" alert (#5). · Share as a post (feed size) next to share to story · **Notifications dropdown (Jeff, 27 Sep):** the bell opens a Facebook-style list — who did what, post picture on the right, New/Earlier; tapping a comment opens the post with that comment lit up and the reply box aimed at it. Phone on/off switch moved inside it. Restyled 27 Sep to the "A+" look Mike picked: white card, holo-foil strip, ∞ title, brand orange-pink (not Facebook blue), kind badges on faces, Follow back in the row. Arriving from a notification the post says what happened ("💬 @Jefleppard commented on this") with "See your other notifications" under it; reward-card posts now open from links; phone pushes land in the same spot. · **More than one picture per post (27 Sep):** up to 10; pick several at once in Make a post, remove or add more before sharing; swipe with dots and 1 / N in the feed; stack mark on grid tiles (multi_photo.sql). · **Feed leans newer (Jeff, 27 Sep):** still one person at a time, but people who posted in the last day get the first seats, newest first; last week next; everyone else after. Photo posts count fresher than card adds (feed_fresh.sql). · **New this week (Jeff, 27 Sep):** a row above the videos (after the 10th post) of people who joined in the last 7 days, with FOLLOW on each; only once they have a profile picture and a post or card; house accounts left out (new_members.sql). · **Suggested for you (27 Sep):** a row after the 5th post — only people ACTIVE in the last 14 days (posted, commented, added cards), ranked by how active they are with mutual follows as a boost, with a reason line and × to hide. OFF until 50 public members, then turns on by itself; staff can preview it with ?suggest=1 (suggested_follows.sql). · **Profile score + Say hi (Mike, 27 Sep):** "Your profile is 40% done" card at the top of the feed (next step + SEE ALL) and a chip on your own profile. Five easy steps, 20% each: picture · bio · claim your badge & tagline · scan your first card · **Say hi** (Say hi only for members under 30 days old who haven't posted a photo — everyone else gets the first four, 25% each) — a hello picture made for them (photo in the ring, JUST JOINED @name, tagline, first card, their profile QR with no words by it), caption pre-filled, one SAY HI button, then "share it to your story too". Hello posts get a NEW MEMBER tag and a one-tap **👋 Say welcome** button (a real comment, once per person) (say_hi.sql). · **Collectr + Dex buttons (27 Sep):** on Edit profile — Collectr takes the share link from its app (only Collectr's own addresses accepted), Dex takes a username (app.dextcg.com/users/<name>); shown as labeled pills beside Instagram/TikTok/Whatnot (collectr_dex_links.sql). · **Invite your friends (Jeff, 27 Sep):** INVITE replaced ALERTS in the rail (the top bell has alerts); screen with Text / WhatsApp / Messenger / Instagram DM / Facebook post / More / Copy link, shown once after sign up; INVITE FRIENDS on your page opens it too. Android gets the contact picker for Text. (No site can read Instagram/Facebook friends; iPhones block reading contacts.)
- **Still to build:** **Dex + Collectr importing (Mike, 27 Sep):** neither app lets another site pull a collection (Collectr's API is prices only and bars competing products; Dex has no API). What works: fix our Collectr CSV importer (below) and add a Dex CSV import, with a friendly 'bring your collection over' guide (both exports are paid features: Collectr Pro, Dex+). Mike is emailing Collectr about a partnership.
- **Later:** a reward card for inviting a friend (Mike, 27 Sep: build the invite now, card later — it needs art and a call on bonus card vs retasking one of the 50). Reports have no staff screen yet — read them in Supabase, table `post_reports`.

**Parked until 50+ members AND 20-25 new posts a day:** Pull of the Week contest with a store prize (#3) · Pack-opening video clips (#10) · Polls — "which should I grade?" (#7) · "Grade it?" — people guess the PSA grade (#6). Polls and Grade it need voters; with only a few people on, "2 votes" makes the site look empty (Mike, 27 Sep). (Suggested follows moved up: built now, turns on at 50 members.)

---

## House accounts (started 26 Sep 2026)

Six shop-run theme accounts that post to the feed and **never interact** —
no comments, no Heat, no follows. Edited from `/admin/house/` (Mike's
tacomike417 login only). Posting runs on GitHub
(`.github/workflows/house-posts.yml`, every 15 min) from `tools/house/`.
All six share one password, saved in GitHub as `TCGCARDWATCH_PASSWORD`.

- **TCGCardWatch — LIVE.** 1-3 posts/day, 8am-11pm, 3h apart. The week's biggest $10+ mover (10%+), up or down, on his meme backgrounds. No repeat within 14 days; skips a slot if nothing fresh.
- **oddballemon — LIVE.** 1-2 posts/day, 9am-5pm, 2h apart. 150 oddball photo+caption posts from ChatGPT's zips; never repeats; goes quiet when the queue runs out — on purpose, a one-time run. More zips: drop them in Downloads/Infinite-pulls-feed-wakeup and ask Claude to import them.
- **ProfessorPulls — LIVE.** 1 post/day, random time 6-8am. 199 graded-slab posts (eBay listing photos, Mike's call) with his deadpan "official assessment"; no repeated lines; never repeats a post.
- **Collections loaded (27 Sep):** TCGCardWatch, oddballemon, CassieCollects — through the importer.
- **CassieCollects — LIVE (27 Sep).** 1/day, two days on / one off, 8am-3am, 4h apart. 50 playful card posts (eBay photos). Starts 28 Sep.
- **CollectorConfessions — LIVE (27 Sep).** 1 every 3 days, 6-11am (Mike: conversational, gives people time to comment). 30 question cards, no caption. Starts 28 Sep.
- **PokeMemeGuy — LIVE (27 Sep).** 1-2/day, 11am-11pm, 3h apart. 75 memes, no caption. **The 21-30 zip is missing** — drop it in Downloads and ask Claude to add those 10.
- **danspokemonfinds — LIVE (27 Sep).** 1-2/night, 8pm-2am, 15 min apart. 200 physical oddities. Dry run passed.
- **House password note (27 Sep):** new house logins must use the SAME password saved in GitHub — easiest is to copy Professor's hash in SQL (that's how CollectorConfessions and PokeMemeGuy were fixed).
- **Not built yet:** iamvintage (no posts yet).
- A missed slot is skipped, never made up later.

**~26 Oct: helping people FIND them.** On Everyone they already show up;
on Following nobody sees them until they follow. Options talked through: an
"accounts to follow" strip every ~10 posts, new members starting out
following them (Jeff-as-first-friend style), a FOLLOW button on house posts,
and search.

---

## Ready to build (no decision needed)

**App**
- **Collectr import — DONE 27 Sep.** Reads Collectr's export by name (Product Name, Variance, Grade, Card Condition, Date Added, Notes); grades save as the app's own "PSA 10" / "CGC 10 Pristine"; date added and notes carry over; name decorations like "(JP)" / "(Full Art)" ignored for matching; other games and sealed set aside with a line saying so ("Pokémon only for now — left out 68 One Piece, 2 Funko"); a Collectr file imported again re-syncs (keeps the higher count) instead of doubling; friendly "Show off your Collectr collection here too" card on the import screen. Jeff's file: 45 Pokémon rows read cleanly.
  - **DONE (27 Sep):** Japanese set names. About 170 English names for Japanese sets (Neo Destiny, VSTAR Universe, Inferno X, Glory of Team Rocket, Pokémon Card 151…) now map to the Japanese card list. Japanese-only names route there even if the row forgets to say Japanese; shared names (Jungle, White Flare, Neo Destiny) only when the row says Japanese. Still to review: odd promo lines like "Japanese CD Promo".
  - **DONE (27 Sep):** sealed from a file. Packs, boxes, ETBs and tins are matched to the Sealed tab's product list for their set ("ETB" and "PC" understood) and shown in a Sealed block on the review screen. Only clear matches are ticked; unsure ones are named ("add it from the Sealed tab"). A Collectr re-import re-syncs sealed too. Up to 15 sets per import.
  - One Piece support would mean adding a whole second game — ask Jeff if it's worth it.
- **Card story — DONE 27 Sep.** My Collection's Edit panel has a "My story" box (same note as the back of the card in the feed), the card's page shows it under Your Copies, and splitting a stack keeps it. Imports carry Collectr notes in too. Not on the add screen (write it after, from Edit or the feed).
- **Tag people — DONE 27 Sep.** Type @ in a comment, a caption edit or a new post caption and a list of collectors pops up above the box (just "@" shows people you follow; letters search everyone public). Tap one to tag; the notification and the link were already there. Card stories too (27 Sep, `card_story_mentions.sql`): an @name in the story on a card notifies them and links, public profiles only.
- **Editions — DONE 27 Sep** (`edition.sql`). On the ten sets that had one (Base Set through Neo Destiny, not Base Set 2), adding a card asks "Which edition?" — 1st Edition / Shadowless (Base only) / Unlimited, optional, tap again to clear. Same on the scanner, My Collection Edit, and the feed's Edit my card info. Its own column, so the price still works; a 1st Edition never stacks with an Unlimited. Shows in lists, Your Copies and the card back; goes into every eBay sold search (Unlimited searches as "-1st -shadowless"). "Price is for the printing, not the edition" note. eBay sold button now sits ABOVE Add. Collectr files carrying "1st Edition" fill it in. Not yet: the static shared post pages (tools/build-post-pages.mjs) don't show it.

**Graded-card sold prices** — real eBay sold comps for GRADED cards only:
"Recent sales (PSA 10): about $X, from 8 sales" beside the owner's value.
Start on CompSniper's free tier (100 searches/mo), looked up on the server so
the key stays secret, each card+grade cached a week, Best Offer sales without
a real price left out. Test on 10-20 of Jeff's graded cards against eBay
before it goes public; SoldComps is the fallback. All of these are middlemen
scraping eBay — keep it easy to switch, never a long plan. Comparison sheet:
`~/Downloads/ebay_sold_comps_api_comparison.pdf`. **First step: Mike signs up
for CompSniper and gets the key.**

**Shop**
- `check-price-alerts` has never been put on a schedule. *SHOP-NEXT, DROP-RADAR*

**Goals & badges**
- Searchable set/region picker (Complete a Set, Master Set, Regional Pokédex; also unlocks Species Quest and Illustrator Archive). *GOALS-NEXT*
- Badge strip on My Collection; badge art in My Pokédex's Primary Goal card. *GOALS-NEXT*
- Four goals the data already supports: Vintage Near Mint, Secret Rare Sweep, Release Race, Grail Holder (check Grail Holder still makes sense after the grail was retired). *GOALS-NEXT*

**Card art & photos**
- English card art batches 02–07 — 1,318 cards left (ChatGPT, then size-check). Confirm batch 01's 242 links actually got loaded. *CARD-ART-NEXT*
- Glamour pipeline phase 2 — straighten, backdrop, tilt + shadow, color, raw/slab templates, refuse a bad capture. *FEED-NEXT*
- Cloudflare R2 for new feed images (bucket, images.infinitepulls.com, signed uploads, thumbnails). ~a day. *FEED-NEXT, CARD-ART-NEXT*

**Search & SEO**
- **Sitemaps — DONE 27 Sep.** robots.txt now names all four sitemaps (main, posts, cards, questions); the main one is just the front page + /pulls/ photos (the ?page= app screens came off).
- **Profiles for Google — DONE 27 Sep.** Every public profile with a post (or a photo + bio) gets a real page at /<name>/ — photo, @name, tagline, bio, latest 24 posts linking to their post pages, "Follow" into the app — plus `profile-sitemap.xml` (in robots.txt). Built by the same 10-minute job as the post pages; pages for people who go private are removed. Page addresses now end in "/" (GitHub Pages redirects the other form, and Google ignores a canonical that redirects). Post pages show the edition. **Still open:** the front page is blank to Google ("This app requires JavaScript").
- **When to move to Cloudflare (Mike, 27 Sep):** the Google pages are real files in the GitHub project, rebuilt every 10 minutes. Fine for now; revisit at about **2,000 members or 20,000 post pages**, whichever comes first (GitHub Pages is meant to stay under 1 GB and the job slows as it grows). The move: domain nameservers from Porkbun to Cloudflare (~15 min, whoever has the Porkbun login; check Porkbun email forwarding still works after), then a Cloudflare Worker builds each page on request. Free up to 100k page views/day, $5/mo after.

**Housekeeping (whenever)**
- Show Jeff the `?page=dex&code=` claim URL/QR in his admin card form. *INFINITE-DEX*
- Remove dead `renderAttachments()` / `loadBrandFiles()` in admin.js, and the old `topbar.js` / `breadcrumb.js`. *INFINITE-DEX, SITE-AUDIT*
- Email TCGdex about our traffic. *FINISH-TODAY*
- Refresh README (still describes Create My Own Goal, the old navbar, the grail).

---

## Quick checks (might already be done — confirm, then cross off)

- The 50-card rewards migration, the `dex_sweep()` set-based rewrite, and the 51 WebP thumbnails. SOCIAL-NEXT talks as if all 50 are live. *SEASON-26-FIFTY*
- Trophy case on the public profile (the 25 Sep profile has a badges row). *GOALS-NEXT*
- Jeff's "add your first card / pick a goal" tutorial posts retiring themselves. *FEED-NEXT*
- Swipe gesture locking up/down vs sideways inside posts. *FEED-NEXT*
- Jeff can still reach `/admin/` after the feed flip. *SITE-AUDIT*
- Jeff can see Hyde-Bot's Facebook posts now the Meta app is published. *EDITIONS-NEXT*
- The Stripe plan in STORE-PLAN is dead (Clover won) — confirm and forget it.

---

## Parked (on purpose)

- **Wish list is on its way out (Mike, 27 Sep):** nobody uses it. So no "N collectors want this" line, and no new wish-list features.
- **Clover work — no for now (Mike, 27 Sep):** scheduled inventory sync, and big-move price alerts on Jeff's stock.

- **Whatnot grader check** — if ever picked up, a slab-label checker that flags "not PSA/BGS/CGC/SGC/TAG", not a price overlay (iOS can't draw over other apps). *EDITIONS-NEXT*
- **Users linking their own Whatnot/TikTok live.** *SOCIAL-NEXT*
- **Drop Radar** as user-submitted sightings — at ~1,000 users. *DROP-RADAR*
- **Pokenomics personality badges** — after goals are done; the PDF has to go in the repo first. *GOALS-NEXT*
- **Era Diversifier, Trade-Only Build, Language Passport, Shop Challenge Champion** — each needs new machinery. *GOALS-NEXT*
- **Counter QR gate for reward reveals** — only if stale reveals become a problem. *REWARDS-FLOW*
- **Gallery webhook / empty-bin schedule** — low value, the Gallery is being dropped. *GALLERY*
- Ship the reward season all at once or in waves, given the missing art. *SEASON-26*

---

## The Facebook token (mid-December)

**Swap Hyde-Bot's Facebook token for a System User token.** ~20 minutes in
Meta Business Manager.

The current token says "Expires: Never" in the Token Debugger and that is
true — but it is the wrong clock. Meta runs a separate **Data Access
Expiration**, about 90 days, on the *permission* rather than the token. When
that lapses the same never-expiring token starts getting refused and
Hyde-Bot quietly stops posting to Facebook and Instagram. Nothing errors
until it does.

A System User token, created in Business Manager, is built for long-running
services and does not carry that clock. It is a swap of the `FB_PAGE_TOKEN`
secret in Supabase — no code change.

Publishing the Meta app (the privacy policy work) fixed a *different*
problem: it is what made the posts visible to Jeff and to customers. That
stays fixed. It does not affect the 90-day clock.

---

## Traps — read before touching the database

**Never run a SQL file with a bare `delete` in it against this database.**

On 18 Sep the price history was found empty. `supabase/card_price_history.sql`
contained:

```sql
delete from public.card_price_history
where recorded_on < (now() at time zone 'utc')::date;
```

It deletes every reading not recorded today. It was written in May as a
one-time cleanup when the table held less than a day of junk, and the line
never came out — while the file stayed one that other scripts tell you to
re-run. It ran four times and deleted 244,074 rows: every price the weekly
sync had ever collected. Nothing errored, because deleting rows is not an
error. The only symptom was every card saying "no price was recorded back
then" while Card Lookup showed a live price a second later.

That line is now removed and the file carries a block explaining why nothing
like it goes back in. Pruning belongs in `prune_price_history()`, which is
scheduled and keeps thirty days.

**Sanity check, any time:**

```sql
select count(*) from public.card_price_history;
```

If that is ever 0, somebody re-ran a file with a delete in it.

Price sync checked 25 Sep: job 4 is on `*/2 6-23 * * 0` (Sundays) and
`card_price_history` held 125,031 rows.

---

## Done 18 Sep, so nobody re-does it

- The card back in the feed carries the card: set and number, finish, grade,
  cert linked to the grader's report, quantity, value now with the move
  since added, and the raw-Near-Mint note with sold listings.
- Shared post pages (`tools/build-post-pages.mjs`) carry the same. They used
  to be a picture, a name and a date — built for Facebook link previews and
  never given any card data.
- Public collection pages (`tools/build-collection-pages.mjs`) carry grade,
  cert with report link, and whether the value is up or down since added.
- The feed asked `card_price_history` for `variant = 'market'`. Nothing
  writes that — sync-prices writes the *printing* for TCGplayer and `trend`
  for Cardmarket. It matched zero rows on every card, forever. Fixed, with
  `tools/feed-price-test.mjs` guarding it (10 tests).
- A card opened from its own shared link asked the database for none of the
  new columns, so the certificate was missing on exactly the page people get
  sent to.
- `card_price_history` is now readable by signed-out visitors
  (`supabase/card_price_history_public.sql`). Market prices are public
  information; the policy gap was why the built pages had no values.
