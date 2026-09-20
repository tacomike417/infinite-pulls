/* Infinite Pulls — "do they have the app?"
 *
 * THE ONE THING THE DATABASE CANNOT SEE. Every other reward card is a fact
 * about rows: how many cards you own, how many people you commented on, how
 * long you have been a member. reward_sweep() works those out in one query
 * and never needs the browser's help.
 *
 * Whether somebody installed the app is not written down anywhere. Only the
 * browser knows, and only while it is running. So this file is the one place
 * that watches for it and tells the server, through
 * reward_assert_installed() -- see supabase/reward_assert_installed.sql.
 *
 * WHY IT IS ITS OWN FILE AND NOT PART OF THE FEED. The app is four pages
 * (the shell, the feed, the poster, admin) and a person can open the
 * installed app onto any of them. Detection that only ran on one page would
 * miss whoever lands somewhere else -- which is exactly how this card went a
 * month without being earnable. Load it everywhere; it is under 3 KB and
 * makes no network call at all unless there is something to report.
 *
 * NOT loaded by post/ on purpose: the poster is a SEPARATE PWA with its own
 * manifest, so standing in it standalone means somebody installed Hyde-Bot,
 * not Infinite Pulls.
 *
 * DELIBERATELY GENEROUS. Four ways in, and the answer sticks once it is yes:
 *
 *   1. display-mode -- standalone, fullscreen, minimal-ui or the desktop
 *      window-controls-overlay. Different platforms pick different ones for
 *      the same install, so all four count.
 *   2. navigator.standalone -- iOS Safari, which supports none of the above.
 *   3. an android-app:// referrer -- a Trusted Web Activity launched from
 *      the Android launcher. Nothing in the app checked for this before.
 *   4. the appinstalled event -- fires in the ordinary browser tab at the
 *      moment they install, so the card lands on the tap, not the next visit.
 *
 * AND IT REMEMBERS. Open it as an app once and this device is marked, so
 * signing in later from a browser tab on the same device still earns it.
 * That is the liberal reading on purpose: the card says APP INSTALLED, and
 * they did install it. Being in a tab right now does not un-install it.
 *
 * The one case this still cannot see is somebody who installed it on their
 * phone and has only ever signed in on a different machine. Nothing in a
 * browser can see that, and the fix is free: open the app on the phone once
 * while signed in and the card is theirs permanently.
 */
(function () {
  'use strict';

  /* Storage THROWS in iOS private browsing -- it does not return null, it
     raises. Every read and write in here is wrapped, and every one of them
     falls back to "we do not know", which costs at most one extra RPC. */
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (_) { /* fine */ } }

  var SEEN_KEY = 'ip-ran-as-app';      /* this device has run the installed app */

  /* PER USER, NOT PER DEVICE. The first version of this was one flag, and it
     was wrong: at the shop counter two people sign in on the same phone, and
     the second one would be marked "already told" by the first and never get
     the card. SEEN_KEY is genuinely about the device -- the app is installed
     or it is not -- but who has been given the card is about the person. */
  function toldKey(uid) { return 'ip-install-told:' + uid; }

  function displayMode() {
    var modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
    try {
      if (!window.matchMedia) return false;
      for (var i = 0; i < modes.length; i++) {
        if (window.matchMedia('(display-mode: ' + modes[i] + ')').matches) return true;
      }
    } catch (_) { /* old browser, fall through */ }
    return false;
  }

  function runningAsApp() {
    if (displayMode()) return true;
    if (window.navigator && window.navigator.standalone === true) return true;
    try {
      if (String(document.referrer || '').indexOf('android-app://') === 0) return true;
    } catch (_) { /* referrer can be blocked */ }
    return false;
  }

  /* Running as an app right now, or this device ever has. */
  function hasApp() {
    if (runningAsApp()) { lsSet(SEEN_KEY, '1'); return true; }
    return lsGet(SEEN_KEY) === '1';
  }

  /* The shared client is created by whichever script got there first --
     auth-log.js on the shell, feed.js on the feed -- and this file is loaded
     last on both, so it is normally there already. Normally is not always:
     a slow CDN can put the supabase library after us. Wait, briefly, then
     give up quietly. Fifteen seconds of polling a property costs nothing and
     the next page load tries again. */
  function whenReady(cb, giveUp) {
    var tries = 0;
    (function look() {
      var wrap = window.InfinitePullsSupabase;
      if (wrap && wrap.ready && wrap.client) return cb(wrap.client);
      if (++tries > 60) return giveUp();           /* ~15s, then stop */
      window.setTimeout(look, 250);
    })();
  }

  var asking = false;

  function tell() {
    if (asking) return;
    if (!hasApp()) return;
    asking = true;

    whenReady(function (client) {
      client.auth.getUser().then(function (res) {
        var user = res && res.data && res.data.user;
        if (!user) { asking = false; return; }     /* signed out; try next load */
        if (lsGet(toldKey(user.id)) === '1') { asking = false; return; }  /* already theirs */

        return client.rpc('reward_assert_installed').then(function (out) {
          /* THE CARD IS A BONUS, NOT A DEPENDENCY. If the function has not
             been installed yet this errors, we mark nothing, and every page
             on the site carries on exactly as it does today. */
          if (out && out.error) { asking = false; return; }

          lsSet(toldKey(user.id), '1');
          var won = Array.isArray(out && out.data) ? out.data : [];
          if (!won.length) return;                 /* they already had it */

          /* Hand it to whoever is drawing rewards on this page. The feed
             listens and runs its real reveal panel; the other pages have
             nothing listening and the card simply shows up earned next time
             they open Rewards, which is the right amount of ceremony for a
             page that is not about cards. */
          try {
            window.dispatchEvent(new CustomEvent('ip:reward-awarded', { detail: won }));
          } catch (_) { /* no CustomEvent constructor; the card is still theirs */ }
        });
      }).catch(function () { asking = false; });
    }, function () { asking = false; });
  }

  /* The moment of installing, caught in the tab they installed from. */
  window.addEventListener('appinstalled', function () { lsSet(SEEN_KEY, '1'); tell(); });

  /* Chrome can change display-mode without a reload when an installed app is
     opened from the launcher into an existing client. */
  try {
    if (window.matchMedia) {
      window.matchMedia('(display-mode: standalone)')
        .addEventListener('change', function (e) { if (e.matches) tell(); });
    }
  } catch (_) { /* Safari <14 has no addEventListener on MediaQueryList */ }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tell);
  } else {
    tell();
  }

  /* Exposed so the sign-in path can re-run it: somebody who opens the app
     signed out, then signs in, has not had a page load in between. */
  window.InfinitePullsAppInstalled = { check: tell, hasApp: hasApp };
})();
