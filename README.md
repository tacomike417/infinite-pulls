# Infinite Pulls PWA Starter

Mobile-first PWA starter for Infinite Pulls TCG & Hobby Shop.

## Main structure

- `index.html` — customer app shell
- `app.js` — route/page rendering
- `components/topbar.js` — top bar component
- `components/navbar.js` — bottom nav + menu configuration
- `style.css` — shared mobile-first styling
- `manifest.json` — PWA metadata
- `service-worker.js` — offline/app cache
- `admin/` — prototype admin panel

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

The current admin is intentionally a prototype. It saves settings to browser `localStorage`, so it is not yet a secure or shared backend.

Next step: connect the same fields to Supabase authentication/database/storage. The public app structure does not need to be rewritten when that happens.

## Local testing

Service workers require HTTP/HTTPS. Do not test the PWA by double-clicking `index.html`.

Example:

```bash
python3 -m http.server 8080
```

Then open:

`http://localhost:8080/`
