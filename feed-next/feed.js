/* ===========================================================================
   THE FEED — Infinite Pulls

   STEP ONE. This is the look, running on Jeff's real cards. It reads
   `shop_available` (the same view the shop page reads) and nothing else. No
   new tables, no migration, nothing written back -- so it cannot break the
   live app no matter what happens in here.

   Still to come, deliberately not here yet:
     - personal photos per card  (needs a table)
     - the back of the card / CARD STORY  (needs a story field)
     - HYPE, comments and wishlist as real rows  (needs tables)
   HYPE and WISHLIST work in here, but they are kept on the phone only, the
   same way the portfolio's hearts are: a private mark that survives a reload
   and never pretends to be a number somebody counted.

   PAGINATION IS KEYSET, NOT OFFSET. `OFFSET 200` makes Postgres walk two
   hundred rows and throw them away, and this feed is built to be scrolled
   deep -- so each page asks for rows ORDER BY added_at DESC that come AFTER
   the last one we saw. Constant speed at any depth.
   =========================================================================== */
(function () {
  'use strict';

  const PAGE = 8;                     // posts per fetch
  const MARKS = 'ip-feed-marks';      // hype + wishlist, this device only

  const cfg = window.InfinitePullsConfig || {};
  let sb = null;
  try {
    if (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    }
  } catch (_) { sb = null; }

  const feed   = document.getElementById('feed');
  const esc    = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
                 c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money  = (n) => (n == null || isNaN(n)) ? '' : '$' + Number(n).toFixed(2);

  /* ---- what a person marks, kept on their own device -------------------- */
  function marks() {
    try { return JSON.parse(localStorage.getItem(MARKS) || '{}') || {}; } catch (_) { return {}; }
  }
  function toggleMark(key, kind) {
    const m = marks(), id = kind + ':' + key;
    if (m[id]) delete m[id]; else m[id] = 1;
    try { localStorage.setItem(MARKS, JSON.stringify(m)); } catch (_) {}
    return !!m[id];
  }
  const marked = (key, kind) => !!marks()[kind + ':' + key];

  /* ---- icons ------------------------------------------------------------ */
  const I = {
    search:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    bell:'<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 1 0-12 0c0 7-2 8-2 8h16s-2-1-2-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    bolt:'<svg viewBox="0 0 24 24"><path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z"/></svg>',
    chat:'<svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.1A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>',
    share:'<svg viewBox="0 0 24 24"><path d="M4 15v-2a8 8 0 0 1 8-8h5"/><path d="M14 2l4 3-4 3"/><path d="M4 15l4 4"/></svg>',
    mark:'<svg viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
    card:'<svg viewBox="0 0 24 24"><rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M8 7h8M8 11h5"/></svg>',
    chev:'<svg viewBox="0 0 24 24" class="chev"><path d="M6 15l6-6 6 6"/></svg>',
    chevR:'<svg viewBox="0 0 24 24" class="chev"><path d="M9 6l6 6-6 6"/></svg>',
    look:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    bars:'<svg viewBox="0 0 24 24"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
    doc:'<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
    people:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17.5" cy="9" r="2.6"/><path d="M17 15.5a5 5 0 0 1 4 4.5"/></svg>',
    arrowL:'<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    arrowR:'<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    home:'<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7"/><path d="M6.5 10v10h11V10"/></svg>',
    shop:'<svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>',
    plus:'<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    stack:'<svg viewBox="0 0 24 24"><rect x="4" y="3" width="11" height="15" rx="2"/><path d="M8 21h9a2 2 0 0 0 2-2V8"/></svg>',
    menu:'<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
  };

  /* ---- turning a shop row into a post ----------------------------------- */
  function toPost(r) {
    /* Two pictures exist today: the photograph Jeff took, and the catalogue
       art. His own comes first, because the whole idea is that the feed is
       real cards somebody actually holds. */
    const pics = [r.photo_url, r.art_url].filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);
    return {
      key:   String(r.clover_item_id || r.card_id || r.name),
      name:  r.name || 'Card',
      set:   r.set_name || '',
      num:   r.card_number || '',
      price: typeof r.price === 'number' ? r.price : null,
      when:  r.added_at || null,
      pics:  pics.length ? pics : [],
      shape: 'portrait'
    };
  }

  /* ---- one post --------------------------------------------------------- */
  function postHTML(p, i) {
    const hyped = marked(p.key, 'hype');
    const saved = marked(p.key, 'save');
    const n = 37 + (i % 9) * 3;       /* until HYPE is a real table */
    const sub = [p.set, p.num && '#' + p.num].filter(Boolean).join(' · ');

    return `
    <article class="post" data-key="${esc(p.key)}">
      <header class="post-top">
        <img class="avatar" src="../assets/hyde-bot.png" alt="" onerror="this.onerror=null;this.style.visibility='hidden'">
        <div class="who"><b>Infinite Pulls</b><small>${esc(sub || 'At the shop')}</small></div>
        <div class="badges"><span>&#9889;</span><span>&#9733;</span></div>
        <button class="follow on" type="button">FOLLOWING</button>
        <span class="dots">&#8943;</span>
      </header>

      <div class="frame" data-shape="${esc(p.shape)}">
        ${p.pics.length > 1 ? `<span class="count">1 / ${p.pics.length}</span>` : ''}
        <div class="rail">
          ${p.pics.map(u => `<figure><img src="${esc(u)}" alt="${esc(p.name)}" loading="lazy" decoding="async"></figure>`).join('')
            || `<figure><div class="msg">no picture yet</div></figure>`}
        </div>
        ${p.pics.length > 1 ? `
          <div class="hint">${I.arrowL}<span>SWIPE FOR PHOTOS</span>${I.arrowR}</div>
          <div class="pips">${p.pics.map((_, k) => `<i class="${k ? '' : 'on'}"></i>`).join('')}</div>` : ''}
      </div>

      <div class="acts">
        <button class="act hype${hyped ? ' on' : ''}" data-hype aria-pressed="${hyped}">
          <span class="ring">${I.bolt}</span>
          <span><span class="lbl">HYPE</span><span class="n">${n + (hyped ? 1 : 0)}</span></span>
        </button>
        <button class="act" data-comment>${I.chat}<span>COMMENT</span></button>
        <button class="act" data-share>${I.share}<span>SHARE</span></button>
        <button class="act${saved ? ' on' : ''}" data-save aria-pressed="${saved}">${I.mark}<span>WISHLIST</span></button>
      </div>

      <p class="caption"><b>Infinite Pulls</b> ${esc(p.name)}${p.set ? ' — ' + esc(p.set) : ''}</p>

      <section class="snap">
        <button class="snap-head" type="button" data-snap>
          <span class="ic">${I.card}</span><b>CARD SNAPSHOT</b>${I.chev}
        </button>
        <div class="snap-body">
          <span class="state">AT THE SHOP</span><span class="sep">•</span>
          <span class="cond">RAW</span><span class="sep">•</span>
          <span class="price">${esc(money(p.price))}</span>
        </div>
      </section>

      <div class="pills">
        <button class="pill" type="button" data-go="look">${I.look}<span>LOOK UP</span></button>
        <button class="pill" type="button" data-go="sold">${I.bars}<span>SOLD LISTINGS</span></button>
        <button class="pill" type="button" data-go="details">${I.doc}<span>CARD DETAILS</span></button>
      </div>

      <button class="nearby" type="button">${I.people}<span>See this one at the shop</span>${I.chevR}</button>
    </article>`;
  }

  /* ---- the sideways swipe ----------------------------------------------- */
  /* Thunkagram's job, done with the browser's own scroll snapping: no drag
     maths, no library, and it keeps momentum and accessibility for free. */
  function wireRail(frame) {
    const rail = frame.querySelector('.rail');
    const pips = [...frame.querySelectorAll('.pips i')];
    const count = frame.querySelector('.count');
    if (!rail || !pips.length) return;
    let tick;
    rail.addEventListener('scroll', () => {
      frame.classList.add('moved');
      clearTimeout(tick);
      tick = setTimeout(() => {
        const at = Math.round(rail.scrollLeft / rail.clientWidth);
        pips.forEach((p, k) => p.classList.toggle('on', k === at));
        if (count) count.textContent = `${at + 1} / ${pips.length}`;
      }, 60);
    }, { passive: true });
  }

  /* ---- reading the shop ------------------------------------------------- */
  let cursor = null, done = false, busy = false;

  async function fetchPage() {
    if (!sb) return [];
    let q = sb.from('shop_available')
      .select('clover_item_id, card_id, name, set_name, card_number, price, available, photo_url, art_url, added_at, hidden_online')
      .order('added_at', { ascending: false })
      .limit(PAGE * 3);              /* over-fetch: some rows get filtered out below */
    if (cursor) q = q.lt('added_at', cursor);

    const { data, error } = await q;
    if (error || !data) { done = true; return []; }

    const usable = data.filter(r =>
      typeof r.price === 'number' && (r.available || 0) > 0 && !r.hidden_online
      && (r.photo_url || r.art_url));

    if (data.length) cursor = data[data.length - 1].added_at;
    if (data.length < PAGE * 3) done = true;
    return usable.slice(0, PAGE);
  }

  async function loadMore() {
    if (busy || done) return;
    busy = true;
    const rows = await fetchPage();
    const start = feed.querySelectorAll('.post').length;
    if (rows.length) {
      const html = rows.map((r, k) => postHTML(toPost(r), start + k)).join('');
      feed.insertAdjacentHTML('beforeend', html);
      feed.querySelectorAll('.frame:not([data-wired])').forEach(f => {
        f.setAttribute('data-wired', '1'); wireRail(f);
      });
    }
    busy = false;
    if (done) endOfFeed();
  }

  function endOfFeed() {
    if (document.getElementById('feed-end')) return;
    feed.insertAdjacentHTML('beforeend',
      `<div class="end" id="feed-end">that's everything at the shop</div>`);
  }

  /* ---- taps -------------------------------------------------------------- */
  document.addEventListener('click', (e) => {
    const post = e.target.closest('.post');
    const key = post && post.getAttribute('data-key');

    const hype = e.target.closest('[data-hype]');
    if (hype && key) {
      const on = toggleMark(key, 'hype');
      hype.classList.toggle('on', on);
      hype.setAttribute('aria-pressed', String(on));
      const n = hype.querySelector('.n');
      if (n) n.textContent = String(Number(n.textContent) + (on ? 1 : -1));
      return;
    }
    const save = e.target.closest('[data-save]');
    if (save && key) {
      const on = toggleMark(key, 'save');
      save.classList.toggle('on', on);
      save.setAttribute('aria-pressed', String(on));
      return;
    }
    const snap = e.target.closest('[data-snap]');
    if (snap) { snap.closest('.snap').classList.toggle('shut'); return; }

    const share = e.target.closest('[data-share]');
    if (share && post) {
      const title = post.querySelector('.caption').textContent.trim();
      const url = location.href;
      if (navigator.share) { navigator.share({ title, url }).catch(() => {}); }
      else if (navigator.clipboard) { navigator.clipboard.writeText(url).catch(() => {}); }
      return;
    }
  });

  /* ---- go ---------------------------------------------------------------- */
  async function start() {
    if (!sb) {
      feed.innerHTML = `<div class="msg"><b>No connection to the shop</b>
        This page needs config.js and the Supabase library. Open it from the site,
        not from a file on your computer.</div>`;
      return;
    }
    feed.innerHTML = `<div class="skel"><div class="bar" style="width:55%"></div><div class="box"></div></div>`;
    await loadMore();
    const first = feed.querySelector('.skel');
    if (first) first.remove();
    if (!feed.querySelector('.post')) {
      feed.innerHTML = `<div class="msg"><b>Nothing on the shelf right now</b>
        When Jeff lists a card it shows up here.</div>`;
      return;
    }
    /* keep loading as they approach the bottom */
    const io = new IntersectionObserver((ents) => {
      if (ents.some(x => x.isIntersecting)) loadMore();
    }, { rootMargin: '900px' });
    const sentinel = document.createElement('div');
    feed.appendChild(sentinel);
    io.observe(sentinel);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
