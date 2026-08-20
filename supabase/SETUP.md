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

- Store Info, Hours, Events, and Deals still save to `localStorage` only, exactly like before — this change didn't touch that part. That's still the next piece to move onto Supabase when you're ready.
- iPhones only deliver push notifications to a PWA that's been **added to the Home Screen** (Apple's restriction, not this app's) — the bell icon will still appear in Safari, but iOS won't actually let it subscribe until it's installed that way.
