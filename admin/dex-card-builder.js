/* The Infinite Rewards card-art builder.
 *
 * Named the Infinite Dex card builder until 3 Sep 2026. It writes the WORDS
 * for ChatGPT; it has never made a card, and the heading says so now.
 *
 * Its own file, alongside the poster builder rather than inside it. The two
 * are the same shape — fill a form, get a prompt, send it to ChatGPT — but
 * they are different jobs and a card has no QR code, no shape choice and no
 * source page to read figures off. Sharing the code would mean a poster
 * change breaking a card, and admin.js is 54 KB before either of them.
 *
 * The prompt itself lives in the database (marketing_prompts, slug
 * 'dexcard'), exactly like the poster's. Rewording it is an UPDATE, not a
 * deploy — see supabase/marketing_dexcard.sql.
 */
(function () {
  'use strict';

  const SLUG = 'dexcard';
  const sb = () => (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
  const $ = (id) => document.getElementById(id);
  const esc = (v = '') => String(v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  // The poster builder measured this rather than guessing it; no reason to
  // measure it twice.
  const URL_LIMIT = (typeof CHATGPT_URL_LIMIT !== 'undefined') ? CHATGPT_URL_LIMIT : 14000;

  let prompt = null;

  function say(msg, bad) {
    const el = $('dexcard-status');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = bad ? '#fca5a5' : '';
  }

  async function load() {
    const client = sb();
    const card = $('dexcard-card');
    if (!card) return;
    if (!client) {
      card.innerHTML = '<h2>Make card art</h2><p>Connect Supabase in config.js to enable this.</p>';
      return;
    }
    try {
      const { data, error } = await client
        .from('marketing_prompts').select('*').eq('slug', SLUG).maybeSingle();
      if (error) throw error;
      if (!data) {
        $('dexcard-blurb').textContent =
          'Run supabase/marketing_dexcard.sql on the project, then reload this page.';
        return;
      }
      prompt = data;
      $('dexcard-blurb').textContent = data.blurb || '';
      $('dexcard-body').hidden = false;
      renderColours();
      sync();
    } catch (err) {
      $('dexcard-blurb').textContent = 'Could not load the card prompt: ' + (err.message || err);
    }
  }

  function colours() {
    return Array.isArray(prompt && prompt.options) ? prompt.options : [];
  }

  function renderColours() {
    const sel = $('dexcard-colour');
    if (!sel) return;
    sel.innerHTML = colours()
      .map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('');
  }

  /* Fills the template.
   *
   * Same rule the poster builder settled on: a line whose only content was
   * an answer he did not give goes entirely, rather than leaving a label
   * with nothing after it. A prompt with blanks in it reads to ChatGPT as a
   * question, and it will happily invent an answer.
   *
   * A placeholder the template asks for and this form does not have is left
   * exactly as written, so a typo like {{cardnaem}} shows up in the output
   * instead of quietly deleting the card name.
   */
  function build() {
    if (!prompt) return '';

    const colour = colours().find((o) => o.id === ($('dexcard-colour') || {}).value);
    const code = [
      ($('dexcard-code').value || '').trim().toUpperCase(),
      ($('dexcard-season').value || '').trim().toUpperCase(),
      ($('dexcard-number').value || '').trim()
    ].filter(Boolean).join(' · ');

    const extraLines = ($('dexcard-extra').value || '')
      .split('\n').map((l) => l.trim()).filter(Boolean);

    const values = {
      cardname: ($('dexcard-name').value || '').trim().toUpperCase(),
      taskline: ($('dexcard-task').value || '').trim().toUpperCase(),
      flavor:   ($('dexcard-flavor').value || '').trim(),
      subject:  ($('dexcard-subject').value || '').trim(),
      notes:    ($('dexcard-notes').value || '').trim(),
      palette:  (colour && colour.instruction) || '',
      code:     code,
      extra:    extraLines.length
        ? 'Extra lines between the task line and the flavour line, bold caps, centred, one per line: '
          + extraLines.join('  /  ')
        : ''
    };

    return String(prompt.template || '')
      .split('\n')
      .map((line) => {
        const asked = [...line.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
        const known = asked.filter((k) => k in values);
        if (known.length && known.every((k) => !values[k])) return null;
        return line.replace(/\{\{(\w+)\}\}/g, (whole, key) =>
          (key in values) ? values[key] : whole);
      })
      .filter((l) => l !== null)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* Send is an anchor, not a button, for the reason the poster builder
     documents at length: window.open() after an await is no longer inside
     the click that asked for it, and every pop-up blocker stops it dead
     and silently. The href is kept current as the form is typed in. */
  function sync() {
    const text = build();
    const link = $('dexcard-send');
    if (link) {
      const fits = encodeURIComponent(text).length <= URL_LIMIT;
      link.href = (text && fits) ? 'https://chatgpt.com/?q=' + encodeURIComponent(text)
                                 : 'https://chatgpt.com/';
      link.dataset.prefilled = (text && fits) ? '1' : '0';
    }
    return text;
  }

  function missing() {
    const need = [
      ['dexcard-name', 'the card name'],
      ['dexcard-task', 'the task line'],
      ['dexcard-subject', "what is on the card"],
      ['dexcard-code', 'the collector code']
    ];
    return need.filter(([id]) => !($(id).value || '').trim()).map(([, label]) => label);
  }

  async function copy() {
    const gaps = missing();
    if (gaps.length) return say('Still needs ' + gaps.join(', ') + '.', true);
    try {
      await navigator.clipboard.writeText(build());
      say('Copied. Open ChatGPT, paste it, send.');
    } catch (_) {
      say('Could not copy — use Send to ChatGPT instead.', true);
    }
  }

  function onSend(e) {
    const gaps = missing();
    if (gaps.length) {
      e.preventDefault();
      return say('Still needs ' + gaps.join(', ') + '.', true);
    }
    const text = sync();
    // Too long to ride in the URL: the link falls back to a plain ChatGPT
    // tab, so put the prompt on the clipboard and say so rather than
    // letting him arrive at an empty box.
    if ($('dexcard-send').dataset.prefilled !== '1') {
      navigator.clipboard.writeText(text).catch(() => {});
      say('Too long to send as a link — it is on your clipboard instead. Paste it into ChatGPT and send.', true);
    } else {
      say('Sent. When it gives you the picture, save it, then upload it against the card under Cards, just above.');
    }
  }

  function init() {
    if (!$('dexcard-card')) return;

    ['dexcard-name', 'dexcard-task', 'dexcard-flavor', 'dexcard-extra',
     'dexcard-subject', 'dexcard-notes', 'dexcard-code', 'dexcard-season',
     'dexcard-number'].forEach((id) => $(id) && $(id).addEventListener('input', sync));
    $('dexcard-colour') && $('dexcard-colour').addEventListener('change', sync);

    // The collector code is printed on the card, so it goes up as typed.
    ['dexcard-code', 'dexcard-season'].forEach((id) =>
      $(id) && $(id).addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); }));

    $('dexcard-copy') && $('dexcard-copy').addEventListener('click', copy);
    $('dexcard-send') && $('dexcard-send').addEventListener('click', onSend);

    const client = sb();
    if (!client) { load(); return; }
    client.auth.getSession().then(({ data }) => { if (data && data.session) load(); });
    client.auth.onAuthStateChange((_e, session) => { if (session) load(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.InfinitePullsDexCardBuilder = { load, build, sync, SLUG };
})();
