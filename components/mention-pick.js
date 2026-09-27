/* TAG PEOPLE WITH @ (27 Sep 2026)
 *
 * Type @ in any box marked data-mention (comments, photo captions, the
 * new-post caption) and a short list of collectors appears right above
 * it. Tap one and "@name " goes in. The notification is already handled
 * by the database (notify_mentions on comments and captions), and @names
 * already show as links -- this is only the picking.
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
  let list = null, box = null, token = null, timer = 0, seq = 0, active = 0, people = [];
  let followCache = null;

  function sb() { return window.InfinitePullsSupabase && window.InfinitePullsSupabase.client; }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (m) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  /* The @word the caret is sitting at the end of, or null. */
  function tokenAt(el) {
    const pos = el.selectionStart == null ? el.value.length : el.selectionStart;
    const before = el.value.slice(0, pos);
    const m = before.match(/(^|[\s(])@([A-Za-z0-9_-]{0,24})$/);
    if (!m) return null;
    return { start: pos - m[2].length - 1, end: pos, q: m[2] };
  }

  async function me() {
    try { const { data } = await sb().auth.getSession(); return data && data.session && data.session.user; }
    catch (_) { return null; }
  }

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

  async function search(q) {
    if (!q) return (await following()).slice(0, MAX);
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
      .slice(0, MAX);
  }

  function hide() {
    clearTimeout(timer);
    if (list) list.remove();
    list = null; token = null; people = []; active = 0;
  }

  function paint() {
    if (!box || !people.length) { if (list) list.remove(); list = null; return; }
    if (!list) {
      list = document.createElement('div');
      list.className = 'mention-pick';
      list.setAttribute('role', 'listbox');
      /* Right above the box, in the page's own flow -- so it rides up with
         the phone keyboard instead of hiding under it. */
      const host = box.closest('form') || box;
      host.parentNode.insertBefore(list, host);
    }
    list.innerHTML = people.map((p, i) => `
      <button type="button" class="mp-row${i === active ? ' on' : ''}" data-mp="${i}" role="option">
        ${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="" loading="lazy">`
                       : `<span class="mp-face">${esc(p.username.slice(0, 1).toUpperCase())}</span>`}
        <span>@${esc(p.username)}</span>
      </button>`).join('');
  }

  function pick(i) {
    const p = people[i];
    if (!p || !box || !token) return;
    const el = box, v = el.value;
    const add = '@' + p.username + ' ';
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
      try { found = await search(t.q); } catch (_) { found = []; }
      if (mine !== seq || box !== el) return;
      people = found; active = 0;
      paint();
    }, t.q ? 160 : 0);
  }

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el && el.matches && el.matches('[data-mention]')) onInput(el);
  });

  /* A tap on a name: pointerdown, so the box never loses focus (and the
     keyboard never drops) between the tap and the name going in. */
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
      active = (active + (e.key === 'ArrowDown' ? 1 : people.length - 1)) % people.length;
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
