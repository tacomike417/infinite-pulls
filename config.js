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

  // Optional. Card search/pricing (My Collection) works without this at a
  // lower free rate limit (1,000 requests/day). Get a free key instantly at
  // https://dev.pokemontcg.io — no credit card, raises the limit to 20,000/day.
  // This is just a rate-limit token, not a secret credential; if it's ever
  // abused you can regenerate it for free at any time.
  POKEMONTCG_API_KEY: ""
};
