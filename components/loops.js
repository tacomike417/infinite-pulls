/* INFINITE LOOPS (27 Sep 2026, Mike)
 *
 * Short videos, 15 seconds at most, like Reels -- for getting to know the
 * people on the site. No cards attached, on purpose.
 *
 *   * A LOOPS row in the feed (after the 3rd post), newest first.
 *   * Tap one: full screen, swipe up for the next. Plays muted; tap for
 *     sound, double-tap for heat. Heat, comments and share down the side.
 *   * Make one from the ADD button (Make a Loop) or the + tile in the row.
 *     Pick a video, write a caption (@ and # work), post. It uploads
 *     straight to Bunny Stream; the page says when it is live.
 *   * A Loop lasts 30 days. Pin up to 3 from its ⋯ menu to keep them --
 *     pinned ones sit at the top of your profile.
 *
 * The server half is supabase/functions/loops (it holds the Bunny key);
 * the table is user_loops (supabase/loops.sql). A Loop's post key is
 * 'l-<id>', so heat and comments use the same tables as every other post.
 *
 * Every screen here goes on the feed's back stack, so the phone's back
 * button closes it. No on-screen back buttons.
 */
(function () {
  'use strict';
  if (window.InfinitePullsLoops) return;

  const CDN = 'https://vz-bf34e88b-2d7.b-cdn.net';
  const TUS = 'https://video.bunnycdn.com/tusupload';
  const TUS_LIB = 'https://cdn.jsdelivr.net/npm/tus-js-client@4.3.1/dist/tus.min.js';
  /* Shrinks the video on the phone before it uploads (mediabunny, uses the
     phone's own video chip through WebCodecs). Loaded only when posting. */
  const MB_LIB = 'https://cdn.jsdelivr.net/npm/mediabunny@1.60.0/dist/bundles/mediabunny.min.mjs';
  const MAX_S = 15.5;
  const RAIL_N = 14;

  const sb = () => window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
  const back = () => window.InfinitePullsFeedBack || null;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const at = (n) => '@' + String(n || '').replace(/^@/, '');

  let meId = null;
  const whoIsIn = () => {
    const c = sb();
    if (!c) return Promise.resolve(null);
    return c.auth.getSession().then(({ data }) => (meId = (data && data.session && data.session.user && data.session.user.id) || null))
      .catch(() => (meId = null));
  };

  /* NOT PUBLIC YET (Mike, 27 Sep 2026): only tacomike417 sees Loops -- the
     row, the profile row, Make a Loop, and Loop links. Everyone else sees
     nothing at all. To open it to everyone, make gate() return true. */
  const TESTERS = ['tacomike417'];   /* Mike only, for now */
  let gateP = null;
  function gate() {
    if (gateP) return gateP;
    if (!sb()) return Promise.resolve(false);
    gateP = whoIsIn().then(async (id) => {
      if (!id) return false;
      try {
        const { data: p } = await sb().from('profiles').select('username').eq('id', id).maybeSingle();
        return !!(p && TESTERS.includes(String(p.username || '').toLowerCase()));
      } catch (_) { return false; }
    }).then((ok) => { api.on = ok; return ok; });
    return gateP;
  }

  const faces = new Map();     /* user id -> { name, face } */
  async function loadFaces(ids) {
    const want = [...new Set(ids)].filter((id) => id && !faces.has(id));
    if (!want.length || !sb()) return;
    try {
      const { data } = await sb().from('profiles').select('id, username, avatar_url').in('id', want);
      (data || []).forEach((p) => faces.set(p.id, { name: p.username || 'someone', face: p.avatar_url || '' }));
    } catch (_) {}
  }
  const faceOf = (id) => faces.get(id) || { name: 'someone', face: '' };
  const avatar = (id, cls) => {
    const f = faceOf(id);
    return f.face ? `<img class="${cls}" src="${esc(f.face)}" alt="" loading="lazy">`
                  : `<span class="${cls} lp-noface">${esc(f.name.slice(0, 1).toUpperCase())}</span>`;
  };

  /* The biggest MP4 Bunny made, 720p at most (phones do not need more). */
  function srcFor(l) {
    const have = String(l.resolutions || '').match(/\d+/g);
    let r = 480;
    if (have && have.length) {
      const ok = have.map(Number).filter((n) => n <= 720).sort((a, b) => b - a);
      if (ok.length) r = ok[0];
    }
    return `${CDN}/${l.video_guid}/play_${r}p.mp4`;
  }
  const thumbFor = (l) => `${CDN}/${l.video_guid}/thumbnail.jpg`;

  function captionHTML(t) {
    return esc(t || '')
      .replace(/(^|[^A-Za-z0-9_])@([A-Za-z0-9_.]{2,31})/g, (m, pre, h) =>
        `${pre}<b class="lp-at" data-lp-name="${esc(h.replace(/\.$/, ''))}">@${h}</b>`)
      .replace(/(^|[^A-Za-z0-9_&])#([A-Za-z][A-Za-z0-9_]{1,30})/g, (m, pre, h) =>
        `${pre}<b class="lp-tag" data-lp-tag="${h.toLowerCase()}">#${h}</b>`);
  }

  function daysLeft(l) {
    const ms = new Date(l.expires_at).getTime() - Date.now();
    return Math.ceil(ms / 86400000);
  }

  /* ---- its own look ---- */
  const CSS = `
html.lp-lock,html.lp-lock body{overflow:hidden}
.lp-rail{margin:14px 0}
.lp-rail h2{margin:0 12px 8px;font:900 15px/1.2 system-ui,-apple-system,sans-serif;letter-spacing:.02em;display:flex;align-items:center;gap:6px}
.lp-rail h2 i{font-style:normal;background:conic-gradient(from 200deg,#ff3d8b,#ffc13d,#3dd6ff,#8b5bff,#ff3d8b);-webkit-background-clip:text;background-clip:text;color:transparent}
.lp-row{display:flex;gap:8px;overflow-x:auto;padding:0 12px 4px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.lp-row::-webkit-scrollbar{display:none}
.lp-tile{flex:0 0 108px;height:176px;border-radius:12px;position:relative;overflow:hidden;background:#111827;border:0;padding:0;cursor:pointer;scroll-snap-align:start;color:#fff}
.lp-tile>img.lp-th{width:100%;height:100%;object-fit:cover;display:block}
.lp-tile .lp-who{position:absolute;left:6px;right:6px;bottom:6px;display:flex;align-items:center;gap:5px;font:800 11px/1.1 system-ui,sans-serif;text-shadow:0 1px 3px #000;text-align:left}
.lp-tile .lp-who span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lp-tile .lp-av{width:22px;height:22px;border-radius:50%;object-fit:cover;border:2px solid #ffc13d;flex:none}
.lp-noface{display:inline-grid;place-items:center;background:#334155;color:#fff;font-weight:900}
.lp-tile::after{content:"";position:absolute;inset:auto 0 0 0;height:50%;background:linear-gradient(transparent,rgba(0,0,0,.7));pointer-events:none}
.lp-tile .lp-who{z-index:1}
.lp-tile .lp-badge{position:absolute;top:6px;left:6px;z-index:1;padding:3px 6px;border-radius:999px;background:rgba(0,0,0,.6);font:800 10px/1 system-ui,sans-serif}
.lp-tile.lp-make{background:linear-gradient(160deg,#1e293b,#0b1220);display:grid;place-items:center;border:2px dashed rgba(255,193,61,.6)}
.lp-make b{display:block;font:900 13px/1.2 system-ui,sans-serif;color:#ffc13d;text-align:center}
.lp-make .lp-plus{display:block;margin:0 auto 6px;width:40px;height:40px;border-radius:50%;background:#ffc13d;color:#1b1400;font:900 28px/40px system-ui;text-align:center}
.lp-tile.lp-dim>img.lp-th{opacity:.45}
.lp-prof{margin:10px 0 6px}
.lp-prof h2{font-size:13px}

.lp{position:fixed;inset:0;z-index:9500;background:#000;color:#fff}
.lp-list{position:absolute;inset:0;overflow-y:auto;scroll-snap-type:y mandatory;overscroll-behavior:contain;scrollbar-width:none}
.lp-list::-webkit-scrollbar{display:none}
.lp-item{position:relative;height:100vh;height:100dvh;scroll-snap-align:start;scroll-snap-stop:always;overflow:hidden;background:#000}
.lp-item video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
.lp-item.tall video{object-fit:cover}
.lp-shade{position:absolute;inset:auto 0 0 0;height:45%;background:linear-gradient(transparent,rgba(0,0,0,.75));pointer-events:none}
.lp-foot{position:absolute;left:14px;right:84px;bottom:calc(22px + env(safe-area-inset-bottom));font:600 14px/1.4 system-ui,-apple-system,sans-serif;text-shadow:0 1px 3px rgba(0,0,0,.8)}
.lp-foot .lp-by{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-weight:900;cursor:pointer;background:none;border:0;color:#fff;padding:0;font-size:15px}
.lp-foot .lp-by img,.lp-foot .lp-by .lp-noface{width:34px;height:34px;border-radius:50%;object-fit:cover;border:2px solid #ffc13d}
.lp-cap{margin:0;white-space:pre-wrap;word-break:break-word;max-height:30vh;overflow:auto}
.lp-at,.lp-tag{color:#ffd23f;cursor:pointer;font-weight:800}
.lp-meta{margin-top:6px;font-size:12px;opacity:.8}
.lp-side{position:absolute;right:8px;bottom:calc(30px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:14px;align-items:center}
.lp-side button{width:60px;border:0;background:none;color:#fff;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;font:800 12px/1 system-ui,sans-serif;text-shadow:0 1px 3px #000;padding:0}
.lp-side svg{width:34px;height:34px;filter:drop-shadow(0 1px 3px rgba(0,0,0,.7));fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.lp-side .on svg{fill:#ff6a1f;stroke:#ffc13d}
.lp-side button:active{transform:scale(.9)}
.lp-hint{position:absolute;top:calc(14px + env(safe-area-inset-top));right:14px;padding:8px 12px;border-radius:999px;background:rgba(0,0,0,.6);font:800 13px/1 system-ui,sans-serif;pointer-events:none;display:none}
.lp-item.need-sound .lp-hint{display:block}
.lp-muted{position:absolute;top:calc(14px + env(safe-area-inset-top));right:14px;padding:6px 10px;border-radius:999px;background:rgba(0,0,0,.55);font:800 12px/1 system-ui,sans-serif}
.lp-top{position:absolute;top:calc(14px + env(safe-area-inset-top));left:14px;font:900 16px/1 system-ui,sans-serif;text-shadow:0 1px 3px #000;pointer-events:none}
.lp-flash{position:absolute;left:50%;top:50%;width:96px;height:96px;margin:-48px 0 0 -48px;border-radius:50%;background:rgba(0,0,0,.45);display:grid;place-items:center;font-size:44px;opacity:0;pointer-events:none;transition:opacity .25s}
.lp-flash.on{opacity:1}
.lp-empty{height:100dvh;display:grid;place-items:center;text-align:center;padding:24px;font:700 16px/1.5 system-ui,sans-serif}

.lp-sheet{position:fixed;left:0;right:0;bottom:0;z-index:9600;max-height:72vh;display:flex;flex-direction:column;background:#fff;color:#0d1725;border-radius:18px 18px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.5);font:500 14px/1.4 system-ui,-apple-system,sans-serif;padding-bottom:env(safe-area-inset-bottom)}
.lp-sheet-dim{position:fixed;inset:0;z-index:9590;background:rgba(0,0,0,.35)}
.lp-sheet h3{margin:0;padding:14px 16px 10px;font:900 15px/1 system-ui,sans-serif;text-align:center;border-bottom:1px solid #e5e7eb}
.lp-cms{flex:1;overflow:auto;padding:8px 14px}
.lp-cm{display:flex;gap:10px;padding:8px 0}
.lp-cm img,.lp-cm .lp-noface{width:32px;height:32px;border-radius:50%;object-fit:cover;flex:none}
.lp-cm b{font-weight:900;margin-right:6px}
.lp-cm small{display:block;color:#64748b;font-size:11px;margin-top:2px}
.lp-cm-none{padding:24px 0;text-align:center;color:#64748b}
.lp-cm-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #e5e7eb}
.lp-cm-form textarea{flex:1;resize:none;height:40px;border:1px solid #cbd5e1;border-radius:20px;padding:10px 14px;font:500 15px/1.2 system-ui,sans-serif;color:#0d1725}
.lp-cm-form button{border:0;border-radius:20px;padding:0 16px;background:#ffc13d;color:#1b1400;font:900 14px/1 system-ui,sans-serif}
.lp-menu button{display:block;width:100%;padding:16px;border:0;border-top:1px solid #eef2f7;background:#fff;color:#0d1725;font:800 15px/1 system-ui,sans-serif;text-align:left;cursor:pointer}
.lp-menu button.warn{color:#c0262d}
.lp-menu p{margin:0;padding:10px 16px;color:#64748b;font-size:13px}

.lp-new{position:fixed;inset:0;z-index:9550;background:#05080f;color:#fff;overflow:auto;font:500 15px/1.4 system-ui,-apple-system,sans-serif}
.lp-new-in{max-width:520px;margin:0 auto;padding:calc(16px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom))}
.lp-new h2{margin:0 0 12px;font:900 20px/1.2 system-ui,sans-serif}
.lp-new h2 i{font-style:normal;background:conic-gradient(from 200deg,#ff3d8b,#ffc13d,#3dd6ff,#8b5bff,#ff3d8b);-webkit-background-clip:text;background-clip:text;color:transparent}
.lp-prev{display:block;width:100%;max-height:52vh;border-radius:14px;background:#000;object-fit:contain}
.lp-new textarea{display:block;box-sizing:border-box;width:100%;margin:12px 0 0;min-height:84px;border-radius:12px;border:1px solid #334155;background:#0f172a;color:#fff;padding:12px;font:500 16px/1.4 system-ui,sans-serif;resize:vertical}
.lp-sw{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 0 0;padding:12px;border-radius:12px;background:#0f172a;font-weight:800}
.lp-sw input{width:22px;height:22px;accent-color:#ffc13d}
.lp-go{display:block;width:100%;margin:16px 0 0;padding:15px;border:0;border-radius:14px;background:linear-gradient(145deg,#ffd23f,#ff9a1f);color:#1b1400;font:900 17px/1 system-ui,sans-serif;cursor:pointer}
.lp-go[disabled]{opacity:.5}
.lp-go-maker{background:linear-gradient(135deg,#ff8a00,#e52e71);color:#fff}
.lp-alt{display:block;width:100%;margin:10px 0 0;padding:13px;border:1px solid #334155;border-radius:14px;background:none;color:#fff;font:800 15px/1 system-ui,sans-serif;cursor:pointer}
.lp-err{margin:12px 0 0;padding:12px;border-radius:12px;background:#3b0d12;color:#ffd7d9;font-weight:700}
.lp-fine{margin:10px 0 0;color:#94a3b8;font-size:12.5px}
.lp-pill{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9400;max-width:calc(100% - 32px);padding:10px 16px;border-radius:999px;background:#0d1725;color:#fff;border:2px solid #ffc13d;box-shadow:0 8px 26px rgba(0,0,0,.45);font:800 14px/1.2 system-ui,sans-serif;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lp-pill .bar{display:block;height:4px;margin-top:6px;border-radius:2px;background:#334155;overflow:hidden}
.lp-pill .bar i{display:block;height:100%;background:#ffc13d;width:0;transition:width .3s}
.lp-toast{position:fixed;left:50%;top:calc(18px + env(safe-area-inset-top));transform:translateX(-50%);z-index:9700;padding:10px 16px;border-radius:12px;background:#fff;color:#0d1725;font:800 14px/1.3 system-ui,sans-serif;box-shadow:0 8px 26px rgba(0,0,0,.4);opacity:0;transition:opacity .2s;pointer-events:none;max-width:calc(100% - 32px);text-align:center}
.lp-toast.on{opacity:1}
`;
  (function addCSS() {
    if (document.getElementById('loops-css')) return;
    const st = document.createElement('style');
    st.id = 'loops-css';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  })();

  function say(msg) {
    let t = document.querySelector('.lp-toast');
    if (!t) { t = document.createElement('div'); t.className = 'lp-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('on');
    clearTimeout(say._t); say._t = setTimeout(() => t.classList.remove('on'), 2800);
  }
  const join = (why) => {
    if (typeof window.InfinitePullsJoin === 'function') window.InfinitePullsJoin(why);
    else location.href = '/?page=account';
  };

  /* ---- a layer on the feed's back stack ---- */
  function pushLayer(tag, close) {
    const b = back();
    if (b) { b.push(tag, close); return true; }
    return false;
  }
  function popLayer(tag, close) {
    const b = back();
    if (!b || !b.pop(tag)) close();
  }

  /* ======================================================================
     READING LOOPS
     ====================================================================== */
  const COLS = 'id, user_id, video_guid, caption, muted, status, pinned, length_s, width, height, resolutions, created_at, expires_at';
  const sets = new Map();       /* 'rail' | 'prof:<id>' -> [loops] */

  async function latest(n) {
    const { data, error } = await sb().from('user_loops').select(COLS)
      .eq('status', 'ready').order('created_at', { ascending: false }).limit(n * 2);
    if (error) throw error;
    const now = Date.now();
    /* my own expired ones come back too (I can always read mine) */
    return (data || []).filter((l) => l.pinned || new Date(l.expires_at).getTime() > now).slice(0, n);
  }

  function tileHTML(l, set, i, mine) {
    const f = faceOf(l.user_id);
    let badge = '';
    let dim = false;
    if (l.status === 'uploading') { badge = 'Processing…'; dim = true; }
    else if (l.status === 'failed') { badge = 'Failed'; dim = true; }
    else if (l.pinned) badge = '📌 Pinned';
    else if (mine) {
      const d = daysLeft(l);
      badge = d <= 0 ? 'Gone soon — pin it' : d <= 7 ? `${d}d left` : '';
      if (d <= 0) dim = true;
    }
    return `<button type="button" class="lp-tile${dim ? ' lp-dim' : ''}" data-lp-open="${esc(set)}" data-lp-i="${i}"
        aria-label="Loop by ${esc(at(f.name))}">
      ${l.status === 'ready' ? `<img class="lp-th" src="${esc(thumbFor(l))}" alt="" loading="lazy">` : ''}
      ${badge ? `<span class="lp-badge">${esc(badge)}</span>` : ''}
      <span class="lp-who">${avatar(l.user_id, 'lp-av')}<span>${esc(at(f.name))}</span></span>
    </button>`;
  }
  const makeTile = () => `<button type="button" class="lp-tile lp-make" data-lp-make>
      <span><span class="lp-plus">+</span><b>Make a<br>Loop</b></span></button>`;

  /* The row in the feed. '' (nothing drawn) until there is something to
     show -- or, for somebody logged in, a + to make the first one. */
  async function railHTML() {
    if (!sb() || !(await gate())) return '';
    let list = [];
    try { list = await latest(RAIL_N); } catch (_) { return ''; }
    if (!list.length && !meId) return '';
    await loadFaces(list.map((l) => l.user_id));
    sets.set('rail', list);
    return `<section class="rail-block lp-rail" data-rail="loops">
      <h2><i>∞</i> Infinite Loops</h2>
      <div class="lp-row">
        ${meId ? makeTile() : ''}
        ${list.map((l, i) => tileHTML(l, 'rail', i, l.user_id === meId)).join('')}
      </div>
    </section>`;
  }

  /* The row on a profile: pinned first, then the rest. Your own page
     shows everything of yours, including ones still processing and ones
     about to go, so you can pin them. */
  async function profileStrip(userId, mine) {
    if (!sb() || !userId || !(await gate())) return '';
    mine = !!mine || userId === meId;
    let list = [];
    try {
      let q = sb().from('user_loops').select(COLS).eq('user_id', userId)
        .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(30);
      if (!mine) q = q.eq('status', 'ready');
      const { data, error } = await q;
      if (error) throw error;
      const now = Date.now();
      list = (data || []).filter((l) => mine || l.pinned || new Date(l.expires_at).getTime() > now);
    } catch (_) { return ''; }
    if (!list.length && !mine) return '';
    await loadFaces([userId]);
    const key = 'prof:' + userId;
    sets.set(key, list);
    return `<section class="lp-rail lp-prof" data-lp-prof="${esc(userId)}">
      <h2><i>∞</i> Loops${mine && list.length ? ' <small style="font-weight:700;opacity:.6;font-size:11px">· 30 days, pin 3 to keep</small>' : ''}</h2>
      <div class="lp-row">
        ${mine ? makeTile() : ''}
        ${list.map((l, i) => tileHTML(l, key, i, mine)).join('')}
      </div>
    </section>`;
  }

  /* ======================================================================
     THE PLAYER
     ====================================================================== */
  let lp = null, lpList = [], io = null, soundOn = true;   /* sound on; if the phone refuses, it says Tap for sound */
  const heatN = new Map(), heatMine = new Set(), talkN = new Map();

  const FLAME = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22c4 0 7-2.7 7-6.8 0-3.4-2.2-5.6-3.6-7.3-.3 1.7-1.2 2.9-2.4 3.4.3-3.3-1.2-6.5-4.3-8.3.3 3-1.2 5-2.7 6.8C4.8 11.3 5 12.6 5 15.2 5 19.3 8 22 12 22z"/></svg>';
  const TALK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z"/></svg>';
  const SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14"/></svg>';
  const MORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" fill="#fff"/><circle cx="12" cy="12" r="1.6" fill="#fff"/><circle cx="19" cy="12" r="1.6" fill="#fff"/></svg>';

  function itemHTML(l, i) {
    const f = faceOf(l.user_id);
    const tall = l.height && l.width ? l.height > l.width : true;
    const key = 'l-' + l.id;
    const n = heatN.get(key) || 0, c = talkN.get(key) || 0;
    const d = daysLeft(l);
    return `<section class="lp-item${tall ? ' tall' : ''}" data-lp-item="${i}">
      <video playsinline loop muted preload="none" poster="${esc(thumbFor(l))}" data-src="${esc(srcFor(l))}"></video>
      <div class="lp-shade"></div>
      ${l.muted ? '<span class="lp-muted">🔇 No sound</span>' : '<span class="lp-hint">🔇 Tap for sound</span>'}
      <span class="lp-flash" aria-hidden="true"></span>
      <div class="lp-foot">
        <button type="button" class="lp-by" data-lp-person="${esc(l.user_id)}">${avatar(l.user_id, '')}<span>${esc(at(f.name))}</span></button>
        ${l.caption ? `<p class="lp-cap">${captionHTML(l.caption)}</p>` : ''}
        ${l.user_id === meId ? `<div class="lp-meta">${l.pinned ? '📌 Pinned — stays on your profile' : d > 0 ? `Gone in ${d} day${d === 1 ? '' : 's'} · pin it to keep it` : 'Gone soon · pin it to keep it'}</div>` : ''}
      </div>
      <div class="lp-side">
        <button type="button" data-lp-heat class="${heatMine.has(key) ? 'on' : ''}" aria-label="Heat">${FLAME}<span class="n">${n}</span></button>
        <button type="button" data-lp-talk aria-label="Comments">${TALK}<span class="n">${c}</span></button>
        <button type="button" data-lp-share aria-label="Share">${SHARE}<span>Share</span></button>
        <button type="button" data-lp-more aria-label="More">${MORE}</button>
      </div>
    </section>`;
  }

  async function loadCounts(list) {
    const keys = list.map((l) => 'l-' + l.id);
    if (!keys.length || !sb()) return;
    try {
      const [h, c] = await Promise.all([
        sb().from('post_heat_counts').select('post_key, n').in('post_key', keys),
        sb().from('post_comment_counts').select('post_key, n').in('post_key', keys)
      ]);
      ((h && h.data) || []).forEach((r) => heatN.set(r.post_key, r.n));
      ((c && c.data) || []).forEach((r) => talkN.set(r.post_key, r.n));
      if (meId) {
        const { data } = await sb().from('post_heat').select('post_key').eq('user_id', meId).in('post_key', keys);
        (data || []).forEach((r) => heatMine.add(r.post_key));
      }
    } catch (_) {}
  }

  function paintSide(i) {
    if (!lp) return;
    const l = lpList[i]; if (!l) return;
    const el = lp.querySelector(`[data-lp-item="${i}"]`); if (!el) return;
    const key = 'l-' + l.id;
    const h = el.querySelector('[data-lp-heat]');
    h.classList.toggle('on', heatMine.has(key));
    h.querySelector('.n').textContent = String(heatN.get(key) || 0);
    el.querySelector('[data-lp-talk] .n').textContent = String(talkN.get(key) || 0);
  }

  function current() {
    if (!lp) return -1;
    const list = lp.querySelector('.lp-list');
    return Math.round(list.scrollTop / Math.max(1, list.clientHeight));
  }

  function wake(i) {
    if (!lp) return;
    lp.querySelectorAll('[data-lp-item]').forEach((el) => {
      const k = Number(el.getAttribute('data-lp-item'));
      const v = el.querySelector('video');
      /* load this one and its neighbours; leave the rest unloaded */
      if (Math.abs(k - i) <= 1 && !v.getAttribute('src')) {
        v.src = v.getAttribute('data-src');
        v.preload = 'auto';
      }
      if (k === i) {
        const l = lpList[k];
        v.muted = !soundOn || !!(l && l.muted);
        el.classList.toggle('need-sound', v.muted && !(l && l.muted));
        const p = v.play();
        if (p && p.catch) p.catch(() => {
          /* the phone would not play it with sound until they tap */
          soundOn = false;
          v.muted = true;
          el.classList.toggle('need-sound', !(l && l.muted));
          v.play().catch(() => {});
        });
      } else {
        try { v.pause(); } catch (_) {}
      }
    });
  }

  function closePlayer() {
    if (io) { io.disconnect(); io = null; }
    closeSheet(true);
    if (lp) {
      lp.querySelectorAll('video').forEach((v) => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (_) {} });
      lp.remove(); lp = null;
    }
    document.documentElement.classList.remove('lp-lock');
  }
  const leavePlayer = () => popLayer('loops', closePlayer);

  async function openPlayer(list, start) {
    if (!list || !list.length) return;
    await whoIsIn();
    closePlayer();
    lpList = list.filter((l) => l.status === 'ready');
    if (!lpList.length) { say('That Loop is still processing.'); return; }
    start = Math.max(0, Math.min(lpList.length - 1, lpList.indexOf(list[start]) >= 0 ? lpList.indexOf(list[start]) : 0));
    await Promise.all([loadFaces(lpList.map((l) => l.user_id)), loadCounts(lpList)]);
    lp = document.createElement('div');
    lp.className = 'lp';
    lp.setAttribute('role', 'dialog');
    lp.setAttribute('aria-label', 'Infinite Loops');
    lp.innerHTML = `<div class="lp-list">${lpList.map(itemHTML).join('')}</div>
      <span class="lp-top">∞ Loops</span>`;
    document.body.appendChild(lp);
    document.documentElement.classList.add('lp-lock');
    pushLayer('loops', closePlayer);
    const listEl = lp.querySelector('.lp-list');
    listEl.scrollTop = start * listEl.clientHeight;

    io = new IntersectionObserver((ents) => {
      ents.forEach((e) => {
        if (e.isIntersecting && e.intersectionRatio >= 0.6) wake(Number(e.target.getAttribute('data-lp-item')));
      });
    }, { root: listEl, threshold: [0.6] });
    lp.querySelectorAll('[data-lp-item]').forEach((el) => io.observe(el));
    wake(start);

    lp.addEventListener('click', onPlayerClick);
  }

  let lastTap = 0, tapTimer = 0;
  function flash(el, what) {
    const f = el.querySelector('.lp-flash'); if (!f) return;
    f.textContent = what; f.classList.add('on');
    clearTimeout(f._t); f._t = setTimeout(() => f.classList.remove('on'), 650);
  }

  async function onPlayerClick(e) {
    const item = e.target.closest('[data-lp-item]');
    const i = item ? Number(item.getAttribute('data-lp-item')) : current();
    const l = lpList[i];

    const person = e.target.closest('[data-lp-person]');
    if (person) { goPerson(person.getAttribute('data-lp-person'), faceOf(person.getAttribute('data-lp-person')).name); return; }
    const name = e.target.closest('[data-lp-name]');
    if (name) { goName(name.getAttribute('data-lp-name')); return; }
    const tag = e.target.closest('[data-lp-tag]');
    if (tag) { goTag(tag.getAttribute('data-lp-tag')); return; }
    if (!l) return;
    if (e.target.closest('[data-lp-heat]')) { toggleHeat(i); return; }
    if (e.target.closest('[data-lp-talk]')) { openTalk(i); return; }
    if (e.target.closest('[data-lp-share]')) { share(l); return; }
    if (e.target.closest('[data-lp-more]')) { openMenu(i); return; }
    if (e.target.closest('.lp-side, .lp-foot')) return;

    /* On the video: one tap is sound, two quick taps is heat. */
    const now = Date.now();
    if (now - lastTap < 300) {
      clearTimeout(tapTimer); lastTap = 0;
      if (!heatMine.has('l-' + l.id)) toggleHeat(i);
      flash(item, '🔥');
      return;
    }
    lastTap = now;
    tapTimer = setTimeout(() => {
      if (l.muted) { say('Sound is off on this one.'); return; }
      soundOn = !soundOn;
      const v = item.querySelector('video');
      v.muted = !soundOn;
      item.classList.toggle('need-sound', !soundOn);
      if (v.paused) v.play().catch(() => {});
      flash(item, soundOn ? '🔊' : '🔇');
    }, 300);
  }

  function goPerson(id, label) {
    const go = window.InfinitePullsFeedGo;
    leavePlayer();
    setTimeout(() => {
      if (go && go.person) go.person(id, label || 'them');
      else if (label) location.href = '/' + encodeURIComponent(label);
    }, 120);
  }
  async function goName(name) {
    try {
      const { data } = await sb().from('profiles').select('id, username').ilike('username', name).maybeSingle();
      if (data) goPerson(data.id, data.username);
    } catch (_) {}
  }
  function goTag(tag) {
    const go = window.InfinitePullsFeedGo;
    leavePlayer();
    setTimeout(() => { if (go && go.tag) go.tag(tag); }, 120);
  }

  async function toggleHeat(i) {
    const l = lpList[i]; if (!l) return;
    if (!meId) { join('Join free to give heat.'); return; }
    const key = 'l-' + l.id;
    const was = heatMine.has(key);
    if (was) heatMine.delete(key); else heatMine.add(key);
    heatN.set(key, Math.max(0, (heatN.get(key) || 0) + (was ? -1 : 1)));
    paintSide(i);
    try {
      const { error } = was
        ? await sb().from('post_heat').delete().eq('post_key', key).eq('user_id', meId)
        : await sb().from('post_heat').insert({ post_key: key, user_id: meId, post_owner: l.user_id });
      if (error && !/duplicate/i.test(error.message || '')) throw error;
    } catch (_) {
      if (was) heatMine.add(key); else heatMine.delete(key);
      heatN.set(key, Math.max(0, (heatN.get(key) || 0) + (was ? 1 : -1)));
      paintSide(i);
      say('Could not save that. Try again.');
    }
  }

  async function share(l) {
    const url = location.origin + '/feed-next/?post=l-' + l.id;
    const f = faceOf(l.user_id);
    try {
      if (navigator.share) { await navigator.share({ title: `${at(f.name)} on Infinite Pulls`, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); say('Link copied.'); } catch (_) { say(url); }
  }

  /* ---- the bottom sheet (comments, ⋯ menu) ---- */
  let sheetEl = null, sheetDim = null;
  function closeSheet(quiet) {
    if (sheetEl) { sheetEl.remove(); sheetEl = null; }
    if (sheetDim) { sheetDim.remove(); sheetDim = null; }
    if (!quiet && window.InfinitePullsMention) window.InfinitePullsMention.hide();
  }
  const leaveSheet = () => popLayer('loopsheet', () => closeSheet());
  function openSheet(title, inner, cls) {
    closeSheet(true);
    sheetDim = document.createElement('div');
    sheetDim.className = 'lp-sheet-dim';
    sheetEl = document.createElement('div');
    sheetEl.className = 'lp-sheet ' + (cls || '');
    sheetEl.setAttribute('role', 'dialog');
    sheetEl.innerHTML = `<h3>${title}</h3>${inner}`;
    document.body.appendChild(sheetDim);
    document.body.appendChild(sheetEl);
    pushLayer('loopsheet', () => closeSheet());
    sheetDim.addEventListener('click', leaveSheet);
    return sheetEl;
  }

  function ago(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  }

  async function openTalk(i) {
    const l = lpList[i]; if (!l) return;
    const key = 'l-' + l.id;
    const box = openSheet('Comments', `<div class="lp-cms"><div class="lp-cm-none">Loading…</div></div>
      ${meId ? `<form class="lp-cm-form"><textarea data-mention maxlength="1000" placeholder="Add a comment… (@ to tag)" rows="1"></textarea><button type="submit">Post</button></form>`
             : `<div class="lp-cm-form"><button type="button" data-lp-join style="flex:1;padding:12px">Log in to comment</button></div>`}`);
    const listEl = box.querySelector('.lp-cms');
    const paint = (rows) => {
      if (!rows.length) { listEl.innerHTML = '<div class="lp-cm-none">No comments yet. Say something nice.</div>'; return; }
      listEl.innerHTML = rows.map((r) => `<div class="lp-cm">${avatar(r.user_id, '')}
        <div><b>${esc(at(faceOf(r.user_id).name))}</b>${captionHTML(r.body)}<small>${ago(r.created_at)}</small></div></div>`).join('');
      listEl.scrollTop = listEl.scrollHeight;
    };
    let rows = [];
    try {
      const { data } = await sb().from('post_comments').select('id, user_id, body, created_at')
        .eq('post_key', key).is('hidden_at', null).order('created_at', { ascending: true }).limit(200);
      rows = data || [];
      await loadFaces(rows.map((r) => r.user_id));
    } catch (_) {}
    if (sheetEl !== box) return;
    paint(rows);
    const j = box.querySelector('[data-lp-join]');
    if (j) j.addEventListener('click', () => { leaveSheet(); setTimeout(() => join('Join free to comment on Loops.'), 80); });
    const form = box.querySelector('form');
    if (!form) return;
    const ta = form.querySelector('textarea');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = ta.value.trim();
      if (!body) return;
      const btn = form.querySelector('button'); btn.disabled = true;
      try {
        const { data, error } = await sb().from('post_comments')
          .insert({ post_key: key, post_owner: l.user_id, user_id: meId, body })
          .select('id, user_id, body, created_at').single();
        if (error) throw error;
        ta.value = '';
        await loadFaces([meId]);
        rows.push(data); paint(rows);
        talkN.set(key, (talkN.get(key) || 0) + 1); paintSide(i);
      } catch (err) { say((err && err.message) || 'Could not post that.'); }
      btn.disabled = false;
    });
  }

  function openMenu(i) {
    const l = lpList[i]; if (!l) return;
    const mine = !!meId && l.user_id === meId;
    const rows = mine
      ? `${l.pinned ? '<button type="button" data-m="unpin">Unpin</button>' : '<button type="button" data-m="pin">📌 Pin to my profile (keeps it)</button>'}
         <button type="button" data-m="caption">✏️ Edit caption</button>
         <button type="button" data-m="copy">🔗 Copy link</button>
         <button type="button" class="warn" data-m="delete">🗑 Delete this Loop</button>`
      : `<button type="button" data-m="copy">🔗 Copy link</button>
         <button type="button" class="warn" data-m="report">🚩 Report this Loop</button>`;
    const box = openSheet('Loop', `<div class="lp-menu">${rows}</div>`);
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      const m = b.getAttribute('data-m');
      if (m === 'copy') {
        try { await navigator.clipboard.writeText(location.origin + '/feed-next/?post=l-' + l.id); say('Link copied.'); } catch (_) {}
        leaveSheet(); return;
      }
      if (m === 'pin' || m === 'unpin') {
        const { error } = await sb().from('user_loops').update({ pinned: m === 'pin' }).eq('id', l.id);
        if (error) { say(/3 Loops/.test(error.message || '') ? 'You can keep 3 pinned. Unpin one first.' : 'Could not save that.'); return; }
        l.pinned = m === 'pin';
        say(l.pinned ? 'Pinned. It stays on your profile.' : 'Unpinned.');
        leaveSheet(); return;
      }
      if (m === 'caption') {
        leaveSheet();
        setTimeout(() => editCaption(i), 120);
        return;
      }
      if (m === 'delete') {
        if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Tap again to delete it for good'; return; }
        b.disabled = true; b.textContent = 'Deleting…';
        const r = await callLoops({ action: 'delete', id: l.id });
        if (r.error) { say(r.error); b.disabled = false; return; }
        leaveSheet();
        say('Deleted.');
        setTimeout(leavePlayer, 150);
        refreshRows();
        return;
      }
      if (m === 'report') {
        if (!meId) { leaveSheet(); setTimeout(() => join('Join free to report.'), 80); return; }
        box.querySelector('.lp-menu').innerHTML = `<p>What's wrong with it?</p>
          <button type="button" data-r="Spam or scam">Spam or scam</button>
          <button type="button" data-r="Not OK for this site">Not OK for this site</button>
          <button type="button" data-r="Copyright -- uses my photo, video or music">Uses my photo, video or music (copyright)</button>`;
        return;
      }
    });
    box.addEventListener('click', async (e) => {
      const r = e.target.closest('[data-r]'); if (!r) return;
      try {
        const { error } = await sb().from('post_reports').insert({
          post_key: 'l-' + l.id, post_owner: l.user_id, reporter_id: meId, reason: r.getAttribute('data-r') });
        if (error && !/duplicate/i.test(error.message || '')) throw error;
        say('Thanks. The shop will take a look.');
      } catch (_) { say('Could not send that. Try again.'); }
      leaveSheet();
    });
  }

  function editCaption(i) {
    const l = lpList[i]; if (!l) return;
    const box = openSheet('Edit caption', `<form class="lp-cm-form" style="flex-direction:column;border:0">
      <textarea data-mention maxlength="500" style="height:110px;border-radius:12px">${esc(l.caption || '')}</textarea>
      <button type="submit" style="padding:14px">Save</button></form>`);
    const form = box.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const caption = form.querySelector('textarea').value.trim().slice(0, 500) || null;
      const { error } = await sb().from('user_loops').update({ caption }).eq('id', l.id);
      if (error) { say('Could not save that.'); return; }
      l.caption = caption;
      const cap = lp && lp.querySelector(`[data-lp-item="${i}"] .lp-foot`);
      if (cap) {
        const p = cap.querySelector('.lp-cap');
        if (p) p.innerHTML = captionHTML(caption || '');
        else if (caption) cap.querySelector('.lp-by').insertAdjacentHTML('afterend', `<p class="lp-cap">${captionHTML(caption)}</p>`);
      }
      leaveSheet();
    });
  }

  async function callLoops(body) {
    try {
      const { data, error } = await sb().functions.invoke('loops', { body });
      if (error) {
        let msg = 'Something went wrong. Try again.';
        try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (_) {}
        return { error: msg };
      }
      return data || {};
    } catch (_) { return { error: 'No connection. Try again.' }; }
  }

  /* ======================================================================
     MAKING ONE
     ====================================================================== */
  let newEl = null, picked = null, pickedURL = '';
  let vpick = null;

  /* THE LOOP MAKER -- photos + style + text + stickers into a video
     (components/loop-maker.js, loaded the first time it is asked for). */
  let makerReady = null;
  function openMaker() {
    if (!makerReady) makerReady = new Promise((ok, no) => {
      if (window.InfinitePullsLoopMaker) return ok();
      const s = document.createElement('script');
      s.src = '/components/loop-maker.js';
      s.onload = ok; s.onerror = () => { makerReady = null; no(new Error('load')); };
      document.head.appendChild(s);
    });
    makerReady.then(() => window.InfinitePullsLoopMaker.open({ onDone: (file) => startWithFile(file) }))
      .catch(() => say('Could not open the maker. Check your connection.'));
  }

  function chooser() {
    if (!vpick) {
      vpick = document.createElement('input');
      vpick.type = 'file';
      vpick.accept = 'video/*';
      vpick.style.display = 'none';
      document.body.appendChild(vpick);
      vpick.addEventListener('change', () => {
        const f = vpick.files && vpick.files[0];
        vpick.value = '';
        if (f) startWithFile(f);
      });
    }
    vpick.click();       /* must be inside the tap */
  }

  function closeNew() {
    if (pickedURL) { try { URL.revokeObjectURL(pickedURL); } catch (_) {} pickedURL = ''; }
    if (newEl) { newEl.remove(); newEl = null; }
    if (!lp) document.documentElement.classList.remove('lp-lock');
    if (window.InfinitePullsMention) window.InfinitePullsMention.hide();
  }
  const leaveNew = () => popLayer('loopnew', closeNew);

  function lengthOf(url) {
    return new Promise((ok) => {
      const v = document.createElement('video');
      v.preload = 'metadata'; v.muted = true;
      const done = (n) => { v.removeAttribute('src'); ok(n); };
      v.onloadedmetadata = () => done(isFinite(v.duration) ? v.duration : 0);
      v.onerror = () => done(-1);
      setTimeout(() => done(0), 8000);
      v.src = url;
    });
  }

  async function startWithFile(file) {
    await whoIsIn();
    if (!meId) { join('Join free to post Loops.'); return; }
    if (!(await gate())) return;
    if (uploading) { say('One Loop is still uploading. Hang on a sec.'); return; }
    /* ∞ Loop opens straight into the maker (Mike, 27 Sep): record, pick,
       or make one from photos -- all from there. */
    if (!file) { openMaker(); return; }
    const fresh = !newEl;
    if (fresh) {
      newEl = document.createElement('div');
      newEl.className = 'lp-new';
      newEl.setAttribute('role', 'dialog');
      document.body.appendChild(newEl);
      document.documentElement.classList.add('lp-lock');
      pushLayer('loopnew', closeNew);
    }
    if (pickedURL) { try { URL.revokeObjectURL(pickedURL); } catch (_) {} pickedURL = ''; }
    picked = file || null;

    if (!picked) {
      newEl.innerHTML = `<div class="lp-new-in"><h2><i>∞</i> Make a Loop</h2>
        <p>A short video, 15 seconds max. Say hi, show off your shelf, open a pack.</p>
        <button type="button" class="lp-go" data-lp-pick>🎥 Pick a video</button>
        <button type="button" class="lp-go lp-go-maker" data-lp-maker>✨ Make one from photos</button>
        <p class="lp-fine">No video? Pick a few photos, a style and some stickers — we make the video for you.</p>
        <p class="lp-fine">Loops last 30 days. Pin up to 3 to keep them on your profile.</p></div>`;
      wireNew();
      return;
    }
    pickedURL = URL.createObjectURL(picked);
    newEl.innerHTML = `<div class="lp-new-in"><h2><i>∞</i> New Loop</h2><div class="lp-fine">Checking the video…</div></div>`;
    const secs = await lengthOf(pickedURL);
    if (!newEl) return;
    if (secs > MAX_S) {
      newEl.innerHTML = `<div class="lp-new-in"><h2><i>∞</i> New Loop</h2>
        <div class="lp-err">That video is ${Math.round(secs)} seconds. Loops are 15 seconds max. Trim it in your Photos app, then pick it again.</div>
        <button type="button" class="lp-go" data-lp-pick>Pick another video</button></div>`;
      wireNew();
      return;
    }
    newEl.innerHTML = `<div class="lp-new-in">
      <h2><i>∞</i> New Loop</h2>
      <video class="lp-prev" src="${esc(pickedURL)}" playsinline autoplay loop muted></video>
      <form class="lp-new-form">
        <textarea data-mention maxlength="500" placeholder="Say something… @ to tag people, # for tags"></textarea>
        <label class="lp-sw"><span>🔇 Mute sound</span><input type="checkbox" name="muted"></label>
        <button type="submit" class="lp-go">Post Loop</button>
        <button type="button" class="lp-alt" data-lp-pick>Pick a different video</button>
        <p class="lp-fine">Lasts 30 days. Pin up to 3 to keep them. Only post music and video you have the right to share.</p>
      </form></div>`;
    wireNew();
  }

  function wireNew() {
    if (!newEl) return;
    newEl.querySelectorAll('[data-lp-pick]').forEach((b) => b.addEventListener('click', chooser));
    newEl.querySelectorAll('[data-lp-maker]').forEach((b) => b.addEventListener('click', openMaker));
    const form = newEl.querySelector('.lp-new-form');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const caption = form.querySelector('textarea').value.trim();
      const muted = form.querySelector('[name=muted]').checked;
      const file = picked;
      if (!file) return;
      form.querySelector('.lp-go').disabled = true;
      leaveNew();
      upload(file, caption, muted);
    });
  }

  /* ---- uploading, with a pill that says how it is going ---- */
  let uploading = false, pill = null;
  function pillSay(html, onTap) {
    if (!pill) {
      pill = document.createElement('div');
      pill.className = 'lp-pill';
      document.body.appendChild(pill);
      pill.addEventListener('click', () => { if (pill && pill._tap) pill._tap(); });
    }
    pill.innerHTML = html;
    pill._tap = onTap || null;
  }
  function pillGone(ms) {
    const p = pill;
    setTimeout(() => { if (pill === p && p) { p.remove(); pill = null; } }, ms || 0);
  }

  let tusReady = null;
  function loadTus() {
    if (window.tus) return Promise.resolve(window.tus);
    if (!tusReady) tusReady = new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = TUS_LIB; s.async = true;
      s.onload = () => (window.tus ? ok(window.tus) : no(new Error('no tus')));
      s.onerror = () => { tusReady = null; no(new Error('could not load')); };
      document.head.appendChild(s);
    });
    return tusReady;
  }

  /* SHRINK IT FIRST (27 Sep 2026). A phone records 15 seconds at 20-60 MB;
     720p is all the player shows. Re-made on the phone at 720p, about
     3 Mbps -- usually 5-6 MB. Anything that goes wrong (an old phone, an
     odd file) and the original goes up instead; shrinking is a bonus,
     never a reason a Loop fails. */
  async function shrink(file, onP) {
    if (!('VideoEncoder' in window) || file.size < 6 * 1024 * 1024) return file;
    try {
      const M = await import(MB_LIB);
      const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
      const vt = await input.getPrimaryVideoTrack();
      if (!vt) return file;
      const w = vt.displayWidth, h = vt.displayHeight;
      const short = Math.min(w, h);
      const size = short > 720 ? (w <= h ? { width: 720 } : { height: 720 }) : {};
      const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
      const conv = await M.Conversion.init({
        input, output,
        video: Object.assign({ codec: 'avc', bitrate: 3000000 }, size),
        audio: { codec: 'aac', bitrate: 128000 },
        trim: { start: 0, end: 15.5 },
        showWarnings: false
      });
      /* never trade the sound for a smaller file: if the phone cannot carry
         the audio across, upload the original */
      if (!conv.isValid || (conv.discardedTracks || []).length) return file;
      conv.onProgress = (p) => onP && onP(p);
      await conv.execute();
      const buf = output.target.buffer;
      if (!buf || buf.byteLength < 1000 || buf.byteLength >= file.size) return file;
      return new File([buf], 'loop.mp4', { type: 'video/mp4' });
    } catch (_) {
      return file;
    }
  }

  async function upload(file, caption, muted) {
    uploading = true;
    pillSay('Getting your Loop ready… keep this page open<span class="bar"><i></i></span>');
    file = await shrink(file, (p) => {
      const pct = Math.round(p * 100);
      pillSay(`Getting your Loop ready… ${pct}% · keep this page open<span class="bar"><i style="width:${pct}%"></i></span>`);
    });
    pillSay('Starting your Loop…<span class="bar"><i></i></span>');
    const [tus, made] = await Promise.all([loadTus().catch(() => null), callLoops({ action: 'start', caption, muted, bytes: file.size })]);
    if (made.error || !tus) {
      uploading = false;
      pillSay('😕 ' + esc(made.error || 'Could not load the uploader. Try again.'));
      pillGone(5000);
      return;
    }
    const up = new tus.Upload(file, {
      endpoint: TUS,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      chunkSize: 8 * 1024 * 1024,
      headers: {
        AuthorizationSignature: made.signature,
        AuthorizationExpire: String(made.expire),
        VideoId: made.guid,
        LibraryId: String(made.library)
      },
      metadata: { filetype: file.type || 'video/mp4', title: 'loop' },
      onProgress: (sent, total) => {
        const pct = total ? Math.round((sent / total) * 100) : 0;
        pillSay(`Uploading your Loop… ${pct}% · keep this page open<span class="bar"><i style="width:${pct}%"></i></span>`);
      },
      onError: () => {
        uploading = false;
        pillSay('😕 The upload stopped. Check your connection and try again.');
        pillGone(6000);
      },
      onSuccess: () => {
        pillSay('Almost there… getting it ready to play<span class="bar"><i style="width:100%"></i></span>');
        waitReady(made.id, 0);
      }
    });
    up.start();
  }

  function waitReady(id, tries) {
    setTimeout(async () => {
      const r = await callLoops({ action: 'done', id });
      if (r.status === 'ready') {
        uploading = false;
        pillSay('🎉 Your Loop is live! Tap to watch', async () => {
          pillGone(0);
          const { data } = await sb().from('user_loops').select(COLS).eq('id', id).maybeSingle();
          if (data) openPlayer([data], 0);
        });
        pillGone(9000);
        refreshRows();
        return;
      }
      if (r.status === 'failed' || tries > 90) {
        uploading = false;
        pillSay('😕 ' + esc(r.error || 'That one did not work. Try another video.'));
        pillGone(7000);
        return;
      }
      waitReady(id, tries + 1);
    }, tries < 5 ? 3000 : 5000);
  }

  /* Redraw any Loops rows on screen (after posting or deleting). */
  async function refreshRows() {
    const rail = document.querySelector('[data-rail="loops"]');
    if (rail) {
      const html = await railHTML();
      if (html) rail.outerHTML = html; else rail.remove();
    }
    document.querySelectorAll('[data-lp-prof]').forEach(async (el) => {
      const html = await profileStrip(el.getAttribute('data-lp-prof'));
      if (el.isConnected) { if (html) el.outerHTML = html; else el.remove(); }
    });
  }

  /* ---- taps on the rows (feed and profiles) ---- */
  document.addEventListener('click', (e) => {
    const make = e.target.closest('[data-lp-make]');
    if (make) {
      e.preventDefault();
      if (!meId) { join('Join free to post Loops.'); return; }
      startWithFile(null);
      return;
    }
    const t = e.target.closest('[data-lp-open]');
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    const list = sets.get(t.getAttribute('data-lp-open')) || [];
    const l = list[Number(t.getAttribute('data-lp-i'))];
    if (!l) return;
    if (l.status !== 'ready') { say(l.status === 'failed' ? 'That one did not work. Delete it and try again.' : 'Still processing. Give it a minute.'); if (l.status === 'failed' && l.user_id === meId) openFailed(l); return; }
    const ready = list.filter((x) => x.status === 'ready');
    openPlayer(ready, ready.indexOf(l));
  });

  async function openFailed(l) {
    const r = await callLoops({ action: 'delete', id: l.id });
    if (!r.error) refreshRows();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (sheetEl) leaveSheet();
      else if (newEl) leaveNew();
      else if (lp) leavePlayer();
    }
    if (lp && !sheetEl && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const listEl = lp.querySelector('.lp-list');
      listEl.scrollBy({ top: (e.key === 'ArrowDown' ? 1 : -1) * listEl.clientHeight, behavior: 'smooth' });
    }
  });

  /* ---- links: ?post=l-<id> opens that Loop, ?loop=new opens the maker ---- */
  async function fromLink() {
    let u;
    try { u = new URL(location.href); } catch (_) { return; }
    const post = u.searchParams.get('post') || '';
    const m = /^l-([0-9a-f-]{36})$/.exec(post.trim());
    const wantsNew = u.searchParams.get('loop') === 'new';
    if (!m && !wantsNew) return;
    /* wait for the feed to be up (it sets the shared client and back stack) */
    for (let k = 0; k < 40 && !(sb() && back()); k++) await new Promise((r) => setTimeout(r, 150));
    if (!sb() || !(await gate())) return;
    if (wantsNew) {
      u.searchParams.delete('loop');
      try { history.replaceState(history.state, '', u.pathname + u.search); } catch (_) {}
      startWithFile(null);
      return;
    }
    try {
      const { data } = await sb().from('user_loops').select(COLS).eq('id', m[1]).maybeSingle();
      if (!data) { say('That Loop is gone. Loops last 30 days.'); return; }
      let more = [];
      try { more = (await latest(RAIL_N)).filter((l) => l.id !== data.id); } catch (_) {}
      await openPlayer([data].concat(more), 0);
      if (u.searchParams.get('talk') === '1' && lp) setTimeout(() => openTalk(0), 300);
    } catch (_) {}
  }

  const api = { on: false, railHTML, profileStrip, startWithFile, refreshRows };
  window.InfinitePullsLoops = api;
  gate();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fromLink);
  else fromLink();

})();
