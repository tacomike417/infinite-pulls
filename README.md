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
- `supabase/` — database schema, the push-sending Edge Function, and setup instructions

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

## Public Collector Pages

Every account gets a public page at `infinitepulls.com/username` — photo, collection, wish list, total value for each, and any pack-opening video links they've added — shareable with no account needed to view it. From My Account, a visitor can turn their page off entirely ("Make my collection public"), or keep it public but hide the dollar total ("Show my collection's total value"). Pack-opening videos are just pasted links (YouTube plays inline; TikTok/Instagram/etc. show as a "Watch" link) — no video is ever uploaded to or stored by this app, so there's no storage cost. See `supabase/SETUP.md` for the one-time setup.

## Local testing

Service workers require HTTP/HTTPS. Do not test the PWA by double-clicking `index.html`.

Example:

```bash
python3 -m http.server 8080
```

Then open:

`http://localhost:8080/`
