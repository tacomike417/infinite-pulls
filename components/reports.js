/* REPORTS -- the takedown screen (27 Sep 2026, Mike)
 *
 * Report on any post already sent it to a list nobody could read. This is
 * that list, for moderators only (the shop account and tacomike417 -- see
 * supabase/moderation.sql). It is a REPORTS row in the menu, with a red
 * number when something is waiting.
 *
 *   WAITING  -- each reported post once, with why and by whom.
 *               TAKE IT DOWN hides it from everybody but its owner (nothing
 *               is deleted). IT'S FINE clears the report. LOOK opens it.
 *   TAKEN DOWN -- everything hidden, with BRING IT BACK.
 *
 * A covering screen on the feed's back stack: the phone's back button
 * closes it. No on-screen back button.
 */
(function () {
  'use strict';
  if (window.InfinitePullsReports) return;

  const sb = () => window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
  const back = () => window.InfinitePullsFeedBack || null;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const cfg = window.InfinitePullsConfig || {};
  const PHOTO_BASE = String(cfg.CARD_PHOTO_BASE || '').replace(/\/+$/, '');
  const photoUrl = (key) => {
    if (!key) return '';
    if (/^https?:\/\//i.test(key)) return key;
    if (!PHOTO_BASE) return '';
    return PHOTO_BASE + '/p/' + key.split('/').map(encodeURIComponent).join('/');
  };
  const LOOP_CDN = 'https://vz-bf34e88b-2d7.b-cdn.net';

  const api = { on: false, count: 0 };
  window.InfinitePullsReports = api;
  let me = null;

  async function gate() {
    const c = sb();
    if (!c) return false;
    try {
      const { data } = await c.auth.getSession();
      me = data && data.session && data.session.user && data.session.user.id;
      if (!me) return false;
      const { data: ok } = await c.rpc('is_moderator');
      api.on = ok === true;
    } catch (_) { api.on = false; }
    return api.on;
  }

  async function refreshCount() {
    if (!api.on) return 0;
    try {
      const { data } = await sb().from('post_reports').select('post_key').is('handled_at', null).limit(500);
      api.count = new Set((data || []).map((r) => r.post_key)).size;
    } catch (_) {}
    return api.count;
  }

  /* ---- look ---- */
  const CSS = `
.rp-n{display:inline-grid;place-items:center;min-width:22px;height:22px;margin-left:auto;padding:0 6px;border-radius:11px;background:#e5243b;color:#fff;font:900 12px/1 system-ui,sans-serif}
.rp{position:fixed;inset:0;z-index:9300;background:#f4f6fb;color:#0d1725;overflow:auto;font:500 14px/1.4 system-ui,-apple-system,sans-serif;-webkit-overflow-scrolling:touch}
html.rp-lock,html.rp-lock body{overflow:hidden}
.rp-in{max-width:560px;margin:0 auto;padding:calc(14px + env(safe-area-inset-top)) 14px calc(30px + env(safe-area-inset-bottom))}
.rp-x{float:right;width:38px;height:38px;border:0;border-radius:50%;background:rgba(13,23,37,.08);color:#0d1725;font:900 16px/1 system-ui,sans-serif;cursor:pointer}
.rp h1{margin:0 0 4px;font:900 22px/1.2 system-ui,sans-serif}
.rp .rp-sub{margin:0 0 12px;color:#64748b;font-size:13px}
.rp-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 0 12px;padding:4px;border-radius:12px;background:#e5e9f2}
.rp-tabs button{border:0;border-radius:9px;padding:10px;background:none;font:900 13px/1 system-ui,sans-serif;color:#475569;cursor:pointer}
.rp-tabs button.on{background:#fff;color:#0d1725;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.rp-card{background:#fff;border-radius:14px;padding:12px;margin:0 0 10px;box-shadow:0 2px 10px rgba(13,23,37,.06)}
.rp-top{display:flex;gap:12px}
.rp-thumb{flex:none;width:72px;height:96px;border-radius:10px;object-fit:cover;background:#e2e8f0;display:grid;place-items:center;color:#94a3b8;font-size:24px}
.rp-what{min-width:0;flex:1}
.rp-what b{display:block;font-weight:900}
.rp-what .rp-kind{color:#64748b;font-size:12px;font-weight:700}
.rp-what p{margin:4px 0 0;color:#334155;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.rp-why{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.rp-why span{padding:4px 9px;border-radius:999px;background:#fff1f2;color:#be123c;font:800 12px/1.2 system-ui,sans-serif}
.rp-why span.cr{background:#fef3c7;color:#92400e}
.rp-by{margin:8px 0 0;color:#64748b;font-size:12px}
.rp-btns{display:grid;grid-template-columns:1.3fr 1fr .8fr;gap:8px;margin:12px 0 0}
.rp-btns button,.rp-btns a{display:grid;place-items:center;border:0;border-radius:10px;padding:11px 6px;font:900 13px/1 system-ui,sans-serif;cursor:pointer;text-decoration:none}
.rp-down{background:#e5243b;color:#fff}
.rp-fine{background:#e5e9f2;color:#0d1725}
.rp-look{background:#fff;color:#0d1725;border:1px solid #cbd5e1 !important}
.rp-back{background:#0d1725;color:#fff}
.rp-btns.two{grid-template-columns:1.3fr .8fr}
.rp-empty{padding:40px 16px;text-align:center;color:#64748b;font-weight:700}
.rp-note{margin:14px 0 0;padding:12px;border-radius:12px;background:#fff;color:#475569;font-size:12.5px}
.rp-card.done{opacity:.45;pointer-events:none}
`;
  (function addCSS() {
    if (document.getElementById('reports-css')) return;
    const st = document.createElement('style');
    st.id = 'reports-css'; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  })();

  /* ---- what each post is ---- */
  const KIND = { p: 'Photo post', c: 'Card post', r: 'Reward card', l: 'Loop' };

  async function previews(keys) {
    const out = new Map();
    const ids = (k) => [...new Set(keys.filter((x) => x.startsWith(k + '-')).map((x) => x.slice(2)))];
    const c = sb();
    const p = ids('p'), cd = ids('c'), r = ids('r'), l = ids('l');
    await Promise.all([
      p.length ? c.from('user_photos').select('id, user_id, object_key, caption').in('id', p)
        .then(({ data }) => (data || []).forEach((x) => out.set('p-' + x.id, { owner: x.user_id, img: photoUrl(x.object_key), text: x.caption || '' })), () => {}) : null,
      cd.length ? c.from('user_cards').select('id, user_id, card_name, set_name, photo_key, image_url, note').in('id', cd)
        .then(({ data }) => (data || []).forEach((x) => out.set('c-' + x.id, { owner: x.user_id, img: photoUrl(x.photo_key) || x.image_url || '',
          text: [x.card_name, x.set_name].filter(Boolean).join(' · ') + (x.note ? ' — ' + x.note : '') })), () => {}) : null,
      r.length ? c.from('user_reward_cards').select('id, user_id, reward_cards(thumb_url)').in('id', r)
        .then(({ data }) => (data || []).forEach((x) => out.set('r-' + x.id, { owner: x.user_id, img: (x.reward_cards && x.reward_cards.thumb_url) || '', text: '' })), () => {}) : null,
      l.length ? c.from('user_loops').select('id, user_id, video_guid, caption').in('id', l)
        .then(({ data }) => (data || []).forEach((x) => out.set('l-' + x.id, { owner: x.user_id, img: `${LOOP_CDN}/${x.video_guid}/thumbnail.jpg`, text: x.caption || '' })), () => {}) : null
    ]);
    return out;
  }

  const names = new Map();
  async function loadNames(ids) {
    const want = [...new Set(ids)].filter((id) => id && !names.has(id));
    if (!want.length) return;
    try {
      const { data } = await sb().from('profiles').select('id, username').in('id', want);
      (data || []).forEach((x) => names.set(x.id, x.username || 'someone'));
    } catch (_) {}
  }
  const nm = (id) => '@' + (names.get(id) || 'someone');

  function ago(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  /* ---- the screen ---- */
  let el = null, tab = 'wait';

  function close() {
    if (el) { el.remove(); el = null; }
    document.documentElement.classList.remove('rp-lock');
  }
  const leave = () => { const b = back(); if (!b || !b.pop('reports')) close(); };

  function open() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'rp';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Reports');
    el.innerHTML = `<div class="rp-in">
      <button type="button" class="rp-x" data-rp-x aria-label="Close">\u2715</button>
      <h1>🚩 Reports</h1>
      <p class="rp-sub">Only moderators see this.</p>
      <div class="rp-tabs" role="tablist">
        <button type="button" data-rp-tab="wait" class="on">Waiting</button>
        <button type="button" data-rp-tab="hidden">Taken down</button>
      </div>
      <div class="rp-list"><div class="rp-empty">Loading…</div></div>
      <p class="rp-note"><b>Take it down</b> hides the post from everyone except the person who posted it. Nothing is deleted — you can bring it back from <b>Taken down</b>. For a copyright report, take it down first and sort it out after.</p>
    </div>`;
    document.body.appendChild(el);
    document.documentElement.classList.add('rp-lock');
    const b = back();
    if (b) b.push('reports', close);
    el.querySelector('[data-rp-x]').addEventListener('click', (e) => { e.stopPropagation(); leave(); });   /* 3 Oct 2026: no dead ends */
    el.addEventListener('click', onClick);
    tab = 'wait';
    paint();
  }

  async function paint() {
    if (!el) return;
    el.querySelectorAll('[data-rp-tab]').forEach((b) => b.classList.toggle('on', b.getAttribute('data-rp-tab') === tab));
    const list = el.querySelector('.rp-list');
    list.innerHTML = '<div class="rp-empty">Loading…</div>';
    const html = tab === 'wait' ? await waitingHTML() : await hiddenHTML();
    if (el) el.querySelector('.rp-list').innerHTML = html;
  }

  async function waitingHTML() {
    let rows = [];
    try {
      const { data, error } = await sb().from('post_reports')
        .select('post_key, post_owner, reporter_id, reason, created_at')
        .is('handled_at', null).order('created_at', { ascending: false }).limit(300);
      if (error) throw error;
      rows = data || [];
    } catch (_) { return '<div class="rp-empty">Could not load the reports. Try again in a minute.</div>'; }
    const groups = new Map();
    rows.forEach((r) => {
      let g = groups.get(r.post_key);
      if (!g) { g = { key: r.post_key, owner: r.post_owner, reasons: new Map(), by: [], last: r.created_at }; groups.set(r.post_key, g); }
      g.reasons.set(r.reason, (g.reasons.get(r.reason) || 0) + 1);
      g.by.push(r.reporter_id);
    });
    api.count = groups.size;
    if (!groups.size) return '<div class="rp-empty">🎉 Nothing waiting. All clear.</div>';
    const all = [...groups.values()];
    const pv = await previews(all.map((g) => g.key));
    await loadNames(all.flatMap((g) => [g.owner, (pv.get(g.key) || {}).owner].concat(g.by)));
    return all.map((g) => {
      const p = pv.get(g.key) || {};
      const owner = g.owner || p.owner;
      return `<div class="rp-card" data-rp-key="${esc(g.key)}" data-rp-owner="${esc(owner || '')}" data-rp-reason="${esc([...g.reasons.keys()][0] || '')}">
        <div class="rp-top">
          ${p.img ? `<img class="rp-thumb" src="${esc(p.img)}" alt="" loading="lazy">` : `<span class="rp-thumb">${pv.has(g.key) ? '🖼' : '?'}</span>`}
          <div class="rp-what">
            <b>${esc(nm(owner))}</b>
            <span class="rp-kind">${esc(KIND[g.key[0]] || 'Post')}${pv.has(g.key) ? '' : ' · already gone'}</span>
            ${p.text ? `<p>${esc(p.text)}</p>` : ''}
          </div>
        </div>
        <div class="rp-why">${[...g.reasons].map(([why, n]) =>
          `<span class="${/copyright/i.test(why) ? 'cr' : ''}">${esc(why.replace(/ -- /, ' — '))}${n > 1 ? ' ×' + n : ''}</span>`).join('')}</div>
        <div class="rp-by">Reported by ${[...new Set(g.by)].slice(0, 4).map((id) => esc(nm(id))).join(', ')}${g.by.length > 4 ? ' +' + (g.by.length - 4) : ''} · ${ago(g.last)}</div>
        <div class="rp-btns">
          <button type="button" class="rp-down" data-rp-do="down">Take it down</button>
          <button type="button" class="rp-fine" data-rp-do="fine">It's fine</button>
          <a class="rp-look" href="/feed-next/?post=${encodeURIComponent(g.key)}">Look</a>
        </div>
      </div>`;
    }).join('');
  }

  async function hiddenHTML() {
    let rows = [];
    try {
      const { data, error } = await sb().from('hidden_posts')
        .select('post_key, post_owner, hidden_by, reason, hidden_at').order('hidden_at', { ascending: false }).limit(200);
      if (error) throw error;
      rows = data || [];
    } catch (_) { return '<div class="rp-empty">Could not load the list.</div>'; }
    if (!rows.length) return '<div class="rp-empty">Nothing has been taken down.</div>';
    const pv = await previews(rows.map((r) => r.post_key));
    await loadNames(rows.flatMap((r) => [r.post_owner, r.hidden_by]));
    return rows.map((r) => {
      const p = pv.get(r.post_key) || {};
      return `<div class="rp-card" data-rp-key="${esc(r.post_key)}">
        <div class="rp-top">
          ${p.img ? `<img class="rp-thumb" src="${esc(p.img)}" alt="" loading="lazy">` : '<span class="rp-thumb">🖼</span>'}
          <div class="rp-what">
            <b>${esc(nm(r.post_owner))}</b>
            <span class="rp-kind">${esc(KIND[r.post_key[0]] || 'Post')}${pv.has(r.post_key) ? '' : ' · deleted by its owner'}</span>
            ${p.text ? `<p>${esc(p.text)}</p>` : ''}
          </div>
        </div>
        <div class="rp-by">Taken down by ${esc(nm(r.hidden_by))} · ${ago(r.hidden_at)}${r.reason ? ' · ' + esc(r.reason.replace(/ -- /, ' — ')) : ''}</div>
        <div class="rp-btns two">
          <button type="button" class="rp-back" data-rp-do="restore">Bring it back</button>
          <a class="rp-look" href="/feed-next/?post=${encodeURIComponent(r.post_key)}">Look</a>
        </div>
      </div>`;
    }).join('');
  }

  function toast(msg) {
    let t = document.querySelector('.lp-toast') || document.getElementById('ip-toast');
    if (!t) { t = document.createElement('div'); t.className = 'lp-toast'; t.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:9700;padding:10px 16px;border-radius:12px;background:#0d1725;color:#fff;font:800 14px system-ui;transition:opacity .2s'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('on'); t.style.opacity = '1';
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.classList.remove('on'); t.style.opacity = '0'; }, 2600);
  }

  async function onClick(e) {
    const t = e.target.closest('[data-rp-tab]');
    if (t) { tab = t.getAttribute('data-rp-tab'); paint(); return; }
    const b = e.target.closest('[data-rp-do]');
    if (!b) return;
    const card = b.closest('[data-rp-key]');
    const key = card.getAttribute('data-rp-key');
    const act = b.getAttribute('data-rp-do');
    card.classList.add('done');
    try {
      if (act === 'down') {
        const { error } = await sb().from('hidden_posts').upsert({
          post_key: key, post_owner: card.getAttribute('data-rp-owner') || null,
          hidden_by: me, reason: card.getAttribute('data-rp-reason') || null
        });
        if (error) throw error;
        await sb().from('post_reports').update({ handled_at: new Date().toISOString() }).eq('post_key', key).is('handled_at', null);
        toast('Taken down. Only its owner can see it now.');
      } else if (act === 'fine') {
        const { error } = await sb().from('post_reports').update({ handled_at: new Date().toISOString() }).eq('post_key', key).is('handled_at', null);
        if (error) throw error;
        toast('Cleared. The post stays up.');
      } else if (act === 'restore') {
        const { error } = await sb().from('hidden_posts').delete().eq('post_key', key);
        if (error) throw error;
        toast('It’s back up.');
      }
      card.remove();
      if (act !== 'restore') api.count = Math.max(0, api.count - 1);
      const list = el && el.querySelector('.rp-list');
      if (list && !list.querySelector('.rp-card')) list.innerHTML = act === 'restore'
        ? '<div class="rp-empty">Nothing has been taken down.</div>'
        : '<div class="rp-empty">🎉 Nothing waiting. All clear.</div>';
    } catch (err) {
      card.classList.remove('done');
      toast('Could not save that: ' + ((err && err.message) || 'try again'));
    }
  }

  /* The REPORTS row in the menu (feed.js asks for it). */
  const FLAG = '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>';
/* THE SCORECARD (4 Oct 2026, Mike: "just put the results on my profile for me to find ... a link in
     my stuff"). Moderators only. The same row sits in the menu and in MY STUFF (feed.js asks for it). */
  api.scoreRow = () => api.on
    ? `<a href="/scorecard/"><svg viewBox="0 0 24 24"><path d="M5 20V11M12 20V4M19 20v-6"/></svg>SCORECARD</a>`
    : '';
  api.menuRow = () => api.on
    ? `<button type="button" data-reports>${FLAG}REPORTS${api.count ? `<i class="rp-n">${api.count > 99 ? '99+' : api.count}</i>` : ''}</button>` +
      /* THE SHARE DESK (4 Oct 2026): moderators only. What the shop's accounts posted, and where Mike has shared it. */
      `<a href="/share-desk/"><svg viewBox="0 0 24 24"><path d="M4 12v7h16v-7"/><path d="M12 15V4M8 8l4-4 4 4"/></svg>SHARE DESK</a>` + api.scoreRow()
    : '';

  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-reports]')) return;
    e.preventDefault(); e.stopPropagation();
    const b = back();
    /* close the menu first (its own back entry), then open over the feed */
    if (b) b.pop('sheet');
    setTimeout(open, 180);
  }, true);

  api.open = open;
  gate().then((ok) => { if (ok) refreshCount(); });
})();
