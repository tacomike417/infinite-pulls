// Infinite Pulls — public runtime config.
//
// Everything in here is meant to be public: the Supabase "anon" key is
// designed to be exposed in browser code (it's restricted by the Row Level
// Security policies in supabase/schema.sql, not by being secret), and a
// VAPID public key is public by definition — never put the VAPID *private*
// key or the Supabase *service role* key here or anywhere in this app.
//
// Fill these in after creating your Supabase project — see
// supabase/SETUP.md for exact steps.

window.InfinitePullsConfig = {
  SUPABASE_URL: "https://rrkyvcouxdmurwdyuugv.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_SJEQDnQAEqCcIooFfDUjwg_jhYgUTe_",

  // Generated for you — safe to leave as-is unless you regenerate your own
  // VAPID keypair (see supabase/SETUP.md).
  VAPID_PUBLIC_KEY: "BPgNvMI-Ej693HSo41Q7F33BfAc6E7gWj1K-hGPVMLyxxR0CFOicZfic2z2SQmZZE3ztgT6uKO7I1lNRN7Ln95s",

  // Where the photos people take of their own cards live: the Cloudflare
  // Worker in cf-worker/, in front of one R2 bucket. Nothing secret -- it is
  // just an address, and the worker checks with Supabase who is calling
  // before it stores anything.
  //
  // LEAVE IT EMPTY AND NOTHING BREAKS. The app keeps saving the catalog art
  // exactly as it does today; photos simply are not kept. Fill it in once
  // the worker is deployed. Because the database stores the KEY and not the
  // address, changing this line later moves every photo at once.
  CARD_PHOTO_BASE: "https://infinite-pulls-cards.mnasvadi.workers.dev"

  // Card search/pricing (My Collection) uses TCGdex (tcgdex.dev), which is
  // free with no API key required — nothing to configure here for it.
};
