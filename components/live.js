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
.lv-st{min-height:20px;margin:8px 0 0;color:#ffc928;font-weight:800;font-size:14px}`;

  const XSVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const face = (l) => l.face ? `<img src="${esc(l.face)}" alt="">` : `<span>${esc((l.name || '?').slice(0, 1).toUpperCase())}</span>`;
  const where = (l) => (l.platform === 'youtube' ? 'YouTube' : 'Twitch');
  const outLink = (l) => (l.platform === 'youtube' ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(l.ref) : 'https://www.twitch.tv/' + encodeURIComponent(l.ref));
  const frameSrc = (l) => (l.platform === 'youtube'
    ? 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(l.ref) + '?autoplay=1&playsinline=1&rel=0'
    : 'https://player.twitch.tv/?channel=' + encodeURIComponent(l.ref) + '&parent=' + encodeURIComponent(location.hostname) + '&autoplay=true');

  /* which profile is on screen, if any (the feed's own address: ?who=name) */
  function profileName() {
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
      `<button type="button" class="lv-chip${l.user_id === cur.user_id ? ' on' : ''}" data-lv-pick="${esc(l.user_id)}">${face(l)}@${esc(l.name)}</button>`).join('')}</div>` : '';
    el.innerHTML = watching
      ? `<div class="lv-card">
          <div class="lv-top"><span class="lv-pill"><i></i>LIVE</span><a href="/feed-next/?who=${encodeURIComponent(cur.name)}">@${esc(cur.name)}${cur.title ? ' &middot; ' + esc(cur.title) : ''}</a>
            <button type="button" class="lv-x" data-lv-close aria-label="Close the stream">${XSVG}</button></div>
          <div class="lv-frame"><iframe src="${esc(frameSrc(cur))}" title="@${esc(cur.name)} live on ${where(cur)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
          <div class="lv-foot"><span>Live on ${where(cur)}</span><a href="${esc(outLink(cur))}" target="_blank" rel="noopener">Open in ${where(cur)} &#8599;</a></div>
          ${more}</div>`
      : `<div class="lv-card">
          <button type="button" class="lv-row" data-lv-watch="${esc(cur.user_id)}" aria-label="Watch @${esc(cur.name)} live">
            <span class="lv-face">${face(cur)}</span>
            <span class="lv-tx"><span class="lv-pill"><i></i>LIVE</span><b>@${esc(cur.name)}</b><small>${esc(cur.title || 'Live on ' + where(cur))}</small></span>
            <span class="lv-go">WATCH</span></button>
          ${more}</div>`;
    el.hidden = false;
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
      paint();
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
        <li><b>What people see:</b> a red LIVE box at the top of the feed with your face on it. They tap WATCH and your stream plays right in the app.</li>
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
            <button type="button" class="lv-big" data-lv-start>GO LIVE</button><p class="lv-st" role="status"></p></div>`;
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

  document.addEventListener('click', (e) => {
    const t = e.target; if (!t.closest) return;
    if (t.closest('[data-golive]')) { e.preventDefault(); e.stopPropagation(); openSheet(); return; }
    const w = t.closest('[data-lv-watch]'); if (w) { watching = w.getAttribute('data-lv-watch'); paint(); return; }
    const p = t.closest('[data-lv-pick]'); if (p) { if (watching) watching = p.getAttribute('data-lv-pick'); else { const id = p.getAttribute('data-lv-pick'); lives.sort((a, b) => (a.user_id === id ? -1 : b.user_id === id ? 1 : 0)); const el = $('ip-live'); if (el) el.dataset.sig = ''; } paint(); return; }
    if (t.closest('[data-lv-close]')) { watching = null; paint(); }
  }, true);

  async function start() {
    for (let k = 0; k < 60 && !sb(); k++) await new Promise((r) => setTimeout(r, 150));
    if (!sb()) return;
    await whoAmI();
    await load();
    try { sb().auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') whoAmI(); }); } catch (_) {}
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) load(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
    /* the feed swaps pages without reloading: keep the box on the right ones */
    let last = location.search;
    setInterval(() => { if (location.search !== last) { last = location.search; paint(); } }, 400);
  }

  window.InfinitePullsLive = { menuRow, open: openSheet, refresh: load };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
