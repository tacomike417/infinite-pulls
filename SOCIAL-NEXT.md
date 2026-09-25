# SOCIAL-NEXT — making Infinite Pulls feel like a social app

Decided with Mike, Sep 24 2026. Work these in order. Mike says "do part N" and we do only that part.
Phone always wins on this project.

Already true before any of this: every account has an address. infinitepulls.com/<username>
opens the feed filtered to that collector (404.html sends one-segment paths to /feed-next/?who=).

## Part 1 — Blocked usernames (protect ourselves first)
- DONE 25 Sep 2026: reserved_usernames_more.sql run in Supabase (95 names, database-enforced,
  case-insensitive, no existing account collided). Same list copied into components/account.js
  and the two page builders.
- A reserved list nobody can sign up as: every real folder at the site root (retailer, privacy,
  pulls, feed-next, post, admin, assets, components, data, infinite-questions, ...), plus
  infinitepulls, infinite-pulls, jeff, jeffhyde, admin, support, staff, official, pokemon, mod,
  help, shop, store, and similar.
- Enforced in the DATABASE (a check on profiles.username), not just in the sign-up form,
  so it can't be bypassed.
- Check existing accounts against the list before turning it on; report any collisions to Mike.
- Usernames compared case-insensitively (TacoMike417 = tacomike417).

## Part 2 — @ in the address
- DONE 25 Sep 2026: 404.html sends /@name (and %40name, and /@name/post/<id>) to the plain
  address; feed.js draws every collector's name as @name through one at() helper (the bare
  name still drives the address and filters); ?who=@name works too.
- infinitepulls.com/@tacomike417 lands on the same page as /tacomike417.
- Show @handle everywhere a name appears in the feed.

## Part 3 — Find people
- DONE 25 Sep 2026: typing @ in the feed's search box searches people only (up to 12), each
  row showing photo, @handle and card count; without the @ it is the mixed search as before.
  Placeholder now reads "Cards, stories, or @someone".
- Search collectors by @name from the feed. Results show photo, @handle and card count.

## Part 4 — "Scan to follow" QR code
- DONE 25 Sep 2026: a QR mark beside the @name on every profile opens a full-screen,
  black-on-white code for infinitepulls.com/@name, with SHARE and SAVE PICTURE (a printable
  card for the counter). Closes with the phone's back button or a tap off the card.
  Generator is feed-next/qrcode.js (Kazuhiko Arase, MIT), loaded only when opened.
- Every profile gets a QR code for its own address. Jeff's goes on the counter and on stream.

## Part 5 — Real profile header
- DONE 25 Sep 2026 (from Mike's mockup): gold-ringed photo, cards · ∞rewards · followers · following,
  optional name, tagline, bio, collection value chip, Instagram/TikTok/Whatnot buttons (handles only,
  profile_socials.sql), FOLLOW or EDIT PROFILE · SHARE PROFILE · the real mini QR, badges row. Grail
  out of the header. EDIT PROFILE sheet edits photo, name, bio, socials; My Account keeps only what
  people don't see and links to it. STILL TO DO: tabs + card grid under the header (Collection · Posts ·
  Wish list · Rewards).
- Photo, bio, card count, collection value, and buttons for their Instagram, TikTok and Whatnot.
- Needs new profile fields (small migration).

## Part 6 — Follow
- DONE 25 Sep 2026: following is opt-in now. Current members were given a follow row for every
  other member (follows_opt_in_step1.sql, 420 rows, the one unfollow kept); new people follow nobody.
  follow_counts() (step2) gives the numbers. Feed has EVERYONE / FOLLOWING tabs; the shop is always
  in Following. "Jeff as everyone's first follow" = the shop always showing in Following.
- Follow button, a Following tab in the feed, and Jeff as everyone's first follow.
- Needs a follows table (migration).

## Part 7 — LIVE ring
- Jeff's picture gets a red LIVE ring when he's streaming, and tapping it opens the stream.
- Later, any user can link their own Whatnot or TikTok live the same way (no video hosting by us).

## Also on the board (not social)
- DONE: the /retailer/ page is pushed and live (confirmed by Mike, Fri 9/25).
- Mon 9/28: email every distributor with the Retailer Packet (Mike + Claude). (Moved from Fri 9/25.)
- Mon 9/28: email Dex (the card-scanner app) about a partnership: could Infinite Pulls use their
  scanner on infinitepulls.com (API, embed or licensing) instead of us building our own? Ask about
  cost, rate limits, branding, and whether it returns card ID + set + number we can match to prices.
- Wed 9/30: the Go Live page for Jeff's first stream on Sun 10/4 at 7 p.m.
- Tue 10/6: Facebook foot-traffic ads start (after the photos are done).
- Jeff is working on the shop photos now (as of Fri 9/25) — the ads wait on them.
