# Infinite Pulls PWA Starter

Mobile-first PWA starter for Infinite Pulls TCG & Hobby Shop.

## Main structure

- `index.html` — customer app shell
- `app.js` — route/page rendering, including the public-profile path routing (see below)
- `404.html` — redirects a direct visit to a public profile path back through `index.html` (GitHub Pages has no server-side routing)
- `components/topbar.js` — top bar component
- `components/navbar.js` — bottom nav + menu configuration
- `components/account.js` — sign up/sign in, profile + avatar upload, public-profile privacy toggles, pack-opening video links
- `components/collection.js` — card search, add-to-collection, and collection value
- `components/profile.js` — public collector page (`infinitepulls.com/username`)
- `style.css` — shared mobile-first styling
- `manifest.json` — PWA metadata
- `service-worker.js` — offline/app cache, plus push notification handling
- `config.js` — public Supabase project URL/key and VAPID public key (see Notifications section below)
- `admin/` — admin panel, fully live and backed by Supabase (Store Info, Hours, Events, Deals, Banner, and Push Notifications all publish immediately to every visitor)
- `supabase/` — database schema, the push-sending and price-alert-checking Edge Functions, and setup instructions

## Routing

The public app uses one `index.html` and query-string routes:

- `?page=shop`
- `?page=collection`
- `?page=events`
- `?page=deals`
- `?page=location`
- `?page=hours`
- `?page=contact`
- `?page=about`

Home is the base URL with no query string.

## Editing the menu

Edit:

- `components/navbar.js` for bottom navigation and menu items
- `components/topbar.js` for the top bar

## Admin

Open `/admin/`.

The admin panel is backed by Supabase and gated behind a Supabase Auth login, since anything published here reaches every visitor immediately — see `supabase/SETUP.md` for the one-time setup (create a free Supabase project, run `supabase/schema.sql`, deploy `supabase/functions/send-notification`, and fill in `config.js`).

- **Store Info / Hours / Events / Deals** — saved to the `store_info` table. Publishing here updates what every visitor sees the next time they open the app.
- **Banner** — editable from `/admin/`, shows pinned to the top of the app. Visitors can close it; it reappears only after the admin publishes a change.
- **Push notifications** — visitors opt in with the bell icon in the top bar. The admin panel can then send a real push to every opted-in phone.

## Accounts & Collections

Visitors can create a free account (Menu → My Account) with a username and profile photo, then build a card collection under My Collection: search for a card, choose its variant/condition/quantity, and it's added with a live market price pulled from [TCGdex](https://tcgdex.dev) (free, no API key required). A "Wish List" tab on that same page works the same way, for cards they're looking to buy rather than ones they already own — both get their own running estimated total.

Their cards can be viewed three ways — **List** (compact rows), **Portfolio** (the value dashboard + chart, My Collection tab only), or **Binder** (a 4×4 grid of card art per page, swiped or tapped through horizontally between pages like flipping a real binder) — switchable any time with the buttons above the list. In List or Binder, tapping any card opens the same full detail view search results use (prices, rarity, Other Printings, Shop This Card, Recent News, all of it), with a "← Back to My Cards" button to return; removing a card is a tap on its ✕ without opening anything. Underneath the collection (My Collection tab only) is a **Pokémon News** feed — the latest general Pokémon TCG headlines, same free news source as a single card's Recent News.

Tapping a search result opens a full card detail view before adding it — every variant's TCGplayer price (plus Cardmarket's when TCGdex has it), illustrator, release date, rarity, National Dex #, energy type, and regulation mark, plus an **Other Printings** gallery of every other set that card's ever been printed in (tap one to switch and add that printing instead). This is what makes searching "Charizard" actually useful instead of just a wall of same-named thumbnails — a visitor can tell exactly which printing they're looking at before it goes in their collection. Searching a card number works too — "Charizard 199" narrows straight to that printing instead of coming back empty.

