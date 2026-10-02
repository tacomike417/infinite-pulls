/* GO LIVE (2 Oct 2026, Mike + Jeff).
 *
 * "If you are a streamer, you would come in, fill out these things, and when
 * necessary you go live and your profile will be the live stream box up top,
 * real cool looking... what you are doing is gaining access to our people with
 * your streams."
 *
 * WHAT THIS IS
 *   - THE LIVE BOX: when somebody is live, a box sits at the top of the feed for
 *     everyone, signed in or not. Tap WATCH and their stream plays right there.
 *     On a live streamer's own profile the box shows just them.
 *   - GO LIVE: a row in the menu, only for people Mike has approved
 *     (streamer_access in supabase/streamers.sql). Twitch plays from the channel
 *     name; YouTube from the link to the live video (a Whatnot seller who also
 *     streams to YouTube gets the box that way). END STREAM turns it off, and it
 *     turns itself off after 4 hours.
 *
 * Twitch and YouTube are shown in THEIR OWN players (their rules). Nothing is
 * loaded from either of them until somebody taps WATCH.
 * Phone first. Every layer here has an X.
 */
(function () {
  'use strict';
  const sb = () => window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const $ = (id) => document.getElementById(id);

  let lives = [];            /* [{ user_id, platform, ref, title, name, face }] */
  let canLive = false, meId = null, myTwitch = '', watching = null, timer = null;

  const CSS = `
#ip-live{margin:10px 12px 4px;font-family:inherit}
#ip-live[hidden]{display:none}
.lv-card{position:relative;border-radius:18px;overflow:hidden;background:linear-gradient(135deg,#1a0b1f,#0a1120 60%);border:1px solid rgba(255,59,78,.55);box-shadow:0 0 0 1px rgba(255,59,78,.15),0 10px 30px rgba(255,59,78,.18)}
.lv-row{display:flex;align-items:center;gap:12px;width:100%;padding:12px 14px;border:0;background:none;color:#fff;text-align:left;cursor:pointer;font:inherit}
.lv-face{flex:none;width:52px;height:52px;border-radius:50%;padding:3px;background:conic-gradient(#ff3b4e,#ff9f1c,#ff3b4e);animation:lvspin 4s linear infinite}
.lv-face img,.lv-face span{display:grid;place-items:center;width:100%;height:100%;border-radius:50%;object-fit:cover;background:#111827;border:2px solid #0a1120;font:900 18px system-ui;color:#fff;animation:lvspin 4s linear infinite reverse}
@keyframes lvspin{to{transform:rotate(360deg)}}
.lv-tx{flex:1;min-width:0}
.lv-tx b{display:block;font-size:16px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lv-tx small{display:block;margin-top:2px;font-size:13px;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lv-pill{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;background:#ff3b4e;color:#fff;font:900 11px system-ui;letter-spacing:.12em}
.lv-pill i{width:7px;height:7px;border-radius:50%;background:#fff;animation:lvblink 1.1s ease-in-out infinite}
@keyframes lvblink{50%{opacity:.25}}
.lv-go{flex:none;padding:10px 16px;border-radius:999px;background:#fff;color:#0a1120;font:900 13px system-ui;letter-spacing:.06em}
.lv-more{display:flex;gap:8px;overflow-x:auto;padding:0 14px 12px;scrollbar-width:none}
.lv-more::-webkit-scrollbar{display:none}
.lv-chip{flex:none;display:flex;align-items:center;gap:7px;padding:5px 12px 5px 5px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff;font:800 13px system-ui;cursor:pointer}
.lv-chip.on{border-color:#ff3b4e;background:rgba(255,59,78,.2)}
.lv-chip img,.lv-chip span{width:26px;height:26px;border-radius:50%;object-fit:cover;background:#111827;display:grid;place-items:center;font:900 11px system-ui}
.lv-top{display:flex;align-items:center;gap:10px;padding:10px 8px 10px 14px}
.lv-top a{flex:1;min-width:0;color:#fff;font:900 15px system-ui;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lv-x{flex:none;width:40px;height:40px;border:0;border-radius:50%;background:rgba(255,255,255,.1);color:#fff;display:grid;place-items:center;cursor:pointer}
.lv-x svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round}
.lv-frame{position:relative;width:100%;aspect-ratio:16/9;background:#000}
.lv-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.lv-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 14px;font:700 13px system-ui;color:rgba(255,255,255,.8)}
.lv-foot a{color:#19bfff;font-weight:800;text-decoration:none}
.lv-menu{display:flex;align-items:center;gap:10px}
.lv-dot{width:12px;height:12px;border-radius:50%;background:#ff3b4e;box-shadow:0 0 0 4px rgba(255,59,78,.25);flex:none;margin:0 5px}
.lv-sheet{position:fixed;inset:0;z-index:99990;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.6)}
.lv-box{position:relative;width:100%;max-width:520px;max-height:92vh;overflow:auto;padding:18px 18px calc(22px + env(safe-area-inset-bottom));border-radius:22px 22px 0 0;background:#0a1120;color:#f7f8fb;border-top:1px solid rgba(255,255,255,.12);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.lv-box h2{margin:0 44px 4px 0;font-size:22px;font-weight:900}
.lv-i{display:inline-grid;place-items:center;width:26px;height:26px;margin-left:8px;border-radius:50%;border:2px solid #19bfff;background:none;color:#19bfff;font:italic 900 15px Georgia,serif;vertical-align:3px;cursor:pointer;padding:0}
.lv-i[aria-expanded=true]{background:#19bfff;color:#03070d}
.lv-help{margin:8px 0 14px;padding:14px;border-radius:14px;background:#03070d;border:1px solid rgba(25,191,255,.4);font-size:14.5px;line-height:1.5;color:#dbe6f5}
.lv-help>b{display:block;margin-bottom:6px;font-size:16px;color:#fff}
.lv-help ol{margin:0;padding-left:20px}
.lv-help li{margin:0 0 8px}
.lv-help li b{color:#fff}
.lv-help small{display:block;margin-top:6px;color:#9eb0c8}
.lv-box p{margin:0 0 12px;color:#9eb0c8;font-size:14.5px;line-height:1.45}
.lv-box .lv-x{position:absolute;right:10px;top:10px}
.lv-pick{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 14px}
.lv-pick button{min-height:54px;border-radius:14px;border:1.5px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#fff;font:900 15px system-ui;cursor:pointer}
.lv-pick button.on{border-color:#19bfff;background:rgba(25,191,255,.14)}
.lv-box label{display:grid;gap:6px;margin:0 0 12px;font-weight:800;font-size:14px}
.lv-box label small{font-weight:500;color:#9eb0c8}
.lv-box input{width:100%;min-height:48px;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:#03070d;color:#fff;font:inherit;font-size:16px;box-sizing:border-box}
.lv-big{width:100%;min-height:56px;border:0;border-radius:14px;background:#ff3b4e;color:#fff;font:900 17px system-ui;letter-spacing:.06em;cursor:pointer}
.lv-big.end{background:#fff;color:#0a1120}
.lv-big[disabled]{opacity:.55}
.lv-st{min-height:20px;margin:8px 0 0;color:#ffc928;font-weight:800;font-size:14px}
.lv-post{margin:14px 0;border-radius:18px;overflow:hidden;background:linear-gradient(180deg,#1a1020,#0d1424);border:1.5px solid rgba(255,59,92,.55);box-shadow:0 0 0 1px rgba(255,59,92,.15),0 10px 28px rgba(255,59,92,.18);color:#fff}
.lv-post .lv-ph{display:flex;align-items:center;gap:10px;padding:12px 14px;color:#fff;text-decoration:none}
.lv-post .lv-ph .lv-face{width:44px;height:44px}
.lv-post .lv-ph b{display:block;font:900 16px/1.2 system-ui,sans-serif}
.lv-post .lv-ph small{display:block;color:#c9d6ea;font:500 13.5px/1.3 system-ui,sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lv-post .lv-ph .lv-tx{min-width:0;flex:1}
.lv-poster{position:absolute;inset:0;width:100%;height:100%;border:0;padding:0;cursor:pointer;color:#fff;background:radial-gradient(circle at 50% 45%,#3a1230,#0b0f1c 75%);display:grid;place-items:center}
.lv-poster span{display:grid;place-items:center;gap:10px;font:900 15px system-ui,sans-serif;letter-spacing:.06em}
.lv-poster i{width:64px;height:64px;border-radius:50%;background:#ff3b5c;display:grid;place-items:center;font-style:normal;font-size:26px;padding-left:5px;box-sizing:border-box;box-shadow:0 0 0 8px rgba(255,59,92,.22)}`;

  const XSVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const face = (l) => l.face ? `<img src="${esc(l.face)}" alt="">` : `<span>${esc((l.name || '?').slice(0, 1).toUpperCase())}</span>`;
  const where = (l) => (l.platform === 'youtube' ? 'YouTube' : 'Twitch');
  /* THE STORE'S OWN LOGIN shows as "Infinite Pulls", same as its posts do, and has no profile
     to open (config.js STORE_USER_ID). Everybody else is @name and their profile. */
  const STORE_ID = String((window.InfinitePullsConfig || {}).STORE_USER_ID || '');
  const isShop = (l) => !!STORE_ID && l.user_id === STORE_ID;
  const lbl = (l) => (isShop(l) ? 'Infinite Pulls' : '@' + l.name);
  const doorOf = (l) => (isShop(l) ? '/feed-next/' : '/feed-next/?who=' + encodeURIComponent(l.name));
  const outLink = (l) => (l.platform === 'youtube' ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(l.ref) : 'https://www.twitch.tv/' + encodeURIComponent(l.ref));
  const frameSrc = (l) => (l.platform === 'youtube'
    ? 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(l.ref) + '?autoplay=1&playsinline=1&rel=0'
    : 'https://player.twitch.tv/?channel=' + encodeURIComponent(l.ref) + '&parent=' + encodeURIComponent(location.hostname) + '&autoplay=true');

  /* which profile is on screen, if any (the feed's own address: ?who=name) */
  function profileName() {
    /* the feed puts #profcard on the page whenever a profile is up, and writes the name on it
       once it has loaded ('~' until then, which matches nobody, so the box waits) */
    const pc = $('profcard');
    if (pc) return String(pc.dataset.who || '~').toLowerCase();
    try { return (new URLSearchParams(location.search).get('who') || '').replace(/^@/, '').toLowerCase(); } catch (_) { return ''; }
  }
  /* the box belongs on the feed itself and on a live streamer's profile, nowhere else */
  function onFeedHome() {
    try { const q = new URLSearchParams(location.search); return !['who', 'post', 'tag', 'card', 'page', 'loop', 'goals'].some((k) => q.has(k)); } catch (_) { return true; }
  }

  function box() {
    let el = $('ip-live');
    if (el) return el;
    const feed = $('feed'); if (!feed || !feed.parentNode) return null;
    if (!$('ip-live-css')) { const st = document.createElement('style'); st.id = 'ip-live-css'; st.textContent = CSS; document.head.appendChild(st); }
    el = document.createElement('section'); el.id = 'ip-live'; el.setAttribute('aria-label', 'Live now'); el.hidden = true;
    feed.parentNode.insertBefore(el, feed);
    return el;
  }

  function paint() {
    const el = box(); if (!el) return;
    const who = profileName();
    let list = lives;
    if (who) list = lives.filter((l) => (l.name || '').toLowerCase() === who);
    else if (!onFeedHome()) list = [];
    if (!list.length) { el.hidden = true; el.innerHTML = ''; el.dataset.sig = ''; watching = null; return; }
    if (watching && !list.some((l) => l.user_id === watching)) watching = null;
    const cur = list.find((l) => l.user_id === watching) || list[0];
    const sig = list.map((l) => l.user_id + l.platform + l.ref + (l.title || '')).join('|') + '#' + (watching || '') + '#' + cur.user_id;
    if (el.dataset.sig === sig && !el.hidden) return;        /* nothing changed: never restart a stream somebody is watching */
    el.dataset.sig = sig;
    const more = list.length > 1 ? `<div class="lv-more">${list.map((l) =>
      `<button type="button" class="lv-chip${l.user_id === cur.user_id ? ' on' : ''}" data-lv-pick="${esc(l.user_id)}">${face(l)}${esc(lbl(l))}</button>`).join('')}</div>` : '';
    el.innerHTML = watching
      ? `<div class="lv-card">
          <div class="lv-top"><span class="lv-pill"><i></i>LIVE</span><a href="${esc(doorOf(cur))}">${esc(lbl(cur))}${cur.title ? ' &middot; ' + esc(cur.title) : ''}</a>
            <button type="button" class="lv-x" data-lv-close aria-label="Close the stream">${XSVG}</button></div>
          <div class="lv-frame"><iframe src="${esc(frameSrc(cur))}" title="${esc(lbl(cur))} live on ${where(cur)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
          <div class="lv-foot"><span>Live on ${where(cur)}</span><a href="${esc(outLink(cur))}" target="_blank" rel="noopener">Open in ${where(cur)} &#8599;</a></div>
          ${more}</div>`
      : `<div class="lv-card">
          <button type="button" class="lv-row" data-lv-watch="${esc(cur.user_id)}" aria-label="Watch ${esc(lbl(cur))} live">
            <span class="lv-face">${face(cur)}</span>
            <span class="lv-tx"><span class="lv-pill"><i></i>LIVE</span><b>${esc(lbl(cur))}</b><small>${esc(cur.title || 'Live on ' + where(cur))}</small></span>
            <span class="lv-go">WATCH</span></button>
          ${more}</div>`;
    el.hidden = false;
  }


  /* ---------- THE STREAM IN THE FEED (2 Oct 2026, Mike: "you're scrolling along and all of a
     sudden Jeff's streaming live right there, so you might stop and watch him") ----------
     A live card sits between posts on the main feed. It starts playing with the sound OFF when
     it scrolls into view and stops when it scrolls away, so it never costs data unseen. The
     player's own speaker button turns the sound on. The box at the top of the feed stays. */
  const SLOTS = [3, 9];                                  /* after the 3rd post, and the 9th if two are live */
  const mutedSrc = (l) => (l.platform === 'youtube'
    ? 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(l.ref) + '?autoplay=1&mute=1&playsinline=1&rel=0'
    : 'https://player.twitch.tv/?channel=' + encodeURIComponent(l.ref) + '&parent=' + encodeURIComponent(location.hostname) + '&autoplay=true&muted=true');
  const posterHTML = (l) => `<button type="button" class="lv-poster" data-lv-play aria-label="Watch ${esc(lbl(l))} live"><span><i>&#9654;</i>TAP TO WATCH</span></button>`;
  function playCard(card, on) {
    const l = lives.find((x) => x.user_id === card.dataset.lvPost); if (!l) return;
    const fr = card.querySelector('.lv-frame'); if (!fr) return;
    const has = !!fr.querySelector('iframe');
    if (on && !has && watching !== l.user_id) {
      fr.innerHTML = `<iframe src="${esc(mutedSrc(l))}" title="${esc(lbl(l))} live on ${where(l)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    } else if (!on && has) fr.innerHTML = posterHTML(l);
  }
  let seeIO = null;
  function watchCard(card) {
    if (!('IntersectionObserver' in window)) return;
    if (!seeIO) seeIO = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.intersectionRatio >= 0.6) playCard(e.target, true);
      else if (e.intersectionRatio === 0) playCard(e.target, false);
    }), { threshold: [0, 0.6] });
    seeIO.observe(card);
  }
  function feedCards() {
    const feed = $('feed'); if (!feed) return;
    const home = !$('profcard') && onFeedHome();
    const want = home ? lives.slice(0, SLOTS.length) : [];
    feed.querySelectorAll('.lv-post').forEach((c) => {
      const l = want.find((x) => x.user_id === c.dataset.lvPost);
      if (!l || c.dataset.sig !== l.platform + l.ref) { if (seeIO) seeIO.unobserve(c); c.remove(); }
    });
    if (!want.length) return;
    const posts = [...feed.children].filter((n) => n.classList && n.classList.contains('post'));
    if (!posts.length) return;
    want.forEach((l, i) => {
      if (feed.querySelector('.lv-post[data-lv-post="' + l.user_id + '"]')) return;     /* never move one: moving restarts the video */
      if (i > 0 && posts.length < SLOTS[i]) return;
      const after = posts[Math.min(SLOTS[i], posts.length) - 1];
      const card = document.createElement('article');
      card.className = 'lv-post'; card.dataset.lvPost = l.user_id; card.dataset.sig = l.platform + l.ref;
      card.setAttribute('aria-label', '@' + l.name + ' is live');
      card.innerHTML = `<a class="lv-ph" href="${esc(doorOf(l))}"><span class="lv-face">${face(l)}</span>
          <span class="lv-tx"><b>${esc(lbl(l))}</b><small>${esc(l.title || 'Live on ' + where(l))}</small></span><span class="lv-pill"><i></i>LIVE</span></a>
        <div class="lv-frame">${posterHTML(l)}</div>
        <div class="lv-foot"><span>Sound starts off</span><a href="${esc(outLink(l))}" target="_blank" rel="noopener" style="white-space:nowrap">Open in ${where(l)} &#8599;</a></div>`;
      after.insertAdjacentElement('afterend', card);
      watchCard(card);
    });
  }

  async function load() {
    const c = sb(); if (!c) return;
    try {
      const { data, error } = await c.from('live_now').select('user_id, platform, ref, title, started_at').gt('ends_at', new Date().toISOString()).order('started_at', { ascending: false }).limit(12);
      if (error) return;                                  /* the table isn't there yet, or no signal: leave the box as it is */
      const rows = data || [];
      let prof = [];
      if (rows.length) {
        const r = await c.from('profiles').select('id, username, avatar_url').in('id', rows.map((x) => x.user_id));
        prof = r.data || [];
      }
      lives = rows.map((x) => { const p = prof.find((q) => q.id === x.user_id) || {}; return Object.assign({}, x, { name: p.username || '', face: p.avatar_url || '' }); }).filter((x) => x.name);
      paint(); feedCards();
    } catch (_) {}
  }

  async function whoAmI() {
    const c = sb(); if (!c) return;
    canLive = false; meId = null; myTwitch = '';
    try {
      const { data: { session } } = await c.auth.getSession();
      if (!session || !session.user) return;
      meId = session.user.id;
      const ok = await c.rpc('can_go_live');
      canLive = ok.data === true;
      if (canLive) { const p = await c.from('profiles').select('twitch').eq('id', meId).maybeSingle(); myTwitch = (p.data && p.data.twitch) || ''; }
    } catch (_) {}
  }

  /* ---------- the menu row (feed.js calls this while drawing the menu) ---------- */
  function menuRow() {
    if (!canLive) return '';
    const live = lives.some((l) => l.user_id === meId);
    return `<button type="button" data-golive class="lv-menu"><span class="lv-dot"></span>${live ? 'YOU\'RE LIVE &middot; END STREAM' : 'GO LIVE'}</button>`;
  }

  /* the 11-character id out of whatever YouTube link they paste */
  function youtubeId(v) {
    const s = String(v || '').trim();
    const m = s.match(/(?:v=|youtu\.be\/|\/live\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/) || s.match(/^([A-Za-z0-9_-]{11})$/);
    return m ? m[1] : '';
  }

  /* THE i (2 Oct 2026, Mike: "I am not familiar with the streaming aspect, so let's put
     one of those i in there that explains everything"). Plain words, start to finish. */
  const HELP = `<div class="lv-help" hidden>
      <b>How going live works</b>
      <ol>
        <li><b>You stream on Twitch or YouTube.</b> Infinite Pulls doesn't film you. It takes the stream you already have going and shows it to everybody here.</li>
        <li><b>Never streamed before?</b> Make a free account on Twitch or YouTube and get their app. In the Twitch app tap <b>Create</b>, then <b>Go Live</b>. In the YouTube app tap <b>+</b>, then <b>Go live</b>. YouTube may ask you to verify your account first, and that can take a day.</li>
        <li><b>Start your stream there first.</b> Then come back here and tap GO LIVE in the menu.</li>
        <li><b>Twitch:</b> type your channel name (the name in twitch.tv/<i>yourname</i>). <b>YouTube:</b> in YouTube tap <b>Share</b> on your live stream, copy the link, and paste it here.</li>
        <li><b>Your followers get an alert</b> the moment you go live. Tapping it brings them to your profile and your stream.</li>
        <li><b>What people see:</b> a red LIVE box at the top of the feed with your face on it. They tap WATCH and your stream plays right in the app. Your stream also shows up between posts as people scroll, playing with the sound off until they turn it on.</li>
        <li><b>Chat and tips</b> stay on Twitch or YouTube. The box has a link that opens your stream over there.</li>
        <li><b>Whatnot:</b> Whatnot doesn't let other apps play its shows. If you sell on Whatnot, stream to YouTube at the same time and paste that link. Put your Whatnot name on your profile so people can find your shows.</li>
        <li><b>When you're done:</b> tap END STREAM in the menu here, and end it on Twitch or YouTube too. If you forget, the box turns itself off after 4 hours.</li>
      </ol>
      <small>Going live is for approved accounts, 18 and over. The Terms of Service apply to what you stream.</small>
    </div>`;
  const IBTN = '<button type="button" class="lv-i" data-lv-info aria-label="How going live works" aria-expanded="false">i</button>';
  function closeSheet() { const s = $('ip-live-sheet'); if (s) s.remove(); }
  function openSheet() {
    closeSheet(); box();
    const mine = lives.find((l) => l.user_id === meId);
    const el = document.createElement('div'); el.className = 'lv-sheet'; el.id = 'ip-live-sheet';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Go live');
    let platform = 'twitch', helpOpen = false;
    const draw = () => { drawInner(); const h = el.querySelector('.lv-help'), ib = el.querySelector('[data-lv-info]'); if (h) h.hidden = !helpOpen; if (ib) ib.setAttribute('aria-expanded', helpOpen ? 'true' : 'false'); };
    const drawInner = () => {
      el.innerHTML = mine
        ? `<div class="lv-box"><button type="button" class="lv-x" data-lv-sheet-x aria-label="Close">${XSVG}</button>
            <h2>You're live ${IBTN}</h2>${HELP}<p>Your stream is in the box at the top of the feed. It turns itself off 4 hours after you started.</p>
            <button type="button" class="lv-big end" data-lv-end>END STREAM</button><p class="lv-st" role="status"></p></div>`
        : `<div class="lv-box"><button type="button" class="lv-x" data-lv-sheet-x aria-label="Close">${XSVG}</button>
            <h2>Go live ${IBTN}</h2>${HELP}<p>Start your stream on Twitch or YouTube first. Then tap GO LIVE and it plays at the top of the feed for everybody.</p>
            <div class="lv-pick"><button type="button" data-lv-p="twitch" class="${platform === 'twitch' ? 'on' : ''}">Twitch</button><button type="button" data-lv-p="youtube" class="${platform === 'youtube' ? 'on' : ''}">YouTube</button></div>
            ${platform === 'twitch'
              ? `<label>Your Twitch channel<input name="ref" maxlength="40" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="channel name" value="${esc(myTwitch)}"></label>`
              : `<label>Link to your YouTube live stream <small>Whatnot sellers: stream to YouTube too, and paste that link</small><input name="ref" maxlength="200" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="url" placeholder="Paste the link"></label>`}
            <label>What are you doing? <small>optional</small><input name="title" maxlength="60" placeholder="Opening a booster box"></label>
            <button type="button" class="lv-big" data-lv-start>GO LIVE</button><p class="lv-st" role="status"></p>
            <p style="margin:10px 0 0;color:#9eb0c8;font:600 13px/1.4 system-ui,sans-serif;text-align:center">Your followers get an alert when you go live.</p></div>`;
    };
    draw();
    el.addEventListener('click', async (e) => {
      if (e.target === el || e.target.closest('[data-lv-sheet-x]')) return closeSheet();
      if (e.target.closest('[data-lv-info]')) { helpOpen = !helpOpen; const h = el.querySelector('.lv-help'); h.hidden = !helpOpen; e.target.closest('[data-lv-info]').setAttribute('aria-expanded', helpOpen ? 'true' : 'false'); return; }
      const p = e.target.closest('[data-lv-p]');
      if (p) { const t = (el.querySelector('[name=title]') || {}).value || ''; platform = p.getAttribute('data-lv-p'); draw(); el.querySelector('[name=title]').value = t; return; }
      const st = el.querySelector('.lv-st');
      if (e.target.closest('[data-lv-start]')) {
        const btn = e.target.closest('[data-lv-start]');
        let ref = (el.querySelector('[name=ref]').value || '').trim();
        if (platform === 'twitch') ref = ref.replace(/^.*twitch\.tv\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
        else ref = youtubeId(ref);
        if (!ref) { st.textContent = platform === 'twitch' ? 'Type your Twitch channel name.' : 'Paste the link to your YouTube live stream.'; return; }
        btn.disabled = true; st.textContent = 'Going live…';
        const r = await sb().rpc('go_live', { p_platform: platform, p_ref: ref, p_title: el.querySelector('[name=title]').value });
        if (r.error) { btn.disabled = false; st.textContent = r.error.message || 'That didn\'t go through. Try again.'; return; }
        closeSheet(); watching = null; await load(); window.scrollTo(0, 0);
        return;
      }
      if (e.target.closest('[data-lv-end]')) {
        const btn = e.target.closest('[data-lv-end]'); btn.disabled = true; st.textContent = 'Ending…';
        const r = await sb().rpc('end_live');
        if (r.error) { btn.disabled = false; st.textContent = 'That didn\'t go through. Try again.'; return; }
        closeSheet(); await load();
      }
    });
    document.body.appendChild(el);
  }


  /* ---------- THE STREAMER WELCOME (2 Oct 2026, Mike) ----------
     Only for accounts approved to go live. Three steps, plain words:
       1. "You're invited to beta streams!"  -> GO NOW
       2. their Twitch / YouTube / Whatnot names (saved to the profile)
       3. how going live works, start to finish
     It comes up EVERY time they open the app until they tick "Don't show this again".
     Closing it with the X does not count; only the tick does. Remembered per account,
     on this phone. */
  const WEL_OFF = () => 'ip-stream-welcome-off-' + (meId || '');
  const welOff = () => { try { return localStorage.getItem(WEL_OFF()) === '1'; } catch (_) { return false; } };
  const clean = (v) => {
    let h = String(v || '').trim(); if (!h) return null;
    h = h.replace(/^https?:\/\//i, '').replace(/^(www\.|m\.)?[a-z0-9.-]+\.(com|tv|net|co)\//i, '').replace(/^(user|c|channel)\//i, '');
    return h.split(/[/?#]/)[0].replace(/^@/, '') || null;
  };
  const WEL_RULES = { twitch: /^[A-Za-z0-9_]{3,25}$/, youtube: /^[A-Za-z0-9._-]{3,30}$/, whatnot: /^[A-Za-z0-9._-]{1,30}$/ };
  function closeWelcome() { const s = $('ip-live-welcome'); if (s) s.remove(); }
  async function openWelcome(step) {
    closeWelcome(); box();                                   /* box() also loads the styles */
    const el = document.createElement('div'); el.className = 'lv-sheet'; el.id = 'ip-live-welcome';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Beta streams');
    const X = `<button type="button" class="lv-x" data-wl-x aria-label="Close">${XSVG}</button>`;
    const OFF = `<label style="display:flex;align-items:center;gap:10px;margin:16px 0 0;font-weight:700;font-size:14.5px;color:#c9d6ea;cursor:pointer">
        <input type="checkbox" data-wl-off style="width:22px;height:22px;min-height:0;flex:none;accent-color:#19bfff"> Don&rsquo;t show this again</label>`;
    let prof = {};
    const draw = () => {
      if (step === 1) el.innerHTML = `<div class="lv-box" style="text-align:center">${X}
          <div style="font-size:54px;line-height:1;margin:6px 0 10px">&#127881;</div>
          <h2 style="margin:0 0 8px;font-size:25px">Congrats! You&rsquo;re invited to beta streams</h2>
          <p style="font-size:16px;color:#dbe6f5">You can go live on Infinite Pulls. Your Twitch or YouTube stream plays right here in the feed, and your followers get a ping when you start.</p>
          <p style="font-size:15px">It takes about a minute to set up.</p>
          <button type="button" class="lv-big" data-wl-go>GO NOW</button>
          <div style="display:flex;justify-content:center">${OFF}</div></div>`;
      else if (step === 2) el.innerHTML = `<div class="lv-box">${X}
          <h2>Where do you stream?</h2>
          <p>Fill in the ones you use. Skip the ones you don&rsquo;t. These show as buttons on your profile.</p>
          <label>Twitch <small>your channel name</small><input name="twitch" maxlength="80" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="channel name" value="${esc(prof.twitch || '')}"></label>
          <label>YouTube <small>your channel, the name after the @</small><input name="youtube" maxlength="80" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="@yourchannel" value="${esc(prof.youtube || '')}"></label>
          <label>Whatnot <small>your seller name</small><input name="whatnot" maxlength="60" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="@yourname" value="${esc(prof.whatnot || '')}"></label>
          <button type="button" class="lv-big" data-wl-save style="background:#19bfff;color:#03070d">SAVE AND KEEP GOING</button><p class="lv-st" role="status"></p></div>`;
      else el.innerHTML = `<div class="lv-box">${X}
          <h2>How to go live</h2>
          <div style="margin:12px 0 4px">
          <div style="display:flex;align-items:center;gap:14px;padding:14px;margin:0 0 10px;border-radius:16px;background:#03070d;border:1px solid rgba(255,255,255,.12)">
            <span style="flex:none;width:44px;height:44px;border-radius:50%;background:#ff3b4e;color:#fff;display:grid;place-items:center;font:900 22px system-ui">1</span>
            <span><b style="display:block;font:900 18px/1.2 system-ui;color:#fff">Start your stream</b><span style="display:block;margin-top:3px;font:500 14.5px/1.35 system-ui;color:#9eb0c8">On Twitch or YouTube, like always.</span></span></div>
          <div style="display:flex;align-items:center;gap:14px;padding:14px;margin:0 0 10px;border-radius:16px;background:#03070d;border:1px solid rgba(255,255,255,.12)">
            <span style="flex:none;width:44px;height:44px;border-radius:50%;background:#ff3b4e;color:#fff;display:grid;place-items:center;font:900 22px system-ui">2</span>
            <span><b style="display:block;font:900 18px/1.2 system-ui;color:#fff">Tap GO LIVE here</b><span style="display:block;margin-top:3px;font:500 14.5px/1.35 system-ui;color:#9eb0c8">It&rsquo;s in the menu.</span></span></div>
          <div style="display:flex;align-items:center;gap:14px;padding:14px;margin:0 0 10px;border-radius:16px;background:#03070d;border:1px solid rgba(255,255,255,.12)">
            <span style="flex:none;width:44px;height:44px;border-radius:50%;background:#ff3b4e;color:#fff;display:grid;place-items:center;font:900 22px system-ui">3</span>
            <span><b style="display:block;font:900 18px/1.2 system-ui;color:#fff">We do the rest</b><span style="display:block;margin-top:3px;font:500 14.5px/1.35 system-ui;color:#9eb0c8">You&rsquo;re at the top of the feed and your followers get a ping.</span></span></div>
          </div>
          <details style="margin:0 0 14px;padding:12px 14px;border-radius:14px;border:1px solid rgba(25,191,255,.35);color:#dbe6f5;font:500 14.5px/1.5 system-ui">
            <summary style="cursor:pointer;font-weight:800;color:#19bfff">Whatnot? Ending a stream?</summary>
            <p style="margin:10px 0 6px;color:#dbe6f5"><b style="color:#fff">Whatnot:</b> stream to YouTube at the same time and use that link.</p>
            <p style="margin:0;color:#dbe6f5"><b style="color:#fff">Done?</b> Tap END STREAM in the menu.</p>
          </details>
          <button type="button" class="lv-big" data-wl-live>GO LIVE NOW</button>
          <button type="button" class="lv-big" data-wl-x style="margin-top:10px;background:#fff;color:#0a1120">GOT IT, MAYBE LATER</button>
          ${OFF}</div>`;
      const cb = el.querySelector('[data-wl-off]'); if (cb) cb.checked = welOff();
    };
    draw();
    el.addEventListener('change', (e) => {
      if (!e.target.matches('[data-wl-off]')) return;
      try { if (e.target.checked) localStorage.setItem(WEL_OFF(), '1'); else localStorage.removeItem(WEL_OFF()); } catch (_) {}
    });
    el.addEventListener('click', async (e) => {
      if (e.target === el || e.target.closest('[data-wl-x]')) return closeWelcome();
      if (e.target.closest('[data-wl-go]')) {
        try { const r = await sb().from('profiles').select('twitch, youtube, whatnot').eq('id', meId).maybeSingle(); prof = r.data || {}; } catch (_) {}
        step = 2; draw(); return;
      }
      if (e.target.closest('[data-wl-save]')) {
        const btn = e.target.closest('[data-wl-save]'), st = el.querySelector('.lv-st');
        const patch = {};
        for (const k of ['twitch', 'youtube', 'whatnot']) {
          const v = clean(el.querySelector('[name=' + k + ']').value);
          if (v && !WEL_RULES[k].test(v)) { st.textContent = 'That ' + k[0].toUpperCase() + k.slice(1) + ' name doesn’t look right. Just the name, no spaces.'; return; }
          patch[k] = v;
        }
        btn.disabled = true; st.textContent = 'Saving…';
        try {
          const r = await sb().from('profiles').update(patch).eq('id', meId);
          if (r.error) throw r.error;
          myTwitch = patch.twitch || '';
          step = 3; draw(); el.querySelector('.lv-box').scrollTop = 0;
        } catch (err) { btn.disabled = false; st.textContent = 'Could not save that. Check the names and try again.'; }
        return;
      }
      if (e.target.closest('[data-wl-live]')) { closeWelcome(); openSheet(); }
    });
    document.body.appendChild(el);
  }
  /* asked a moment after the app opens; waits its turn if another pop-up is up */
  function armWelcome(tries) {
    if (!canLive || !meId || welOff() || $('ip-live-welcome')) return;
    if (!onFeedHome() || $('profcard')) return;
    const busy = [...document.querySelectorAll('[role=dialog][aria-modal=true]')].some((d) => d.offsetParent !== null || getComputedStyle(d).position === 'fixed');
    if (busy) { if ((tries || 0) < 10) setTimeout(() => armWelcome((tries || 0) + 1), 4000); return; }
    openWelcome(1);
  }

  document.addEventListener('click', (e) => {
    const t = e.target; if (!t.closest) return;
    if (t.closest('[data-golive]')) { e.preventDefault(); e.stopPropagation(); openSheet(); return; }
    const w = t.closest('[data-lv-watch]'); if (w) { watching = w.getAttribute('data-lv-watch'); paint(); return; }
    const p = t.closest('[data-lv-pick]'); if (p) { if (watching) watching = p.getAttribute('data-lv-pick'); else { const id = p.getAttribute('data-lv-pick'); lives.sort((a, b) => (a.user_id === id ? -1 : b.user_id === id ? 1 : 0)); const el = $('ip-live'); if (el) el.dataset.sig = ''; } paint(); return; }
    if (t.closest('[data-lv-close]')) { watching = null; paint(); }
    const pl = t.closest('[data-lv-play]'); if (pl) { const c = pl.closest('.lv-post'); if (c) playCard(c, true); }
  }, true);

  async function start() {
    for (let k = 0; k < 60 && !sb(); k++) await new Promise((r) => setTimeout(r, 150));
    if (!sb()) return;
    await whoAmI();
    await load();
    setTimeout(() => armWelcome(0), 2500);
    try { sb().auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') whoAmI(); }); } catch (_) {}
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) load(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
    /* the feed swaps pages without reloading: keep the box on the right ones */
    const where2 = () => location.search + '|' + (($('profcard') || {}).dataset ? ($('profcard').dataset.who || '~') : '');
    let last = where2();
    setInterval(() => { const now = where2(); if (now !== last) { last = now; paint(); } feedCards(); }, 400);
  }

  window.InfinitePullsLive = { menuRow, open: openSheet, refresh: load, welcome: () => openWelcome(1) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
