/* The Infinite Dex on/off switch — the admin side.
 *
 * Its own file, same reasoning as infinite-dex-admin.js: admin.js is 54 KB
 * and this feature has no business opening it. It watches Supabase auth
 * itself and asks for nothing.
 *
 * WHY THIS EXISTS
 *
 * Jeff is not ready to run the rewards side. A rewards system that is only
 * half there is worse than none — a customer collects five cards, the app
 * tells them a discount is waiting, and the person at the counter has never
 * heard of it. So the shop gets a switch, and the app obeys it.
 *
 * WHAT OFF MEANS
 *
 * Hidden, never deleted. Every card he has authored, every reward tier,
 * and every card a customer has already earned stays exactly where it is
 * and comes back untouched. This screen writes two booleans.
 *
 * TWO SWITCHES ON PURPOSE
 *
 * Rewards can be off while the Dex is on. That is the state the September
 * 12th grand opening needs: the code on the board works, cards land,
 * people collect, and nothing anywhere promises a discount.
 *
 * The other way round is not a state. Rewards for cards nobody can collect
 * is nonsense, so the checkbox disables itself and the database has a
 * constraint saying the same thing — see supabase/infinite_dex_switch.sql.
 */
(function () {
  'use strict';

  // Same trick as infinite-dex-admin.js: read the client through a
  // function so this file does not care about script order.
  const sb = () => (typeof supabaseClient !== 'undefined' ? supabaseClient : null);

  const $ = (id) => document.getElementById(id);

  let loaded = false;
  let busy = false;

  function say(msg, bad) {
    const el = $('dex-switch-status');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = bad ? '#fca5a5' : '';
  }

  /* The sentence at the top of the card. Written so he can tell what the
     customer sees without working it out from two checkboxes. */
  function describe(dexOn, rewardsOn) {
    if (!dexOn) {
      return '<p><strong>Customers see nothing.</strong> '
           + 'No ∞ tab, no home screen card, no code box. '
           + 'Nothing has been deleted — switch it back on and it is all there.</p>';
    }
    if (!rewardsOn) {
      return '<p><strong>Cards on, rewards off.</strong> '
           + 'People can collect and claim codes. Nothing tells them a reward is coming, '
           + 'and redeeming at the counter is switched off.</p>';
    }
    return '<p><strong>Everything is live.</strong> '
         + 'Customers collect cards, see how close they are to a reward, and can redeem at the counter.</p>';
  }

  function paint(dexOn, rewardsOn) {
    const dexBox = $('dex-switch-dex');
    const rewBox = $('dex-switch-rewards');
    const state = $('dex-switch-state');
    if (!dexBox || !rewBox) return;

    dexBox.checked = !!dexOn;
    rewBox.checked = !!(dexOn && rewardsOn);
    // Rewards without the Dex is not a state, so it cannot be ticked.
    rewBox.disabled = !dexOn;
    if (state) state.innerHTML = describe(dexBox.checked, rewBox.checked);
  }

  async function load() {
    const client = sb();
    if (!client) return;
    const { data, error } = await client
      .from('dex_settings').select('dex_on, rewards_on').eq('id', 1).maybeSingle();

    if (error) {
      // The likeliest cause by far, and worth saying in words rather than
      // showing him a Postgres message he cannot act on.
      const missing = /dex_settings/.test(error.message || '');
      say(missing
        ? 'Not set up yet — run supabase/infinite_dex_switch.sql on the project, then reload this page.'
        : 'Could not read the switch: ' + error.message, true);
      const state = $('dex-switch-state');
      if (state) state.textContent = '';
      return;
    }

    loaded = true;
    say('');
    paint(data && data.dex_on, data && data.rewards_on);
  }

  async function save() {
    const client = sb();
    if (!client || busy) return;
    if (!loaded) { say('Nothing loaded to save — reload the page first.', true); return; }

    const dexOn = $('dex-switch-dex').checked;
    const rewardsOn = dexOn && $('dex-switch-rewards').checked;

    busy = true;
    say('Saving…');
    const { error } = await client
      .from('dex_settings')
      .update({ dex_on: dexOn, rewards_on: rewardsOn })
      .eq('id', 1);
    busy = false;

    if (error) { say('Could not save: ' + error.message, true); return; }

    paint(dexOn, rewardsOn);
    // Said plainly, because this is the one control in the panel that
    // changes what every customer sees the moment it is pressed.
    say(dexOn
      ? (rewardsOn
          ? 'Saved. The Infinite Dex and its rewards are live for everybody.'
          : 'Saved. Customers can collect cards. Nothing mentions rewards.')
      : 'Saved. The Infinite Dex is hidden from customers. Nothing was deleted.');
  }

  function wire() {
    const dexBox = $('dex-switch-dex');
    const rewBox = $('dex-switch-rewards');
    const btn = $('dex-switch-save');
    if (!btn || btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';

    btn.addEventListener('click', save);
    // The preview line follows the boxes as he ticks them, so he reads what
    // is about to happen before he presses Save rather than after.
    [dexBox, rewBox].forEach((box) => box && box.addEventListener('change', () => {
      paint(dexBox.checked, rewBox.checked);
      say('Not saved yet.');
    }));
  }

  function start() {
    if (!$('dex-switch-card')) return;
    wire();
    const client = sb();
    if (!client) return;
    // getSession(), not getUser(): the same pair infinite-dex-admin.js uses,
    // and the same pair the panel's own stubs answer. Two files in this
    // folder asking auth two different questions is how one of them ends up
    // working only in production.
    client.auth.getSession().then(({ data }) => { if (data && data.session) load(); });
    client.auth.onAuthStateChange((_e, session) => { if (session) load(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.InfinitePullsDexSwitchAdmin = { load, save };
})();
