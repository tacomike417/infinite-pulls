# Infinite Pulls PWA Starter

Mobile-first PWA starter for Infinite Pulls TCG & Hobby Shop.

## Main structure

- `index.html` — customer app shell
- `app.js` — route/page rendering
- `components/topbar.js` — top bar component
- `components/navbar.js` — bottom nav + menu configuration
- `components/account.js` — sign up/sign in, profile + avatar upload
- `components/collection.js` — card search, add-to-collection, and collection value
- `style.css` — shared mobile-first styling
- `manifest.json` — PWA metadata
- `service-worker.js` — offline/app cache, plus push notification handling
- `config.js` — public Supabase project URL/key, VAPID public key, and optional pokemontcg.io API key (see Notifications and Accounts sections below)
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

Visitors can create a free account (Menu → My Account) with a username and profile photo, then build a card collection under My Collection: search for a card, choose its variant/condition/quantity, and it's added with a live market price pulled from pokemontcg.io. Collections are private per-account — nobody else can see another visitor's cards. See `supabase/SETUP.md` for the one-time setup.

## Local testing

Service workers require HTTP/HTTPS. Do not test the PWA by double-clicking `index.html`.

Example:

```bash
python3 -m http.server 8080
```

Then open:

`http://localhost:8080/`
