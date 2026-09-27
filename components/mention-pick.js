/* TAG PEOPLE WITH @, AND TAG POSTS WITH # (27 Sep 2026)
 *
 * Type @ in any box marked data-mention (comments, photo captions, the
 * new-post caption, card stories) and a short list of collectors appears
 * right above it. Tap one and "@name " goes in. The notification is handled
 * by the database (notify_mentions), and @names already show as links.
 *
 * Type # in the same boxes and it suggests tags: the ones people on the site
 * already use (most used first), a few starters (#PullDay, #Grail ...), and
 * Pokemon and set names that match what you have typed. Tap one and
 * "#Tag " goes in. A tag nobody has used yet still works -- just keep typing.
 *
 * Just "@" shows people you follow; a letter or two searches everyone
 * with a public profile. It is a list, not a screen, so the phone's back
 * button has nothing to undo: it goes away on its own when you tap one,
 * type a space, or leave the box.
 */
(function () {
  'use strict';
  if (window.InfinitePullsMention) return;

  const MAX = 6;
  const STARTERS = ['PullDay', 'InfinitePulls', 'Grail', 'ForTrade', 'ShopNight', 'PackOpening', 'Slab', 'Meme'];
  let list = null, box = null, token = null, timer = 0, seq = 0, active = 0, items = [];
  let followCache = null, usedTags = null;

  function sb() { return window.InfinitePullsSupabase && window.InfinitePullsSupabase.client; }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (m) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  /* The @word or #word the caret is sitting at the end of, or null. */
  function tokenAt(el) {
    const pos = el.selectionStart == null ? el.value.length : el.selectionStart;
    const before = el.value.slice(0, pos);
    const m = before.match(/(^|[\s(])([@#])([A-Za-z0-9_-]{0,30})$/);
    if (!m) return null;
    return { kind: m[2], start: pos - m[3].length - 1, end: pos, q: m[3] };
  }

  async function me() {
    try { const { data } = await sb().auth.getSession(); return data && data.session && data.session.user; }
    catch (_) { return null; }
  }

  /* ---- people ---- */
  async function following() {
    if (followCache) return followCache;
    const user = await me();
    if (!user) return (followCache = []);
    try {
      const { data: f } = await sb().from('follows').select('followee_id')
        .eq('follower_id', user.id).eq('following', true).limit(40);
      const ids = (f || []).map((r) => r.followee_id);
      if (!ids.length) return (followCache = []);
      const { data } = await sb().from('profiles').select('id, username, avatar_url')
        .in('id', ids).eq('is_public', true).not('username', 'is', null).limit(40);
      followCache = (data || []).sort((a, b) => a.username.localeCompare(b.username));
    } catch (_) { followCache = []; }
    return followCache;
  }

  async function searchPeople(q) {
    if (!q) return (await following()).slice(0, MAX)
      .map((p) => ({ kind: '@', value: p.username, face: p.avatar_url || '' }));
    const like = q.replace(/[%_\\]/g, (c) => '\\' + c);
    const [starts, mine] = await Promise.all([
      sb().from('profiles').select('id, username, avatar_url')
        .eq('is_public', true).ilike('username', like + '%').limit(MAX),
      following()
    ]);
    const lower = q.toLowerCase();
    const fromMine = mine.filter((p) => p.username.toLowerCase().startsWith(lower));
    const seen = new Set();
    return fromMine.concat((starts && starts.data) || [])
      .filter((p) => p && p.username && !seen.has(p.id) && seen.add(p.id))
      .slice(0, MAX)
      .map((p) => ({ kind: '@', value: p.username, face: p.avatar_url || '' }));
  }

  /* ---- tags ---- */
  /* "Team Rocket's Mewtwo ex" is a Mewtwo -- same rule as the feed's smart tags. */
  function pokemonOf(name) {
    let n = String(name || '').replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ').trim();
    n = n.replace(/^[A-Z][\w.'-]*(?:\s[A-Z][\w.'-]*)?['’]s\s+/, '');
    n = n.replace(/^(?:Radiant|Shining|Dark|Light|Mega|M|Shiny)\s+/i, '');
    for (let k = 0; k < 2; k++) {
      n = n.replace(/\s+(?:ex|EX|GX|V|VMAX|VSTAR|V-UNION|BREAK|LV\.?\s?X|Prime|LEGEND|δ|☆|Star)$/, '');
    }
    return n.trim();
  }
  /* A tag is one word: "Base Set" becomes BaseSet, "Mr. Mime" MrMime. */
  const asTag = (s) => String(s || '').replace(/[^A-Za-z0-9 ]/g, '')
    .split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');

  async function loadUsedTags() {
    if (usedTags) return usedTags;
    const counts = new Map();   /* lower -> { tag, n } */
    try {
      const { data } = await sb().from('user_photos').select('caption')
        .ilike('caption', '%#%').order('added_at', { ascending: false }).limit(400);
      (data || []).forEach((r) => {
        (String(r.caption || '').match(/#[A-Za-z][A-Za-z0-9_]{1,30}/g) || []).forEach((h) => {
          const tag = h.slice(1), k = tag.toLowerCase();
          const had = counts.get(k);
          if (had) had.n++; else counts.set(k, { tag, n: 1 });
        });
      });
    } catch (_) {}
    usedTags = [...counts.values()].sort((a, b) => b.n - a.n);
    return usedTags;
  }

  async function searchTags(q) {
    const lower = q.toLowerCase();
    const out = [];
    const seen = new Set();
    const add = (tag, n) => {
      const k = String(tag || '').toLowerCase();
      if (!k || seen.has(k) || (lower && !k.startsWith(lower))) return;
      seen.add(k); out.push({ kind: '#', value: tag, n: n || 0 });
    };
    (await loadUsedTags()).forEach((t) => add(t.tag, t.n));
    STARTERS.forEach((t) => add(t));
    if (q.length >= 2 && out.length < MAX) {
      const like = q.replace(/[%_\\]/g, (c) => '\\' + c) + '%';
      try {
        const [cards, sets] = await Promise.all([
          sb().from('user_cards').select('card_name').ilike('card_name', like).limit(60),
          sb().from('user_cards').select('set_name').ilike('set_name', like).limit(40)
        ]);
        ((cards && cards.data) || []).forEach((r) => add(asTag(pokemonOf(r.card_name))));
        ((sets && sets.data) || []).forEach((r) => add(asTag(r.set_name)));
      } catch (_) {}
    }
    return out.slice(0, MAX);
  }

  /* ---- the list ---- */
  function hide() {
    clearTimeout(timer);
    if (list) list.remove();
    list = null; token = null; items = []; active = 0;
  }

  function paint() {
    if (!box || !items.length) { if (list) list.remove(); list = null; return; }
    if (!list) {
      list = document.createElement('div');
      list.className = 'mention-pick';
      list.setAttribute('role', 'listbox');
      /* Right above the box, in the page's own flow -- so it rides up with
         the phone keyboard instead of hiding under it. */
      const host = box.closest('form') || box;
      host.parentNode.insertBefore(list, host);
    }
    list.innerHTML = items.map((p, i) => p.kind === '@' ? `
      <button type="button" class="mp-row${i === active ? ' on' : ''}" data-mp="${i}" role="option">
        ${p.face ? `<img src="${esc(p.face)}" alt="" loading="lazy">`
                 : `<span class="mp-face">${esc(p.value.slice(0, 1).toUpperCase())}</span>`}
        <span>@${esc(p.value)}</span>
      </button>` : `
      <button type="button" class="mp-row${i === active ? ' on' : ''}" data-mp="${i}" role="option">
        <span class="mp-face mp-hash">#</span>
        <span>#${esc(p.value)}</span>
        ${p.n ? `<small class="mp-n">${p.n} post${p.n === 1 ? '' : 's'}</small>` : ''}
      </button>`).join('');
  }

  function pick(i) {
    const p = items[i];
    if (!p || !box || !token) return;
    const el = box, v = el.value;
    const add = p.kind + p.value + ' ';
    el.value = v.slice(0, token.start) + add + v.slice(token.end).replace(/^\s/, '');
    const at = token.start + add.length;
    hide();
    el.focus();
    try { el.setSelectionRange(at, at); } catch (_) {}
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function onInput(el) {
    if (!sb()) return;
    const t = tokenAt(el);
    if (!t) { if (box === el) hide(); return; }
    box = el; token = t;
    clearTimeout(timer);
    const mine = ++seq;
    timer = setTimeout(async () => {
      let found = [];
      try { found = t.kind === '@' ? await searchPeople(t.q) : await searchTags(t.q); } catch (_) { found = []; }
      if (mine !== seq || box !== el) return;
      items = found; active = 0;
      paint();
    }, t.q ? 160 : 0);
  }

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el && el.matches && el.matches('[data-mention]')) onInput(el);
  });

  /* A tap on a row: pointerdown, so the box never loses focus (and the
     keyboard never drops) between the tap and the word going in. */
  document.addEventListener('pointerdown', (e) => {
    const row = e.target.closest && e.target.closest('.mention-pick [data-mp]');
    if (!row) return;
    e.preventDefault();
    pick(Number(row.dataset.mp));
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.mention-pick')) e.preventDefault();
  });

  document.addEventListener('keydown', (e) => {
    if (!list || e.target !== box) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      paint();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault(); e.stopPropagation();
      pick(active);
    } else if (e.key === 'Escape') {
      hide();
    }
  }, true);

  document.addEventListener('focusout', (e) => {
    if (e.target === box) setTimeout(() => { if (document.activeElement !== box) hide(); }, 150);
  });
  document.addEventListener('submit', () => hide(), true);

  window.InfinitePullsMention = { hide };
})();