The detail view also has **Shop This Card** (quick outbound links to eBay, TCGplayer, and Cardmarket) and **Recent News** — the top 5 real headlines about that card, pulled in live via a free news API, not just a link out. Shop This Card can be turned off from `/admin/` (Card Search — Shop This Card Links) for a shop that would rather not send customers to eBay/TCGplayer/Cardmarket to buy elsewhere. The Prices section can also show a current eBay asking-price estimate (median + range across active listings, clearly labeled as an asking price rather than a confirmed sold price) right under the Cardmarket price. See `supabase/SETUP.md` for the one-time setup on the news and eBay pieces (everything else on this page needs no setup at all).

Instead of typing a name, a visitor can tap **📷 Scan a Card** and take (or pick) a photo — the app reads the printed text off the card in the browser (no server, no API key, nothing uploaded anywhere) and runs it through the exact same search a typed name would, so they just tap the correct match same as always. See `supabase/SETUP.md` for how it works and its limits.

From My Account, a visitor can also opt into **Price Alerts** — a push notification when a wish list card drops in price, when their grail card moves, or a weekly "here's what your collection is worth" update. It runs on a daily schedule server-side (a small Supabase Edge Function + Cron job, no server of your own to run) and reuses the same push notification setup as the shop's banner alerts. See `supabase/SETUP.md` for the one-time setup.

On the My Collection tab, a **📈 Portfolio View** toggle switches "Your Cards" from a plain list into a value dashboard: total collection value, a line chart of that value over time, and a "Most Valuable" ranked list of their top cards. The chart fills in gradually — a small server-side job saves one value snapshot per collector per day, so there's no way to show history from before that job started running, but a real trend line and % change build up automatically from day one forward. See `supabase/SETUP.md` for the one-time setup.

## Shop Pulse

The admin panel (`/admin/`) has a **Shop Pulse** card showing which cards the most customers are hunting for, aggregated across every wish list — "14 customers want this" — so restocking decisions can be based on real local demand instead of guesswork. Each entry also shows the specific set/printing, which variant(s) customers asked for (Holofoil, Reverse Holofoil, etc.), and the total copies wanted (not just headcount), so a listing for one printing of a card is never confused with a different one. It never shows who wants a given card, only the aggregated counts. See `supabase/SETUP.md` for the one-time setup.

## Shop Inventory (Clover)

The Shop page can show the real, live inventory from the shop's Clover point-of-sale account — item name, price, and stock count, synced automatically (with a manual "Sync Inventory Now" button in the admin panel too). Connecting it uses Clover's own secure login flow — this app never sees or stores an actual Clover username or password. See `supabase/SETUP.md` for the full setup, including the parts only the shop owner can do (creating a Clover developer account and authorizing the connection).

Once that's connected, the admin panel also gets a **📷 Bulk Add Inventory** card — snap a photo of a card (or type its name) and it's added directly to the shop's real Clover inventory with a suggested price and stock count, the same idea as the customer-facing "Scan a Card" feature but writing straight into the store's actual catalog. Handy for quickly working through a stack of new cards instead of typing each one into Clover by hand. See `supabase/SETUP.md` for the one-time setup, including a Clover permission that needs turning on first.

## Public Collector Pages

Every account gets a public page at `infinitepulls.com/username` — photo, collection, wish list, total value for each, and any pack-opening video links they've added — shareable with no account needed to view it. From My Account, a visitor can turn their page off entirely ("Make my collection public"), or keep it public but hide the dollar total ("Show my collection's total value"). Pack-opening videos are just pasted links (YouTube plays inline; TikTok/Instagram/etc. show as a "Watch" link) — no video is ever uploaded to or stored by this app, so there's no storage cost. See `supabase/SETUP.md` for the one-time setup.

Each page can also be personalized from My Account: a short bio, a few self-chosen tags, and an optional "grail card" spotlight (a favorite pulled from their own collection, with a short note). The public page itself adds a "Collecting with Infinite Pulls since ..." badge, a "🆕 Latest pull" callout when a card was added recently, a small stats row (Total Cards / Sets Represented / Most Valuable Card), and a "📤 Share My Collector Card" button that generates a downloadable/shareable branded image on the fly — drawn client-side with no server or storage involved. See `supabase/SETUP.md` for the one-time schema update.

## Local testing

Service workers require HTTP/HTTPS. Do not test the PWA by double-clicking `index.html`.

Example:

```bash
python3 -m http.server 8080
```

Then open:

`http://localhost:8080/`
