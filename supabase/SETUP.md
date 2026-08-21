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
