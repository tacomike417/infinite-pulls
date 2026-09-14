# Card photos

One Cloudflare Worker in front of one R2 bucket. It stores the photo somebody
took when they scanned a card, and serves it back.

## Why this exists

Scanning a card already takes a photograph. Until now it was sent off to be
identified and then dropped, and the collection kept the catalog art instead.
This keeps the real one.

## What the app stores

The **key**, not a URL — `u/<user id>/<card id>-<timestamp>-<random>.webp`.
The app builds the address from `CARD_PHOTO_BASE` in `config.js`. Moving to a
custom domain later is a one-line change instead of rewriting every saved row.

## What it will not do

- It will not take anybody's word for who they are. It asks Supabase.
- It will not take a file over 2MB.
- It will not take anything that is not a WebP, JPEG or PNG.
- It will not answer a page that is not in the ALLOWED list in `src/index.js`.

## Not done yet

There is no per-person rate limit. The size cap and the sign-in requirement
are the only brakes. If this ever gets abused, the fix is a counter in KV or
a Durable Object keyed on the user id — worth doing then, not before.
