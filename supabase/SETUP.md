# Setting up the Banner + Push Notifications backend

This adds two things to Infinite Pulls: a top banner your buddy can publish
from `/admin/`, and real push notifications to phones that have the app
installed. Both need a small (free) Supabase project as the backend — here's
exactly how to wire it up.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free account/project (pick any name/region — region doesn't matter much for a shop this size).
2. Once it finishes provisioning, go to **Project Settings → API**.
3. Copy the **Project URL** and the **anon / public** key.
4. Open `config.js` in the project root and paste them in:

   ```js
   window.InfinitePullsConfig = {
     SUPABASE_URL: "https://your-real-project-ref.supabase.co",
     SUPABASE_ANON_KEY: "your-real-anon-key",
     VAPID_PUBLIC_KEY: "BPgNvMI-Ej693HSo41Q7F33BfAc6E7gWj1K-hGPVMLyxxR0CFOicZfic2z2SQmZZE3ztgT6uKO7I1lNRN7Ln95s"
   };
   ```

   Leave `VAPID_PUBLIC_KEY` as-is unless you regenerate your own keypair (see step 5).

## 2. Create the database tables

1. In the Supabase dashboard, open **SQL Editor → New query**.
2. Paste in the entire contents of `supabase/schema.sql` (in this same folder) and click **Run**.
3. This creates the `banner` table (one row, edited from the admin panel) and the `push_subscriptions` table (one row per phone that opts in), with the right access rules already applied.

## 3. Create your admin login

The admin panel is now locked behind a real login, since it can blast a push
notification to every subscriber.

1. In the dashboard, go to **Authentication → Users → Add user**.
2. Create one user with your buddy's email and a password (or your own — you can add more later the same way).
3. That's it — no separate signup flow needed. Sign in at `/admin/` with that email/password.

## 4. Generate a fresh VAPID keypair (recommended)

A VAPID keypair is how push notifications get cryptographically signed as coming from you. I generated one to get you started, but since its private half was shown in this chat, it's good practice to generate your own before going live:

```bash
npx web-push generate-vapid-keys
```

This prints a `Public Key` and `Private Key`. Put the public one in `config.js` (step 1) and keep the private one for step 6 below — never put the private key in any file in this project.

## 5. Deploy the notification-sending function

Sending a push can only happen from a server, so there's one small piece of
server code (`supabase/functions/send-notification/index.ts`) that needs to
be deployed to Supabase.

1. Install the Supabase CLI if you don't have it: `npm install -g supabase`
2. From the project root:

   ```bash
   supabase login
   supabase link --project-ref your-real-project-ref
   supabase functions deploy send-notification
   ```

3. Set the function's secrets (this is where the *private* VAPID key goes — it never touches the browser or the repo):

   ```bash
   supabase secrets set \
     VAPID_PUBLIC_KEY="your-public-key" \
     VAPID_PRIVATE_KEY="your-private-key" \
     VAPID_SUBJECT="mailto:you@example.com"
   ```

   (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically — you don't set those.)

## 6. Test it

1. Deploy/host the app as usual (or run `python3 -m http.server 8080` and open `http://localhost:8080/admin/` — push notifications work over `localhost` or real HTTPS, just not a plain IP or `file://`).
2. Sign in at `/admin/`.
3. Publish a banner — open the public app in another tab and confirm it shows up top. Close it, publish a *different* message, and confirm it reappears.
4. On a phone (or desktop Chrome/Firefox), open the app and tap the bell icon in the top bar to turn on notifications.
5. From `/admin/`, send a test push notification and confirm it arrives.

## Notes

- iPhones only deliver push notifications to a PWA that's been **added to the Home Screen** (Apple's restriction, not this app's) — the bell icon will still appear in Safari, but iOS won't actually let it subscribe until it's installed that way.

---

# Setting up Accounts + Collections

This adds customer accounts (email/password + username + profile photo) and
a "My Collection" page where a signed-in visitor can search for cards, add
them with a condition (Near Mint, Lightly Played, etc.) and quantity, and
see their collection's total estimated value using live market pricing.

## 1. Add the new tables

Same as before: **SQL Editor → New query**, run the entire current contents
of `supabase/schema.sql` again. It's safe to re-run — everything from before
is untouched, this just adds the new `profiles`, `user_cards`, and
`wishlist_cards` tables plus an `avatars` file storage bucket.

## 2. Nothing to configure for card pricing

Card search/pricing runs on [TCGdex](https://tcgdex.dev) — free, open-source,
no API key or signup required. Nothing to add to `config.js` for it.

## 3. Check your email confirmation setting

By default, Supabase requires a new signup to click a confirmation link in
their email before they can sign in. That's a reasonable default for a real
launch. For quick local testing, you can turn it off temporarily under
**Authentication → Providers → Email → Confirm email**, then turn it back on
before going live — your call.

## 4. Test it

1. Open the app, go to **Menu → My Account**, and create a test account.
2. Upload a profile photo and confirm it shows up.
3. Go to **My Collection**, search for a card (e.g. "Charizard"), pick a
   variant/condition/quantity, and add it.
4. Confirm it shows up in "Your Cards" below with a price and that the
   total updates. Remove it and confirm it disappears.
5. Tap the **Wish List** tab at the top of the same page and repeat —
   it's a separate list with its own total, for cards the visitor wants
   rather than owns.

## Notes

- Pricing comes from [TCGdex](https://tcgdex.dev), a free, open-source,
  actively maintained Pokémon card database that includes real TCGplayer
  and Cardmarket market pricing — no API key needed, no rate limit to
  configure. (An earlier version of this used pokemontcg.io, which turned
  out to be an unreliable legacy service being wound down — switched away
  from it after confirming the instability directly.)
- Card condition (Near Mint, Lightly Played, etc.) is stored per-card as
  the visitor's own note — it does not change the displayed price, since
  TCGdex doesn't publish condition-specific pricing, only per-variant
  (normal/holofoil/etc.) pricing.

### Scan a Card (photo-based search)

Nothing to configure — this uses [Tesseract.js](https://tesseract.projectnaptha.com/),
a free, open-source text-recognition library that runs entirely in the
visitor's browser. Tapping **📷 Scan a Card** loads it on the spot (a few
MB, only for people who actually use the button — it's not part of the
app's normal offline download), reads whatever text it can off the photo,
and searches TCGdex with the most name-shaped line it finds, same as if
that text had been typed into the search box.

It's a text reader, not true image recognition — it works best with a
single card, well lit, filling most of the frame, and it's reading the
printed name off the card rather than "seeing" the card the way a person
does. It won't always get it right, but that's fine: it just proposes a
search, and the visitor still taps the correct card from real results,
exactly like a typed search. If a photo doesn't produce a good match, it
says so and the visitor can just type the name instead.

There's a more advanced (and much more accurate) option — real
photo-based card recognition via a paid third-party API such as
[Ximilar](https://www.ximilar.com/blog/build-your-own-trading-card-game-identifier-with-our-api/),
which identifies a card by sight rather than reading its text, no
confirmation tap needed. It's billed per scan, so it's a deliberate
upgrade to consider later rather than something wired up now — ask if
you'd like to explore it.

---

# Setting up Price Alerts

This adds an opt-in push notification when a wish list card drops in
price, a chosen "grail card" moves, or it's been a week since a
visitor's last "here's what your collection is worth" update. It
reuses the same push notification setup from Step 1–5 at the top of
this file — nothing new to configure there — plus one more piece: a
small server-side function that has to actually check prices, which
means it needs to run on a schedule instead of only when someone
opens the app.

## 1. Re-run the schema

Same as always: **SQL Editor → New query**, paste in the full current
contents of `supabase/schema.sql`, run it. This adds a `user_id` column
to `push_subscriptions` (so a device can be tied to the account that
owns it), a `price_alerts_enabled` toggle plus two tracking columns on
`profiles`, and a `last_alert_price` column on both `user_cards` and
`wishlist_cards`. Everything from before is left untouched.

## 2. Deploy the new function

From the project root (same CLI you already installed for
send-notification):

```bash
supabase functions deploy check-price-alerts --no-verify-jwt
```

The `--no-verify-jwt` flag is because this function is only ever meant
to be called by a schedule, not by a signed-in visitor's browser — it
doesn't take any input from whoever calls it, everything it does comes
from what's already stored in the database, so it doesn't need to
check who's asking.

It reuses the exact same `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` /
`VAPID_SUBJECT` secrets you already set for send-notification — nothing
new to add there.

## 3. Schedule it to run daily

In the Supabase dashboard, open **Edge Functions → check-price-alerts**
and copy its **Invoke URL** (looks like
`https://your-project-ref.functions.supabase.co/check-price-alerts`).

Then, in **SQL Editor → New query**, paste this in (swap in the URL you
just copied) and run it once:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'infinite-pulls-price-alerts',
  '0 14 * * *', -- once a day; this is in UTC, so 14:00 UTC ≈ 9–10am US Eastern
  $$
  select net.http_post(
    url := 'https://your-project-ref.functions.supabase.co/check-price-alerts',
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  $$
);
```

That's it — Supabase will now call the function once a day on its own,
no server of yours required. To change the time later, run
`select cron.unschedule('infinite-pulls-price-alerts');` and schedule it
again with a different time. ([crontab.guru](https://crontab.guru) is
handy for building the schedule string.)

## 4. Test it

1. Sign in as a test account with at least one push-subscribed device
   (tap the bell icon in the top bar if you haven't already).
2. Go to **My Account → Price Alerts** and turn on "Notify me about
   price changes."
3. Add a card to your Wish List, then in the Supabase dashboard's
   **Table Editor**, open that row in `wishlist_cards` and manually set
   `last_alert_price` to something clearly higher than its real current
   price (e.g. `999`) — this simulates a price drop without needing to
   wait for a real one.
4. In the dashboard, open **Edge Functions → check-price-alerts** and
   use its **Invoke** button (or `curl`) to run it once by hand instead
   of waiting for the schedule.
5. Confirm a push notification arrives. The response also shows how
   many accounts were checked and how many pushes were sent.

## Notes

- Alerts only fire on roughly a 10% price move, so small day-to-day
  wiggling doesn't turn into constant notifications.
- The weekly collection-value summary sends at most once every 7 days
  per account, whenever the scheduled check next runs after that.
- If a visitor turns notifications on (the bell icon) before creating
  an account, and signs up or signs in afterward, the app automatically
  links that device to their new account the next time they open My
  Account — no extra step needed on their end.

---

# Setting up Shop Pulse

This adds a "Shop Pulse" panel to `/admin/` showing which cards the
most customers are hunting for — aggregated across every wish list, so
it's stocking guidance ("14 customers want this"), never a list of who
wants what.

## 1. Re-run the schema

Same as always: **SQL Editor → New query**, paste in the full current
contents of `supabase/schema.sql`, run it. This adds a
`shop_wishlist_demand()` function that reads across every account's
wish list to build the ranked list — everything from before is left
untouched.

## 2. Nothing else to configure

No new secrets, no new function to deploy — this is just a database
function plus a new card in the existing admin panel.

## 3. Test it

1. Sign in as a couple of different test accounts and add the same
   card to each one's Wish List.
2. Open `/admin/` and look at the new **Shop Pulse** card — that card
   should show up with a count matching however many test accounts
   added it. Tap **Refresh** any time to update it.

## Notes

- Counts are unique customers, not total wish list entries — if the
  same customer added a card twice somehow, it still only counts once.
- Each entry also shows the set/printing (so two different cards that
  happen to share a name are never mixed together), which variant(s)
  customers asked for (Holofoil, Reverse Holofoil, etc. — or "Any
  version" if requests are mixed), and the total copies wanted across
  everyone, not just how many people want it — useful when deciding how
  many to actually order in.
- If you already ran the schema before this update, re-run it once more
  — the `shop_wishlist_demand()` function's return shape changed to add
  those fields, so a fresh paste-and-run of `supabase/schema.sql` is
  needed to pick it up.
- Like Store Info, the Banner, and Push Notifications, this panel uses
  the same "any signed-in account can open it" rule the rest of
  `/admin/` already relies on — there's no separate admin-only role in
  this project, so the admin panel's (unpublicized) URL is the real
  gate today, same as everything else in there. If a proper admin-only
  role becomes worth adding later, ask and it can be layered in.

---

# Setting up Shop Inventory (Clover)

This connects the shop's real Clover point-of-sale account so the
Shop page in the app shows what's actually in stock — real item names,
prices, and stock counts, kept in sync automatically instead of typed
in by hand.

**Important:** this one is genuinely more involved than everything
else in this file, because it means creating an account on Clover's
own site and registering an app there — steps only the shop owner can
do, since it needs to be tied to the real business's Clover login.
Nothing here touches his actual Clover username or password — the app
never sees or stores that, it only ever gets a secure connection token
after he clicks "Allow" on Clover's own site.

## 1. Re-run the schema

Same as always: **SQL Editor → New query**, paste in the full current
contents of `supabase/schema.sql`, run it. This adds a
`clover_connection` table (holds the connection itself — nothing in it
is ever readable from the app's public API, only from server-side
functions) and a `shop_inventory` table (the synced item list, safe to
be public since it's just the shop's product listing). Everything from
before is left untouched.

## 2. Deploy the two new functions

```bash
supabase functions deploy clover-oauth-callback --no-verify-jwt
supabase functions deploy sync-clover-inventory --no-verify-jwt
```

Same reasoning as check-price-alerts: neither of these takes anything
sensitive from whoever calls them, so they don't need to check who's
asking.

## 3. Set one new secret

```bash
supabase secrets set CLOVER_API_BASE="https://api.clover.com"
```

That's the right value for a US-based shop. If the shop is in Europe
or Latin America, use `https://api.eu.clover.com` or
`https://api.la.clover.com` instead.

## 4. Walk through the connection (this part's on him)

Everything below happens right in the **Shop Inventory (Clover)** card
in `/admin/` — the app walks him through it step by step with a copy
button for the one technical bit (the Redirect URI), but the broad
strokes are:

1. He creates a free account at
   [clover.com/developers](https://www.clover.com/developers) and
   registers a new app (call it "Infinite Pulls").
2. Clover asks for a Redirect URI (sometimes labeled "Alternate Launch
   Path") — the admin panel shows the exact value to paste in, with a
   Copy button.
3. Clover then shows a Client ID and Client Secret for the new app —
   he pastes both into the admin panel and saves. These identify the
   app itself, not his personal login.
4. Back on Clover's site, he finds the link to connect/install the app
   to his actual store, clicks it, signs in with his normal Clover
   login, and clicks Allow. Clover sends him right back to the app,
   now connected.

**One honest caveat:** Clover's own docs describe the pieces this is
built on (the redirect format, the token exchange) very precisely, but
not the exact "click here to connect your store" link inside their own
developer dashboard — that part only appears once an app is actually
registered there. If step 4 doesn't turn up an obvious "connect" or
"install" link on Clover's side, send a screenshot of that app's page
in Clover's dashboard and the exact link/button can get sorted out
from there. Everything on this app's side (steps 1–3, and everything
after a successful connection) is built and ready.

Clover also reviews apps before letting them read a real store's live
data, same as most platforms like this — so there may be a short wait
between finishing step 4 and inventory actually starting to sync, even
once everything above is done correctly.

## 5. Schedule daily syncing

Same pattern as Price Alerts — **SQL Editor → New query**:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'infinite-pulls-clover-sync',
  '0 13 * * *', -- once a day; adjust the hour to taste (UTC)
  $$
  select net.http_post(
    url := 'https://your-project-ref.functions.supabase.co/sync-clover-inventory',
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  $$
);
```

(Grab the real Invoke URL from **Edge Functions → sync-clover-inventory**
in the dashboard, same as before.) There's also a **Sync Inventory Now**
button in the admin panel for syncing on demand, any time, without
waiting for the schedule.

## Notes

- Prices and stock counts come straight from Clover — if something
  looks off in the app, it's worth double-checking what Clover itself
  shows for that item first.
- If an item gets deleted from Clover entirely, it disappears from the
  Shop page the next time a sync runs — it doesn't linger.
- The Client Secret and connection tokens are never exposed to the
  browser or readable through the app's public API, only to the two
  server-side functions above — the admin panel can only save new
  credentials and check a plain connected/not-connected status.

---

# Setting up Bulk Add Inventory (Snap a Pic)

This adds a **📷 Bulk Add Inventory** card to `/admin/`, right below the
Shop Inventory (Clover) card — snap a photo of a card and it's added
directly to the shop's real Clover inventory, using the exact same
photo-scan idea as the customer-facing "Scan a Card" feature. It needs
**Shop Inventory (Clover) set up and connected first** (everything
above this section) — the card stays locked with a note until it is.

## 1. Deploy the new function

```bash
supabase functions deploy clover-add-item --no-verify-jwt
```

Same reasoning as the other Clover functions — no new secret needed,
it reuses the `CLOVER_API_BASE` already set in step 3 above.

## 2. The one required manual step: allow Inventory writes

Reading Clover's inventory (everything above) only ever needed
**Inventory → Read** permission on the Clover app. *Adding* items needs
**Inventory → Write** too, which almost certainly isn't checked yet,
since it wasn't needed until now.

In the Clover Developer Dashboard, on the app's page, open **Requested
Permissions** and check the **Write** box next to **Inventory** (leave
everything else as it was), then save. If the store was already
connected before this change, it may need to be reconnected once
(disconnect and click through Step 4 from the Clover section above
again) for the new permission to actually take effect — Clover ties
granted permissions to the moment the merchant clicked Allow, not to
whatever the app currently requests. **Remember to check this same box
when the Production app eventually gets created**, not just the
Sandbox one used for testing now.

If an add attempt fails with something like "status 403," this
permission is almost always why — the error message in the admin panel
says so directly.

## 3. Test it

1. Open `/admin/`, scroll to **📷 Bulk Add Inventory** — it should be
   unlocked (not showing the "connect Clover first" note) once Clover
   is connected.
2. Type a card name (e.g. "Pikachu") and search, or tap **📷 Scan a
   Card** and photograph one.
3. Tap the correct match. A price (pre-filled from today's estimated
   market value, editable) and a stock count (defaults to 1) show up —
   set them to whatever the shop actually wants, then tap **Add to
   Clover Inventory**.
4. Confirm it shows a green "added" count, then check Clover's own
   dashboard (or the app's Shop page after a moment) for the new item.

## Notes

- This writes real items into the shop's live Clover catalog —
  there's no draft or undo step in the app itself. Removing a
  mistakenly-added item means deleting it directly in Clover, same as
  removing anything else from the catalog.
- The photo-scan step runs the same free, on-device OCR as the
  customer-facing "Scan a Card" feature — nothing is uploaded anywhere
  to read the photo, and it isn't perfect on a blurry or oddly-lit
  shot. Typing the name in above the scan button always works as a
  fallback.
- The suggested starting price comes from TCGdex's estimated market
  value, same source as the rest of the app — it's a starting point,
  not a rule; the shop's actual price is whatever gets typed into that
  field before adding.
- Each add also updates the app's local `shop_inventory` copy right
  away, so a newly-added item shows on the Shop page immediately
  rather than waiting for the next scheduled sync.

---

# Setting up Public Collector Pages + Videos

Every account gets a public page at `infinitepulls.com/username` (public
by default — each visitor can turn it off, or hide just the dollar total,
from My Account). It shows their photo, username, collection, wish list,
and any pack-opening video links they've added.

## 1. Re-run the schema

Same as always: **SQL Editor → New query**, paste in the full current
contents of `supabase/schema.sql`, run it. This adds `is_public` and
`show_price` to `profiles`, a username-format safety check, a new
`profile_videos` table, a new `wishlist_cards` table, and the extra Row
Level Security policies that let a public page be read without signing
in — everything from before is left untouched.

One thing to watch for: the new username check will fail to apply if an
existing test account's username doesn't fit the rules (letters, numbers,
underscores, hyphens only, 3–24 characters, and not a reserved word like
"admin"). If the schema run errors on that step, rename the offending
username in the `profiles` table first, then run it again.

## 2. Nothing to configure for videos

Pack-opening videos are just links (YouTube, TikTok, Instagram, etc.)
that a visitor pastes into My Account — Infinite Pulls never stores or
hosts the actual video file, so there's no storage cost or upload limit
to manage. YouTube links play right on the public page; other platforms
show as a "Watch" link that opens the original post.

## 3. Test it

1. Sign in as a test account, go to **My Account**.
2. Confirm "Make my collection public" is on, and note the page link
   shown (`infinitepulls.com/your-username`).
3. Open that link in a private/incognito window (so you're not signed
   in) and confirm the photo, collection, wish list, and both totals all
   show up.
4. Back in My Account, turn off "Show my collection's total value" and
   refresh the public page — the cards and wish list should still show,
   just without prices or totals.
5. Turn off "Make my collection public" entirely and refresh the public
   page again — it should now say the page isn't found, whether or not
   the username is actually taken (this is intentional: it keeps a
   private page from being distinguishable from one nobody's claimed).
6. Paste a YouTube link into the Pack Openings form on My Account, save,
   and confirm it plays inline on the public page.

## Notes

- A profile is public by default the moment someone signs up — both
  toggles live in My Account any time after that.
- GitHub Pages doesn't support clean URLs like `/username` out of the
  box (it has no server-side routing); this project ships a `404.html`
  that quietly redirects a direct visit to that path back through the
  real app, which then renders the right page. No setup needed — it
  just needs `404.html` to stay deployed alongside everything else.

---

# Setting up Profile Personalization (bio, tags, grail card, share image)

This adds a short bio, self-chosen tags, an optional "grail card"
spotlight, a "Member since" badge, a "Latest pull" callout, a few
collection stats, and a downloadable/shareable "collector card" image
to every public profile page.

## 1. Re-run the schema

Same as always: **SQL Editor → New query**, paste in the full current
contents of `supabase/schema.sql`, run it. This adds `bio`, `tags`,
`grail_card_id`, and `grail_note` columns to `profiles` — everything
from before is left untouched, and it's safe to re-run.

## 2. Nothing else to configure

The bio, tags, and grail card are all edited from **My Account** and
require no extra setup. The shareable collector-card image is drawn
entirely in the visitor's browser (HTML canvas) — no server, storage,
or API key involved.

## 3. Test it

1. Sign in as a test account, go to **My Account**, and fill in the
   new "About You" section — a short bio and a few comma-separated
   tags — then save.
2. If the account owns at least one card, a "Grail Card" section
   appears — pick a favorite from the dropdown, optionally add a short
   note, and save.
3. Open the account's public page and confirm: the "Collecting with
   Infinite Pulls since ..." badge, the bio, the tags as pills, a
   stats row (Total Cards / Sets Represented / Most Valuable Card),
   a "🆕 Latest pull" line if a card was added recently, and (if set) a
   "Grail Card" section with the chosen card's image and note.
4. Tap **📤 Share My Collector Card** and confirm an image downloads
   (or the device share sheet opens) with the avatar, username, stats,
   and grail card laid out on a branded card.

## Notes

- Tags, bio, and the grail card are all optional — a profile with none
  of them set still renders fine, just without those sections.
- "Most Valuable Card" and the share image both respect the existing
  "Show my collection's total value" privacy toggle — if prices are
  hidden, dollar amounts are hidden there too.
- The share image is generated fresh each time from the visitor's
  current profile data — it's not stored anywhere, so there's nothing
  to clean up if they change their bio or grail card later.

---

# Setting up the Portfolio value view

This adds a **📈 Portfolio View** toggle on the My Collection tab: total
collection value, a line chart of that value over time, and a "Most
Valuable" ranked list. The value-over-time chart needs somewhere to
pull history from, so this also adds a small server-side job — like
Price Alerts above — that saves one value snapshot per collector per
day. It reuses the same Supabase Cron pattern, so if you've already
set up Price Alerts, this will feel familiar.

**Important:** there's no way to backfill history from before this job
starts running. The first time it fires, everyone with at least one
priced card gets their first snapshot; the chart only starts looking
like a real trend line after a few days of those snapshots build up.
Until then, a collector who opens Portfolio View sees their current
total and a "Building your value history" message instead of a chart.

## 1. Re-run the schema

Same as always: **SQL Editor → New query**, paste in the full current
contents of `supabase/schema.sql`, run it. This adds a new
`collection_value_snapshots` table (owner-only reads — nobody, not even
on a public profile, can see someone else's value history). Everything
from before is left untouched.

## 2. Deploy the new function

```bash
supabase functions deploy snapshot-collection-value --no-verify-jwt
```

Same reasoning as check-price-alerts: `--no-verify-jwt` because this
is only ever meant to be called by a schedule, not a signed-in
visitor's browser — it takes no input and only touches data already in
the database. No new secrets to set; it uses the same Supabase service
role access every other Edge Function here already has.

## 3. Schedule it to run daily

In the Supabase dashboard, open **Edge Functions → snapshot-collection-value**
and copy its **Invoke URL**.

Then, in **SQL Editor → New query**, paste this in (swap in the URL you
just copied) and run it once. If you already ran the `pg_cron`/`pg_net`
`create extension` lines for Price Alerts, those two lines are safe to
run again — they'll just no-op:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'infinite-pulls-collection-value-snapshot',
  '0 8 * * *', -- once a day; this is in UTC, so 8:00 UTC ≈ 3–4am US Eastern
  $$
  select net.http_post(
    url := 'https://your-project-ref.functions.supabase.co/snapshot-collection-value',
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
  $$
);
```

Pick any time — it just needs to run once a day, and running it before
most collectors are awake means "today's" number is usually already
there when they check. To change the time later, run
`select cron.unschedule('infinite-pulls-collection-value-snapshot');`
and schedule it again.

## 4. Test it

1. Sign in as a test account with at least one priced card in My
   Collection.
2. In the Supabase dashboard, open **Edge Functions →
   snapshot-collection-value** and use its **Invoke** button (or
   `curl`) to run it once by hand instead of waiting for the schedule.
3. In **Table Editor → collection_value_snapshots**, confirm a row
   appeared for that account with today's date and a `total_value`
   that matches what My Collection already shows.
4. On the My Collection tab, tap **📈 Portfolio View** and confirm the
   total, the "Building your value history" message (expected — there's
   only one day of data so far), and the "Most Valuable" list all show
   up correctly.
5. To see the actual chart render, manually insert one or two more rows
   into `collection_value_snapshots` for that account with earlier
   `snapshot_date`s and different `total_value`s, then reload Portfolio
   View.

## Notes

- Portfolio View only appears on the My Collection tab — a wish list
  doesn't have a "value" in the same sense, so there's no toggle there.
- Cards without current pricing available are left out of the total
  and the ranked list, same as the plain list view already does.
- Running the snapshot function twice in one day (a manual test run,
  then the real scheduled run) is safe — it overwrites that day's
  number instead of creating a duplicate or erroring.

---

# Setting up inline card news

The card detail view (tap a search result on My Collection or Wish
List) has a **Recent News** section that shows real headlines about
that card, not just a link out. It's powered by a small Edge Function
that proxies the [GDELT Project](https://www.gdeltproject.org)'s free,
keyless news-search API — GDELT is used specifically because its data
is explicitly licensed for unrestricted commercial use, unlike Google
News (whose robots.txt disallows automated access) or NewsAPI.org
(whose free tier explicitly forbids production use).

No schema changes, no new secrets, nothing to sign up for — just one
function to deploy.

## 1. Deploy the function

```bash
supabase functions deploy card-news
```

Unlike the Cron-triggered functions elsewhere in this file, this one
is called directly by a signed-in visitor's browser, so it's deployed
**without** `--no-verify-jwt` (same as send-notification) — Supabase
checks that the caller has a real session before running it.

## 2. Test it

1. Sign in, go to My Collection, and search for any card.
2. Tap a result to open its detail view and scroll to **Recent News**.
3. Confirm real headlines show up (title, source, and date), each
   opening the actual article in a new tab, with a "Search all news"
   link underneath.

If nothing's deployed yet, or GDELT happens to have zero results for
that particular card, the section just falls back to the plain search
link — never an error, never a stuck "Loading" state.

## Notes

- This is best-effort and cosmetic — if the function isn't deployed,
  errors, or times out, the rest of the card detail view (prices,
  rarity, other printings, the add form) all still work completely
  normally.
- Results are capped at 5 headlines from the last 3 months, sorted by
  a mix of relevance and recency so a common card name doesn't surface
  unrelated noise.
- GDELT doesn't publish a hard numeric rate limit, just asks that
  callers not hammer it — normal shop-app traffic is nowhere near a
  concern here.

---

# Setting up eBay pricing

The card detail view's **Prices** section can show a current eBay
asking-price estimate right under the Cardmarket row — the median
price across active listings for that card, with a low–high range.

**Important, and worth reading before starting:** this is genuinely
free, but it needs an eBay Developer account, which only your buddy
can create (it has to be tied to the shop's own identity). It's also
a real distinction worth understanding: this is what people are
currently *asking* for the card on eBay, not what it's actually
*sold* for. eBay's free tier has no sold-price API a hobby app like
this can realistically get approved for (that's the Marketplace
Insights API — it needs a business-justification application that
community reports suggest most small/hobby projects don't get through).
The asking-price number here is still a genuinely useful, genuinely
free signal — just a different one than TCGplayer/Cardmarket's market
prices, and the app labels it that way rather than implying otherwise.

## 1. Create a free eBay Developer account (his part)

1. Go to [developer.ebay.com](https://developer.ebay.com) and join the
   eBay Developers Program — use a business email address. Approval is
   typically about a business day.
2. Once approved, sign in and go to **My Account → Application Keys**.
3. Enter an application name (e.g. "Infinite Pulls") and click
   **Create a keyset** under **Production** (not Sandbox — Sandbox
   only returns fake test data).
4. This shows an **App ID (Client ID)** and a **Cert ID (Client
   Secret)** — copy both somewhere safe for step 2 below.
5. If the keyset shows a "currently disabled" message, click through
   it — eBay requires every production app to explicitly subscribe to
   (or opt out of) marketplace account-deletion notifications before
   the keyset activates. For an app like this that never touches real
   eBay customer accounts, opting out is the right choice; the page
   walks through it.

No eBay Partner Network application or affiliate account is needed for
this — that's only required for apps that send eBay traffic through an
affiliate/monetized link. This app only searches active listings to
estimate a price, which is unrestricted with a standard production
keyset.

## 2. Deploy the function and set the secrets

```bash
supabase functions deploy ebay-price
supabase secrets set EBAY_CLIENT_ID="paste the App ID here"
supabase secrets set EBAY_CLIENT_SECRET="paste the Cert ID here"
```

Same as `card-news`, this is deployed **without** `--no-verify-jwt` —
it's called directly by a signed-in visitor's browser, and Supabase
checks for a real session first.

The two secrets never touch the browser or this admin panel — they
live only in Supabase's server-side secret store, read by the function
itself when it mints its own eBay access token.

## 3. Test it

1. Sign in, go to My Collection, search for any reasonably common card
   (a very obscure or recent card may have too few current eBay
   listings to show a price — see Notes below).
2. Tap a result to open its detail view and look at **Prices**, right
   under the Cardmarket row.
3. Confirm an "eBay · Current Listings" line shows up with a median
   price and a low–high range underneath.

If the secrets aren't set yet, or eBay returns too few usable
listings, the row just doesn't show — never an error, never a stuck
"Loading" state, same as the news section.

## Notes

- This is best-effort and cosmetic, same as Recent News — if anything
  about the eBay side fails, the rest of the Prices section (and the
  whole card detail view) still works completely normally.
- The estimate pulls the 30 lowest-priced active Buy It Now listings,
  filters out titles that look like lots/bulk/graded slabs/reprints,
  and needs at least 3 clean listings left to show a number — a very
  obscure card may not clear that bar.
- eBay's free tier allows 5,000 calls a day to this endpoint by
  default, far more than a shop this size would ever use.
- The application access token this function mints is cached in
  memory for its ~2 hour lifetime, so most requests don't need a fresh
  eBay authentication round-trip at all.
