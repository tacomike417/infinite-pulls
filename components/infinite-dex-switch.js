/* Is Infinite Rewards switched on?
 *
 * One tiny file, loaded before navbar.js, because the navbar has to decide
 * whether to draw the ∞ tab before anything has come back from Supabase.
 * Everything else about the Dex lives in infinite-dex-data.js and
 * infinite-dex.js; this is only the switch.
 *
 * HOW IT ANSWERS INSTANTLY
 *
 * The last known answer is kept in localStorage and read synchronously at
 * load, so a returning visitor never sees the tab flicker in or out. The
 * real answer is fetched right after and, if it disagrees, the navbar and
 * the current page are redrawn.
 *
 * WHEN IT HAS NEVER BEEN TOLD: ON.
 *
 * Not the obvious default, and it is the important decision in this file.
 * The two ways to be wrong are not equal:
 *
 *   default OFF  a shop that has not run infinite_dex_switch.sql yet loses
 *                the whole Infinite Dex, silently, with nothing in the
 *                panel to explain it. A feature that was working stops.
 *
 *   default ON   a first-time visitor to a shop that HAS switched it off
 *                sees the ∞ tab for about a fifth of a second before it
 *                goes. Only ever on a first visit, because the answer is
 *                cached the moment it arrives.
 *
 * A flicker is cheaper than a disappearance, so a switch nobody has
 * installed yet does not get to hide anything.
 *
 * The switches themselves live in public.dex_settings — see
 * supabase/infinite_dex_switch.sql. Off never deletes anything.
 */
(function () {
  'use strict';

  const KEY = 'infinite-pulls-dex-switch';

  // `known` is the whole point of the cache: it separates "the shop says
  // off" from "nobody has ever told us". See the note above.
  let state = { dex_on: true, rewards_on: true, known: false };
  let loaded = false;
  const waiting = [];

  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && cached.known) {
        state = { dex_on: !!cached.dex_on, rewards_on: !!cached.rewards_on, known: true };
      }
    }
  } catch (_) { /* a private window, or somebody's cleared storage */ }

  function remember() {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
  }

  const sbWrap = () => window.InfinitePullsSupabase || {};
  const sb = () => (sbWrap().ready ? sbWrap().client : null);

  /* Rewards can never be on while the Dex is off. The database refuses to
     store that combination and this refuses to report it, so no caller has
     to remember to check both. */
  function dexOn() { return !!state.dex_on; }
  function rewardsOn() { return !!(state.dex_on && state.rewards_on); }

  /* Anything that needs the true answer rather than the cached one waits
     on this. Used by the admin panel; the app itself is happy to draw the
     cached answer and be corrected. */
  function ready() {
    if (loaded) return Promise.resolve({ dexOn: dexOn(), rewardsOn: rewardsOn() });
    return new Promise((resolve) => waiting.push(resolve));
  }

  async function refresh() {
    const client = sb();
    if (!client) return;
    let row = null;
    try {
      const { data, error } = await client
        .from('dex_settings').select('dex_on, rewards_on').eq('id', 1).maybeSingle();
      // A missing table means infinite_dex_switch.sql has not been run on
      // this project yet, and a network blip means we simply do not know.
      // Either way: keep what we had. Never hide a feature on a guess.
      if (error) return;
      row = data;
    } catch (_) { return; }

    // A row that is missing entirely is the same as off. The file seeds
    // one, so the table existing without it means somebody deleted it.
    const next = { dex_on: !!(row && row.dex_on), rewards_on: !!(row && row.rewards_on), known: true };
    const changed = next.dex_on !== state.dex_on || next.rewards_on !== state.rewards_on;

    state = next;
    remember();

    if (!loaded) {
      loaded = true;
      const answer = { dexOn: dexOn(), rewardsOn: rewardsOn() };
      waiting.splice(0).forEach((fn) => fn(answer));
    }

    if (changed) redraw();
  }

  /* The switch flipped since this page was painted — most often on the
     very first visit, occasionally because Jeff threw it while somebody
     was looking at the app. Put the page right rather than leaving a tab
     that does nothing. */
  function redraw() {
    const nav = window.InfinitePullsNavbar;
    if (nav && nav.renderNavbar) {
      const page = (window.InfinitePullsApp && window.InfinitePullsApp.currentPage)
        ? window.InfinitePullsApp.currentPage()
        : new URLSearchParams(location.search).get('page');
      nav.renderNavbar(page || 'home');
      if (nav.renderMenu) nav.renderMenu();
    }
    // Somebody standing on the Dex when it was switched off, or on the
    // home screen that should now be showing the card.
    if (window.InfinitePullsApp && window.InfinitePullsApp.renderPage) {
      window.InfinitePullsApp.renderPage();
    }
  }

  function boot() { refresh(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.InfinitePullsDexSwitch = { dexOn, rewardsOn, ready, refresh, redraw };
})();
