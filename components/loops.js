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

  /* LAUNCHED 27 Sep 2026 (was: only tacomike417 saw Loops -- the
     row, the profile row, Make a Loop, and Loop links. Everyone else sees
     nothing at all. To open it to everyone, set PUBLIC = true (just below). */
  const TESTERS = ['tacomike417'];   /* Mike only, for now */
  let isTester = false;
  /* THE FEED ROW WAITS FOR 5 (27 Sep): a strip of one or two looks dead, so
     it only shows once there are this many -- testers always see it. */
  const MIN_ROW = 1;   /* 28 Sep 2026 (Mike): show the row from the first Loop, so early ones get seen */
  let gateP = null;
  /* THE LAUNCH SWITCH. false = only TESTERS see Loops (and the welcome
     pop-up shows them every time). true = everybody, guests too (and the
     pop-up shows once per phone -- testers included). */
  const PUBLIC = true;     /* LIVE for everyone -- 27 Sep 2026, 10 pm (Mike) */

  function gate() {
    if (gateP) return gateP;
    if (!sb()) return Promise.resolve(false);
    gateP = whoIsIn().then(async (id) => {
      try {
        const { error } = await sb().from('user_loops').select('card_name').limit(1);
        if (error) { cardCols = false; COLS = BASE_COLS; }
      } catch (_) { cardCols = false; COLS = BASE_COLS; }
      if (!id) return PUBLIC;
      try {
        const { data: p } = await sb().from('profiles').select('username').eq('id', id).maybeSingle();
        isTester = !!(p && TESTERS.includes(String(p.username || '').toLowerCase()));
        return PUBLIC || isTester;
      } catch (_) { return PUBLIC; }
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
.lp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:2px}
.lp-gt{position:relative;aspect-ratio:9/16;border:0;padding:0;background:#111827;overflow:hidden;cursor:pointer;color:#fff}
.lp-gt img{width:100%;height:100%;object-fit:cover;display:block}
.lp-gt.lp-dim img{opacity:.45}
.lp-gt .lp-badge{position:absolute;top:6px;left:6px;padding:3px 6px;border-radius:999px;background:rgba(0,0,0,.6);font:800 10px/1 system-ui,sans-serif}
.lp-gt .lp-len{position:absolute;left:6px;bottom:6px;font:800 11px/1 system-ui,sans-serif;text-shadow:0 1px 3px #000}
.lp-gt-make{background:linear-gradient(160deg,#1e293b,#0b1220);outline:2px dashed rgba(255,193,61,.7);outline-offset:-6px;display:grid;place-items:center;color:#ffc13d;font:900 13px/1.2 system-ui,sans-serif}
.lp-gt-make .lp-plus{display:block;margin:0 auto 6px;width:36px;height:36px;border-radius:50%;background:#ffc13d;color:#1b1400;font:900 26px/36px system-ui;text-align:center}
.lp-grid-note{margin:10px 12px;color:#9eb0c8;font-size:12px}
.lp-prof h2{font-size:13px}

.lp{position:fixed;inset:0;z-index:9500;background:#000;color:#fff}
.lp-list{position:absolute;inset:0;overflow-y:auto;scroll-snap-type:y mandatory;overscroll-behavior:contain;scrollbar-width:none}
.lp-list::-webkit-scrollbar{display:none}
.lp-item{position:relative;height:100vh;height:100dvh;scroll-snap-align:start;scroll-snap-stop:always;overflow:hidden;background:#000}
.lp-item video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:transparent}
/* behind a Loop that doesn't fill the screen: its own picture, blurred and dim,
   instead of flat black bars */
.lp-bg{position:absolute;inset:-40px;background:#000 center/cover no-repeat;filter:blur(28px) brightness(.45);pointer-events:none}
.lp-item.tall .lp-bg{display:none}
.lp-item.tall video{object-fit:cover}
.lp-shade{position:absolute;inset:auto 0 0 0;height:45%;background:linear-gradient(transparent,rgba(0,0,0,.75));pointer-events:none}
.lp-foot{position:absolute;left:14px;right:84px;bottom:calc(22px + env(safe-area-inset-bottom));font:600 14px/1.4 system-ui,-apple-system,sans-serif;text-shadow:0 1px 3px rgba(0,0,0,.8)}
.lp-foot .lp-by{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-weight:900;cursor:pointer;background:none;border:0;color:#fff;padding:0;font-size:15px}
.lp-foot .lp-by img,.lp-foot .lp-by .lp-noface{width:34px;height:34px;border-radius:50%;object-fit:cover;border:2px solid #ffc13d}
.lp-cardchip{display:flex;align-items:center;gap:10px;margin:8px 0 0;max-width:100%;padding:6px 12px 6px 6px;border:1.5px solid rgba(255,193,61,.8);border-radius:12px;background:rgba(0,0,0,.55);color:#fff;text-align:left;font:inherit;cursor:pointer;text-shadow:none}
.lp-cardchip img,.lp-cardchip .ph{flex:none;width:32px;height:44px;border-radius:4px;object-fit:cover;background:#0f172a;display:grid;place-items:center}
.lp-cardchip span{min-width:0}
.lp-cardchip b{display:block;font:900 14px/1.2 system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lp-cardchip small{display:block;font:600 11.5px/1.2 system-ui,sans-serif;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lp-cardchip i{flex:none;margin-left:auto;font:800 12px/1 system-ui,sans-serif;font-style:normal;color:#ffc13d}
/* tagging the card when posting */
.lp-tagcard{margin:12px 0 0}
.lp-tagcard>p{margin:0 0 6px;font:800 13px/1.2 system-ui,sans-serif;color:#cbd5e1}
.lp-tagbtn{display:flex;align-items:center;gap:10px;width:100%;padding:12px;border:2px dashed #ffc13d;border-radius:12px;background:none;color:#ffc13d;font:900 15px/1.2 system-ui,sans-serif;text-align:left;cursor:pointer}
.lp-tagbtn.set{border-style:solid;background:#2a2410;color:#fff}
.lp-tagbtn img,.lp-tagbtn .ph{flex:none;width:36px;height:50px;border-radius:4px;object-fit:cover;background:#0f172a;display:grid;place-items:center}
.lp-tagbtn small{display:block;color:#cbd5e1;font-weight:600;font-size:12px;margin-top:2px}
.lp-tagbtn .x{margin-left:auto;flex:none;width:30px;height:30px;border-radius:50%;background:#0f172a;color:#fff;display:grid;place-items:center;font-size:14px}
.lp-pick{margin-top:8px;padding:10px;border-radius:12px;background:#0f172a;border:1px solid #334155}
.lp-pick[hidden]{display:none}
.lp-pick input{box-sizing:border-box;width:100%;padding:12px;border-radius:10px;border:1px solid #334155;background:#05080f;color:#fff;font:600 16px/1.2 system-ui,sans-serif}
.lp-pick ul{list-style:none;margin:8px 0 0;padding:0;max-height:260px;overflow:auto}
.lp-pick li button{display:flex;align-items:center;gap:10px;width:100%;padding:8px;border:0;border-radius:10px;background:none;color:#fff;text-align:left;font:800 14px/1.25 system-ui,sans-serif;cursor:pointer}
.lp-pick li button:active{background:#1e293b}
.lp-pick li img,.lp-pick li .ph{flex:none;width:34px;height:47px;border-radius:4px;object-fit:cover;background:#1e293b;display:grid;place-items:center}
.lp-pick li small{display:block;color:#94a3b8;font-weight:600;font-size:12px}
.lp-pick .none{margin:10px 4px 4px;color:#94a3b8;font-size:13px}
.lp-pick .rule{margin:8px 4px 4px;padding:8px 10px;border-radius:10px;background:rgba(255,193,61,.12);color:#ffd67a;font:800 13px/1.3 system-ui,sans-serif}
.lp-pick li button.nopic{opacity:.45;cursor:not-allowed}
.lp-pick li button.nopic small{color:#fca5a5}
/* Loops on a card's page / #tag page */
.lp-strip{margin:8px 0 4px}
.lp-cap{margin:0;white-space:pre-wrap;word-break:break-word;max-height:30vh;overflow:auto}
.lp-at,.lp-tag{color:#ffd23f;cursor:pointer;font-weight:800}
.lp-meta{margin-top:6px;font-size:12px;opacity:.8}
.lp-side{position:absolute;right:8px;bottom:calc(30px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:14px;align-items:center}
.lp-side button{width:60px;border:0;background:none;color:#fff;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;font:800 12px/1 system-ui,sans-serif;text-shadow:0 1px 3px #000;padding:0}
.lp-side svg{width:34px;height:34px;filter:drop-shadow(0 1px 3px rgba(0,0,0,.7));fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.lp-side .on svg{fill:#ff6a1f;stroke:#ffc13d}
.lp-side button:active{transform:scale(.9)}
/* SOUND IS GREEN OR RED, WITH THE WORD ON IT (Mike, 28 Sep 2026): a grey
   speaker made people guess. Red "Sound off" = tap for sound; green
   "Sound on" = you're hearing it. */
.lp-snd{position:absolute;z-index:3;top:calc(8px + env(safe-area-inset-top));right:10px;height:44px;padding:0 14px 0 10px;border:2px solid rgba(255,255,255,.9);border-radius:999px;background:#dc2626;color:#fff;display:flex;align-items:center;gap:6px;cursor:pointer;font:900 14px/1 system-ui,-apple-system,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.4)}
.lp-snd svg{width:22px;height:22px;fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.lp-snd .on{display:none}
.lp.sound .lp-snd{background:#16a34a}
.lp.sound .lp-snd .on{display:inline}
.lp.sound .lp-snd .off{display:none}
.lp-paused{position:absolute;left:50%;top:50%;width:92px;height:92px;margin:-46px 0 0 -46px;border-radius:50%;background:rgba(0,0,0,.45);display:none;place-items:center;pointer-events:none}
.lp-paused svg{width:44px;height:44px;fill:#fff;margin-left:6px}
.lp-item.paused .lp-paused{display:grid}
.lp-muted{position:absolute;top:calc(66px + env(safe-area-inset-top));right:10px;padding:6px 10px;border-radius:999px;background:rgba(0,0,0,.55);font:800 12px/1 system-ui,sans-serif}
.lp-top{position:absolute;top:calc(22px + env(safe-area-inset-top));left:64px;font:900 16px/1 system-ui,sans-serif;text-shadow:0 1px 3px #000;pointer-events:none}
/* THE WAY OUT (28 Sep 2026, Jeff): an iPhone with the app on its home screen
   has no back button and no edge swipe, so every full-screen layer carries a
   close in its top-left corner. Swiping down on the first Loop closes too. */
.lp-x{position:absolute;z-index:4;top:calc(10px + env(safe-area-inset-top));left:10px;display:grid;place-items:center;width:42px;height:42px;border-radius:50%;border:0;background:rgba(0,0,0,.5);color:#fff;cursor:pointer;-webkit-tap-highlight-color:transparent}
.lp-x svg,.lp-newx svg{width:22px;height:22px;fill:none;stroke:#fff;stroke-width:2.6;stroke-linecap:round}
.lp-newx{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;border:0;background:rgba(0,0,0,.5);color:#fff;cursor:pointer;-webkit-tap-highlight-color:transparent;background:#1e293b;flex:none}
.lp-newhead{display:flex;align-items:center;gap:10px;margin:0 0 12px}
.lp-newhead h2{margin:0!important}
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
/* sound on / off when posting: two big buttons, green and red */
.lp-sndpick{margin:12px 0 0}
.lp-sndpick p{margin:0 0 6px;font:800 13px/1.2 system-ui,sans-serif;color:#cbd5e1}
.lp-sndpick div{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.lp-sndpick button{padding:13px 8px;border-radius:12px;border:2px solid #334155;background:#0f172a;color:#94a3b8;font:900 15px/1 system-ui,sans-serif;cursor:pointer}
.lp-sndpick button.on[data-snd="on"]{background:#16a34a;border-color:#16a34a;color:#fff}
.lp-sndpick button.on[data-snd="off"]{background:#dc2626;border-color:#dc2626;color:#fff}
.lp-go{display:block;width:100%;margin:16px 0 0;padding:15px;border:0;border-radius:14px;background:linear-gradient(145deg,#ffd23f,#ff9a1f);color:#1b1400;font:900 17px/1 system-ui,sans-serif;cursor:pointer}
.lp-go[disabled]{opacity:.5}
.lp-go-maker{background:linear-gradient(135deg,#ff8a00,#e52e71);color:#fff}
.lp-alt{display:block;width:100%;margin:10px 0 0;padding:13px;border:1px solid #334155;border-radius:14px;background:none;color:#fff;font:800 15px/1 system-ui,sans-serif;cursor:pointer}
.lp-err{margin:12px 0 0;padding:12px;border-radius:12px;background:#3b0d12;color:#ffd7d9;font-weight:700}
.lp-fine{margin:10px 0 0;color:#94a3b8;font-size:12.5px}
.lp-pill{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9400;max-width:calc(100% - 32px);padding:10px 16px;border-radius:999px;background:#0d1725;color:#fff;border:2px solid #ffc13d;box-shadow:0 8px 26px rgba(0,0,0,.45);font:800 14px/1.2 system-ui,sans-serif;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lp-pill .bar{display:block;height:4px;margin-top:6px;border-radius:2px;background:#334155;overflow:hidden}
.lp-pill .bar i{display:block;height:100%;background:#ffc13d;width:0;transition:width .3s}
.lpi{position:fixed;inset:0;z-index:9580;background:rgba(2,4,10,.72);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:grid;place-items:center;padding:16px}
.lpi-card-wrap{position:relative;box-sizing:border-box;width:100%;max-width:380px;background:#0b1220;color:#fff;border-radius:24px;overflow:hidden;text-align:center;padding:26px 20px 18px;border:1px solid rgba(255,255,255,.08);box-shadow:0 24px 60px rgba(0,0,0,.6);font:500 15px/1.4 system-ui,-apple-system,sans-serif}
.lpi-card-wrap::before{content:"";position:absolute;left:0;right:0;top:0;height:5px;background:linear-gradient(90deg,#ff7a2f,#ff3d7f,#7c5cff,#19bfff,#35d07f,#ffc13d)}
.lpi-x{position:absolute;right:12px;top:14px;width:34px;height:34px;border:0;border-radius:50%;background:rgba(255,255,255,.1);color:#fff;font:900 16px/1 system-ui;cursor:pointer}
.lpi-new{margin:0;font:900 11px/1 system-ui;letter-spacing:.2em;color:#ffc13d}
.lpi h2{margin:6px 0 6px;font:900 28px/1.1 system-ui,sans-serif}
.lpi h2 i{font-style:normal;background:linear-gradient(90deg,#ff8a00,#e52e71);-webkit-background-clip:text;background-clip:text;color:transparent}
.lpi-say{margin:0 6px;color:#cbd5e1}
.lpi-card{position:absolute;top:10px;left:50%;width:100px;height:168px;margin-left:-50px;border-radius:14px;border:3px solid rgba(255,255,255,.9);display:grid;place-items:center;box-shadow:0 10px 24px rgba(0,0,0,.5)}
.lpi-card img{width:84px}
.lpi-c0{transform:translateX(-78px) rotate(-11deg);background:linear-gradient(135deg,#1d4ed8,#0ea5e9)}
.lpi-c1{z-index:2;top:0;background:linear-gradient(135deg,#be185d,#f97316)}
.lpi-c2{transform:translateX(78px) rotate(11deg);background:linear-gradient(135deg,#6d28d9,#db2777)}
.lpi-photo{overflow:hidden;background:#111}
.lpi-photo .lpi-pic{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:11px}
.lpi-photo .lpi-stk{position:absolute;width:52px;right:-8px;bottom:14px;transform:rotate(12deg);filter:drop-shadow(0 3px 6px rgba(0,0,0,.5))}
.lpi-photo .lpi-play{position:absolute;left:8px;top:8px;font-style:normal;font-size:12px;color:#fff;text-shadow:0 1px 3px #000}
.lpi-fan{position:relative;height:196px;margin:16px 0 8px}
.lpi-steps{list-style:none;display:flex;justify-content:center;gap:8px;margin:4px 0 0;padding:0;counter-reset:s}
.lpi-steps li{flex:1;max-width:108px;padding:10px 4px;border-radius:14px;background:rgba(255,255,255,.06);font:900 13px/1.2 system-ui,sans-serif}
.lpi-steps li b{display:block;font-size:22px;margin-bottom:4px}
.lpi-go{display:block;width:100%;margin:16px 0 0;padding:15px;border:0;border-radius:14px;background:linear-gradient(135deg,#ff8a00,#e52e71);color:#fff;font:900 17px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 22px rgba(229,46,113,.35)}
.lpi-joke{margin:10px 0 0;color:#94a3b8;font-size:13px;font-style:italic}
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
  const BASE_COLS = 'id, user_id, video_guid, caption, muted, status, pinned, length_s, width, height, resolutions, created_at, expires_at';
  /* THE CARD A LOOP IS ABOUT (28 Sep 2026). Asked for only once the database
     has the columns (loops_card_tag.sql) -- gate() checks -- so pushing the
     app before running the SQL cannot break Loops. */
  let COLS = BASE_COLS + ', user_card_id, card_name, card_set, card_image';
  let cardCols = true;
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
    if (list.length < MIN_ROW && !isTester) return '';
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

  /* THE LOOPS TAB ON A PROFILE (27 Sep, replaces the strip above the tabs).
     countFor() tells feed.js whether to show the tab at all; profileGrid()
     fills it: 9:16 tiles three across, pinned first. Your own shows the ones
     still processing and how many days each has left. */
  async function countFor(userId, mine) {
    if (!sb() || !userId || !(await gate())) return 0;
    try {
      let q = sb().from('user_loops').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      if (!mine) q = q.eq('status', 'ready').or(`pinned.eq.true,expires_at.gt.${new Date().toISOString()}`);
      const { count } = await q;
      return count || 0;
    } catch (_) { return 0; }
  }

  async function profileGrid(grid, userId, mine) {
    if (!grid) return;
    if (!sb() || !userId || !(await gate())) { grid.innerHTML = ''; return; }
    mine = !!mine || userId === meId;
    let list = [];
    try {
      let q = sb().from('user_loops').select(COLS).eq('user_id', userId)
        .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(60);
      if (!mine) q = q.eq('status', 'ready');
      const { data, error } = await q;
      if (error) throw error;
      const now = Date.now();
      list = (data || []).filter((l) => mine || l.pinned || new Date(l.expires_at).getTime() > now);
    } catch (_) { grid.innerHTML = '<div class="pg-empty">Could not load the Loops.</div>'; return; }
    const key = 'prof:' + userId;
    sets.set(key, list);
    grid.dataset.lpGrid = userId;
    if (!list.length && !mine) { grid.innerHTML = '<div class="pg-empty">No Loops right now.</div>'; return; }
    grid.innerHTML = `<div class="lp-grid">
      ${mine ? `<button type="button" class="lp-gt lp-gt-make" data-lp-make><span><span class="lp-plus">+</span>Make a<br>Loop</span></button>` : ''}
      ${list.map((l, i) => {
        let badge = '', dim = false;
        if (l.status === 'uploading') { badge = 'Processing…'; dim = true; }
        else if (l.status === 'failed') { badge = 'Failed'; dim = true; }
        else if (l.pinned) badge = '📌';
        else if (mine) { const d = daysLeft(l); badge = d <= 0 ? 'Gone soon' : d <= 7 ? `${d}d left` : ''; dim = d <= 0; }
        return `<button type="button" class="lp-gt${dim ? ' lp-dim' : ''}" data-lp-open="${esc(key)}" data-lp-i="${i}" aria-label="Play Loop">
          ${l.status === 'ready' ? `<img src="${esc(thumbFor(l))}" alt="" loading="lazy">` : ''}
          ${badge ? `<span class="lp-badge">${esc(badge)}</span>` : ''}
          ${l.length_s ? `<span class="lp-len">▶ ${Math.round(l.length_s)}s</span>` : ''}
        </button>`;
      }).join('')}
    </div>
    ${mine ? '<p class="lp-grid-note">Loops last 30 days. Pin up to 3 from a Loop\'s ⋯ menu to keep them here.</p>' : ''}`;
  }

  /* ======================================================================
     THE PLAYER
     ====================================================================== */
  /* SOUND WORKS LIKE REELS (Mike, 27 Sep): Loops start muted; the speaker
     up top turns sound on, and it STAYS on for every Loop after it -- and
     next time too -- until they tap it off. A tap on the video pauses it. */
  let soundOn = false;
  try { soundOn = localStorage.getItem('ip-loop-sound') === 'on'; } catch (_) {}
  const saveSound = () => { try { localStorage.setItem('ip-loop-sound', soundOn ? 'on' : 'off'); } catch (_) {} };
  let lp = null, lpList = [], io = null;
  function paintSound() { if (lp) lp.classList.toggle('sound', soundOn); }
  const heatN = new Map(), heatMine = new Set(), talkN = new Map();

  const FLAME = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22c4 0 7-2.7 7-6.8 0-3.4-2.2-5.6-3.6-7.3-.3 1.7-1.2 2.9-2.4 3.4.3-3.3-1.2-6.5-4.3-8.3.3 3-1.2 5-2.7 6.8C4.8 11.3 5 12.6 5 15.2 5 19.3 8 22 12 22z"/></svg>';
  const TALK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z"/></svg>';
  const SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14"/></svg>';
  const MORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" fill="#fff"/><circle cx="12" cy="12" r="1.6" fill="#fff"/><circle cx="19" cy="12" r="1.6" fill="#fff"/></svg>';

  function itemHTML(l, i) {
    const f = faceOf(l.user_id);
    /* FILL THE SCREEN ONLY WHEN IT COSTS ALMOST NOTHING. A 9:16 Reel on a
       modern phone (about 9:19.5) used to be stretched to fill it, which cut
       ~18% off the sides -- the "zoomed in" look (Mike, 28 Sep 2026). Now it
       fills only when it would lose under 8%; otherwise the whole video shows,
       edge to edge across, with a blurred copy of it above and below. */
    const scr = (window.innerHeight || 800) / (window.innerWidth || 400);
    const tall = l.height && l.width ? l.height / l.width >= scr * 0.92 : false;
    const key = 'l-' + l.id;
    const n = heatN.get(key) || 0, c = talkN.get(key) || 0;
    const d = daysLeft(l);
    return `<section class="lp-item${tall ? ' tall' : ''}" data-lp-item="${i}">
      <div class="lp-bg" style="background-image:url('${esc(thumbFor(l))}')"></div>
      <video playsinline loop muted preload="none" poster="${esc(thumbFor(l))}" data-src="${esc(srcFor(l))}"></video>
      <div class="lp-shade"></div>
      ${l.muted ? '<span class="lp-muted">🔇 No sound on this one</span>' : ''}
      <span class="lp-paused" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z"/></svg></span>
      <span class="lp-flash" aria-hidden="true"></span>
      <div class="lp-foot">
        <button type="button" class="lp-by" data-lp-person="${esc(l.user_id)}">${avatar(l.user_id, '')}<span>${esc(at(f.name))}</span></button>
        ${l.caption ? `<p class="lp-cap">${captionHTML(l.caption)}</p>` : ''}
        ${l.card_name ? `<button type="button" class="lp-cardchip" data-lp-card="${esc(l.card_name)}" data-lp-cardpost="${esc(l.user_card_id || '')}">${l.card_image ? `<img src="${esc(l.card_image)}" alt="">` : '<span class="ph">🎴</span>'}<span><b>${esc(l.card_name)}</b>${l.card_set ? `<small>${esc(l.card_set)}</small>` : ''}</span><i>See it ›</i></button>` : ''}
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
        el.classList.remove('paused');
        const p = v.play();
        if (p && p.catch) p.catch(() => {
          /* the phone would not play it with sound until they tap: show the
             speaker as off, so one tap on it brings the sound */
          soundOn = false; paintSound();
          v.muted = true;
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
      <button type="button" class="lp-x" data-lp-close aria-label="Close Loops, back to the feed"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <span class="lp-top">∞ Loops</span>
      <button type="button" class="lp-snd" data-lp-snd aria-label="Sound on or off">
        <svg class="off" viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z" fill="#fff"/><path d="m16 9 5 6M21 9l-5 6"/></svg><span class="off">Sound off</span>
        <svg class="on" viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z" fill="#fff"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg><span class="on">Sound on</span>
      </button>`;
    paintSound();
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

    /* SWIPE DOWN ON THE FIRST LOOP CLOSES, the way Reels and Stories do. */
    let y0 = null;
    listEl.addEventListener('touchstart', (e) => { y0 = listEl.scrollTop <= 2 && e.touches.length === 1 ? e.touches[0].clientY : null; }, { passive: true });
    listEl.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      if (e.touches[0].clientY - y0 > 110) { y0 = null; leavePlayer(); }
    }, { passive: true });
    listEl.addEventListener('touchend', () => { y0 = null; }, { passive: true });
  }

  let lastTap = 0, tapTimer = 0;
  function flash(el, what) {
    const f = el.querySelector('.lp-flash'); if (!f) return;
    f.textContent = what; f.classList.add('on');
    clearTimeout(f._t); f._t = setTimeout(() => f.classList.remove('on'), 650);
  }

  async function onPlayerClick(e) {
    if (e.target.closest('[data-lp-close]')) { e.preventDefault(); leavePlayer(); return; }
    const item = e.target.closest('[data-lp-item]');
    const i = item ? Number(item.getAttribute('data-lp-item')) : current();
    const l = lpList[i];

    const person = e.target.closest('[data-lp-person]');
    if (person) { goPerson(person.getAttribute('data-lp-person'), faceOf(person.getAttribute('data-lp-person')).name); return; }
    const name = e.target.closest('[data-lp-name]');
    if (name) { goName(name.getAttribute('data-lp-name')); return; }
    const tag = e.target.closest('[data-lp-tag]');
    if (tag) { goTag(tag.getAttribute('data-lp-tag')); return; }
    const card = e.target.closest('[data-lp-card]');
    if (card) {
      /* the card's own post in the poster's feed (Mike, 29 Sep); the
         everyone-with-this-card page only when there's no post to open */
      const post = card.getAttribute('data-lp-cardpost');
      if (post) goCardPost(post); else goCard(card.getAttribute('data-lp-card'));
      return;
    }
    if (!l) return;
    if (e.target.closest('[data-lp-snd]')) {
      soundOn = !soundOn; saveSound(); paintSound();
      const cur = lp.querySelector(`[data-lp-item="${current()}"]`);
      const lc = lpList[current()];
      if (cur) {
        const v = cur.querySelector('video');
        if (lc && lc.muted && soundOn) say('No sound on this one.');
        v.muted = !soundOn || !!(lc && lc.muted);
        if (v.paused && !cur.classList.contains('paused')) v.play().catch(() => {});
      }
      return;
    }
    if (e.target.closest('[data-lp-heat]')) { toggleHeat(i); return; }
    if (e.target.closest('[data-lp-talk]')) { openTalk(i); return; }
    if (e.target.closest('[data-lp-share]')) { share(l); return; }
    if (e.target.closest('[data-lp-more]')) { openMenu(i); return; }
    if (e.target.closest('.lp-side, .lp-foot')) return;

    /* On the video: one tap pauses (or plays), two quick taps is heat. */
    const now = Date.now();
    if (now - lastTap < 300) {
      clearTimeout(tapTimer); lastTap = 0;
      if (!heatMine.has('l-' + l.id)) toggleHeat(i);
      flash(item, '🔥');
      return;
    }
    lastTap = now;
    tapTimer = setTimeout(() => {
      const v = item.querySelector('video');
      if (v.paused) {
        item.classList.remove('paused');
        v.muted = !soundOn || !!l.muted;
        v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
      } else {
        v.pause();
        item.classList.add('paused');
      }
    }, 280);
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

  function goCardPost(userCardId) {
    leavePlayer();
    setTimeout(() => { location.href = '/feed-next/?post=c-' + encodeURIComponent(userCardId); }, 120);
  }

  function goCard(name) {
    const go = window.InfinitePullsFeedGo;
    leavePlayer();
    setTimeout(() => { if (go && go.card) go.card(name); else if (go && go.tag) go.tag(name); }, 120);
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

  /* SHARE (27 Sep): the VIDEO ITSELF -- straight into Instagram, TikTok,
     Facebook, texts -- with the ∞ INFINITE PULLS mark on it and the link in
     the caption; or just the link. Phones that cannot share a file save it
     instead. */
  async function share(l) {
    const url = location.origin + '/feed-next/?post=l-' + l.id;
    const f = faceOf(l.user_id);
    const title = `${at(f.name)} on Infinite Pulls`;
    const box = openSheet('Share this Loop', `<div class="lp-menu">
      ${window.InfinitePullsMessages && window.InfinitePullsMessages.on ? '<button type="button" data-sh="dm">💬 Send in Messages</button>' : ''}
      <button type="button" data-sh="video">🎬 Share the video</button>
      <button type="button" data-sh="link">🔗 Share the link</button>
      <p>The video carries the ∞ Infinite Pulls mark wherever it goes.</p></div>`);
    /* start fetching the video now, so the tap can share it at once
       (phones only allow a share straight from a tap) */
    let ready = null;
    const getting = fetch(srcFor(l)).then((r) => { if (!r.ok) throw new Error('fetch'); return r.blob(); })
      .then((blob) => (ready = new File([blob], 'infinite-pulls-loop.mp4', { type: 'video/mp4' })))
      .catch(() => null);
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-sh]'); if (!b) return;
      if (b.getAttribute('data-sh') === 'dm') {
        /* one step back at a time, so the history stack stays in order */
        leaveSheet();
        setTimeout(() => { leavePlayer(); setTimeout(() => window.InfinitePullsMessages.sendShare('l-' + l.id), 250); }, 200);
        return;
      }
      if (b.getAttribute('data-sh') === 'link') {
        leaveSheet();
        try { if (navigator.share) { await navigator.share({ title, url }); return; } }
        catch (err) { if (err && err.name === 'AbortError') return; }
        try { await navigator.clipboard.writeText(url); say('Link copied.'); } catch (_) { say(url); }
        return;
      }
      let file = ready;
      if (!file) {
        b.disabled = true; b.textContent = 'Getting the video…';
        file = await getting;
        if (!file) { b.disabled = false; b.textContent = '🎬 Share the video'; say('Could not get the video. Try the link.'); return; }
        /* it took a moment -- ask for one more tap so the phone allows the share */
        b.disabled = false; b.textContent = '🎬 Ready — tap to share';
        return;
      }
      leaveSheet();
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title, text: `${title} — ${url}` });
          return;
        }
      } catch (err) { if (err && err.name === 'AbortError') return; }
      /* no file sharing here (most computers): save it instead */
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file); a.download = 'infinite-pulls-loop.mp4';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      say('Saved. Post it anywhere!');
    });
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
      newEl.innerHTML = `<div class="lp-new-in"><div class="lp-newhead"><button type="button" class="lp-newx" data-lp-newclose aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button><h2><i>∞</i> Make a Loop</h2></div>
        <p>A short video, 15 seconds max. Say hi, show off your shelf, open a pack.</p>
        <button type="button" class="lp-go" data-lp-pick>🎥 Pick a video</button>
        <button type="button" class="lp-go lp-go-maker" data-lp-maker>✨ Make one from photos</button>
        <p class="lp-fine">No video? Pick a few photos, a style and some stickers — we make the video for you.</p>
        <p class="lp-fine">Loops last 30 days. Pin up to 3 to keep them on your profile.</p></div>`;
      wireNew();
      return;
    }
    pickedURL = URL.createObjectURL(picked);
    newEl.innerHTML = `<div class="lp-new-in"><div class="lp-newhead"><button type="button" class="lp-newx" data-lp-newclose aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button><h2><i>∞</i> New Loop</h2></div><div class="lp-fine">Checking the video…</div></div>`;
    const secs = await lengthOf(pickedURL);
    if (!newEl) return;
    if (secs > MAX_S) {
      newEl.innerHTML = `<div class="lp-new-in"><div class="lp-newhead"><button type="button" class="lp-newx" data-lp-newclose aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button><h2><i>∞</i> New Loop</h2></div>
        <div class="lp-err">That video is ${Math.round(secs)} seconds. Loops are 15 seconds max. Trim it in your Photos app, then pick it again.</div>
        <button type="button" class="lp-go" data-lp-pick>Pick another video</button></div>`;
      wireNew();
      return;
    }
    newEl.innerHTML = `<div class="lp-new-in">
      <div class="lp-newhead"><button type="button" class="lp-newx" data-lp-newclose aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button><h2><i>∞</i> New Loop</h2></div>
      <video class="lp-prev" src="${esc(pickedURL)}" playsinline autoplay loop muted></video>
      <form class="lp-new-form">
        <textarea data-mention maxlength="500" placeholder="Say something… @ to tag people, # for tags"></textarea>
        ${meId && cardCols ? `<div class="lp-tagcard"><p>Which card is this about? <span style="font-weight:600;opacity:.7">(optional)</span></p>
          <button type="button" class="lp-tagbtn" data-lp-tagcard><span class="ph">🎴</span><span>Tag the card<small>Cards with a picture only</small></span></button>
          <div class="lp-pick" hidden><input type="search" placeholder="Search your cards…" enterkeyhint="search"><ul></ul></div>
          <input type="hidden" name="card" value=""></div>` : ''}
        <div class="lp-sndpick"><p>Sound on your Loop</p><div>
          <button type="button" data-snd="on" class="on">🔊 Sound on</button>
          <button type="button" data-snd="off">🔇 Sound off</button>
        </div><input type="hidden" name="muted" value=""></div>
        <button type="submit" class="lp-go">Post Loop</button>
        <button type="button" class="lp-alt" data-lp-pick>Pick a different video</button>
        <p class="lp-fine">Lasts 30 days. Pin up to 3 to keep them. Only post music and video you have the right to share.</p>
      </form></div>`;
    wireNew();
  }

  /* the close on every posting screen, including "Checking the video…" */
  document.addEventListener('click', (e) => {
    if (newEl && e.target.closest('[data-lp-newclose]')) { e.preventDefault(); leaveNew(); }
  });

  function wireNew() {
    if (!newEl) return;
    newEl.querySelectorAll('[data-lp-pick]').forEach((b) => b.addEventListener('click', chooser));
    newEl.querySelectorAll('[data-lp-maker]').forEach((b) => b.addEventListener('click', openMaker));
    const form = newEl.querySelector('.lp-new-form');
    if (!form) return;
    wireCardPick(form);
    form.querySelectorAll('[data-snd]').forEach((b) => b.addEventListener('click', () => {
      form.querySelectorAll('[data-snd]').forEach((x) => x.classList.toggle('on', x === b));
      form.querySelector('[name=muted]').value = b.getAttribute('data-snd') === 'off' ? '1' : '';
    }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const caption = form.querySelector('textarea').value.trim();
      const muted = form.querySelector('[name=muted]').value === '1';
      const cardIn = form.querySelector('[name=card]');
      const cardId = cardIn ? cardIn.value : '';
      const file = picked;
      if (!file) return;
      form.querySelector('.lp-go').disabled = true;
      leaveNew();
      upload(file, caption, muted, cardId);
    });
  }

  /* TAG THE CARD: search your own collection, tap one. */
  function wireCardPick(form) {
    const btn = form.querySelector('[data-lp-tagcard]');
    if (!btn) return;
    const box = form.querySelector('.lp-pick'), inp = box.querySelector('input'), ul = box.querySelector('ul');
    const hid = form.querySelector('[name=card]');
    let timer = null, found = [];
    const draw = (btnHTML, set) => { btn.innerHTML = btnHTML; btn.classList.toggle('set', !!set); };
    const EMPTY = btn.innerHTML;
    const pic = (u) => u ? `<img src="${esc(u)}" alt="" loading="lazy">` : '<span class="ph">🎴</span>';
    /* ONLY CARDS WITH A PICTURE (Mike, 29 Sep): a tag with no picture looks
       broken on the Loop. Cards without one still show, greyed out and
       labeled, so nobody wonders where their card went. */
    async function search() {
      const q = inp.value.trim().replace(/[%,()]/g, ' ');
      let r = sb().from('user_cards').select('id, card_name, set_name, image_url')
        .eq('user_id', meId).order('added_at', { ascending: false }).limit(60);
      if (q) r = r.ilike('card_name', '%' + q + '%');
      const { data } = await r;
      const all = data || [];
      found = all.filter((c) => c.image_url);
      const bare = all.filter((c) => !c.image_url).slice(0, 10);
      ul.innerHTML = `<p class="rule">📸 Only cards with a picture can be tagged.</p>`
        + (found.length
          ? found.map((c, i) => `<li><button type="button" data-pick="${i}">${pic(c.image_url)}<span>${esc(c.card_name)}<small>${esc(c.set_name || '')}</small></span></button></li>`).join('')
          : `<p class="none">${all.length ? 'None of these cards have a picture yet.' : q ? 'None of your cards match that.' : 'No cards in your collection yet. Scan one in first, then tag it.'}</p>`)
        + bare.map((c) => `<li><button type="button" class="nopic" disabled><span class="ph">🚫</span><span>${esc(c.card_name)}<small>No picture, can't tag</small></span></button></li>`).join('');
    }
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.x')) {            /* take the tag off */
        hid.value = ''; draw(EMPTY, false); return;
      }
      if (hid.value) { box.hidden = !box.hidden; if (!box.hidden) search(); return; }
      box.hidden = !box.hidden;
      if (!box.hidden) { search(); setTimeout(() => inp.focus(), 50); }
    });
    inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
    ul.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      const c = found[Number(b.getAttribute('data-pick'))]; if (!c) return;
      hid.value = c.id;
      draw(`${pic(c.image_url)}<span>${esc(c.card_name)}<small>${esc(c.set_name || 'Tagged')}</small></span><span class="x" aria-label="Take the card off">✕</span>`, true);
      box.hidden = true;
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

  async function upload(file, caption, muted, cardId) {
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
      onSuccess: async () => {
        if (cardId && cardCols) {
          try { await sb().from('user_loops').update({ user_card_id: cardId }).eq('id', made.id); } catch (_) {}
        }
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
      const pc = Math.max(0, Math.min(99, Math.round(Number(r.progress) || 0)));
      pillSay(`Almost there… getting it ready to play${pc ? ' · ' + pc + '%' : ''}<span class="bar"><i style="width:${pc || 100}%"></i></span>`);
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
    document.querySelectorAll('[data-lp-grid]').forEach((el) => profileGrid(el, el.dataset.lpGrid));
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

  /* ======================================================================
     THE WELCOME POP-UP (27 Sep, Mike: "a really big production"). Once per
     phone, dark, one line on what Loops are, a picture, three steps, MAKE A
     LOOP. No "watch" button until there is plenty to watch. The phone's
     back button or ✕ closes it.
     ART: Mike's pictures go in INTRO_ART (paths under /assets/loops/); until
     then it fans three stickers.
     ====================================================================== */
  const INTRO_KEY = 'ip-loops-intro-1';
  const INTRO_ART = ['/assets/loops/intro/loop-1.webp', '/assets/loops/intro/loop-2.webp', '/assets/loops/intro/loop-3.webp'];
  let introEl = null;
  function closeIntro() { if (introEl) { introEl.remove(); introEl = null; } }
  function showIntro(force) {
    if (introEl) return;
    /* testing: every time, and nothing remembered -- so after launch it
       still shows once, to testers too */
    if (PUBLIC && !force) {
      try { if (localStorage.getItem(INTRO_KEY)) return; localStorage.setItem(INTRO_KEY, '1'); } catch (_) {}
    }
    /* three phone-screen Loops fanned out, each wearing a sticker */
    const stk = ['pullday', 'omg', 'fire'];
    const art = INTRO_ART.length
      ? INTRO_ART.map((src, k) => `<span class="lpi-card lpi-c${k} lpi-photo"><img class="lpi-pic" src="${esc(src)}" alt="">
          <img class="lpi-stk" src="/assets/loops/stickers/${stk[k]}.webp" alt=""><i class="lpi-play">▶</i></span>`).join('')
      : stk.map((n, k) => `<span class="lpi-card lpi-c${k}"><img src="/assets/loops/stickers/${n}.webp" alt=""></span>`).join('');
    introEl = document.createElement('div');
    introEl.className = 'lpi';
    introEl.setAttribute('role', 'dialog');
    introEl.setAttribute('aria-label', 'New: Infinite Loops');
    introEl.innerHTML = `<div class="lpi-card-wrap">
      <button type="button" class="lpi-x" data-lpi-x aria-label="Close">✕</button>
      <p class="lpi-new">NEW</p>
      <h2><i>∞</i> Infinite Loops</h2>
      <p class="lpi-say">15-second videos of your pulls, your shelf and your shop days.</p>
      <div class="lpi-fan">${art}</div>
      <ol class="lpi-steps"><li><b>🎥</b>Record</li><li><b>✨</b>Glow it up</li><li><b>🚀</b>Post</li></ol>
      <button type="button" class="lpi-go" data-lpi-go>Make a Loop</button>
      <p class="lpi-joke">Your Infinite Influencer era starts now.</p>
    </div>`;
    document.body.appendChild(introEl);
    pushLayer('loopsintro', closeIntro);
    introEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-lpi-go]')) {
        popLayer('loopsintro', closeIntro);
        setTimeout(() => { if (!meId) join('Join free to post Loops.'); else startWithFile(null); }, 260);
        return;
      }
      if (e.target.closest('[data-lpi-x]') || e.target === introEl) popLayer('loopsintro', closeIntro);
    });
  }
  /* once the feed is up, and never on top of something else */
  function introWhenClear(tries) {
    setTimeout(() => {
      const busy = document.documentElement.classList.contains('join-open') || document.documentElement.classList.contains('lp-lock')
        || document.querySelector('.flist, .lp, .lpm, .lp-new, .rp, .adddial, .addpost, [data-post-sheet]');
      if (busy) { if (tries < 6) introWhenClear(tries + 1); return; }
      showIntro(false);
    }, tries ? 8000 : 2500);
  }

  /* LOOPS ON A CARD'S PAGE AND A #TAG PAGE (28 Sep 2026). feed.js calls
     this when it narrows to a card name or a tag; it fills the box with a
     row of every Loop tagged with that card, or with the #tag in its
     caption, and leaves it empty when there are none. */
  async function stripFor(box, f) {
    if (!box) return;
    box.innerHTML = '';
    if (!f || !sb() || !(await gate())) return;
    const raw = f.kind === 'card' ? f.name : (f.value || f.label || '');
    const word = String(raw || '').replace(/^#/, '').replace(/[%,()*]/g, ' ').trim();
    if (!word) return;
    const hash = word.replace(/[^A-Za-z0-9_]/g, '');
    const ors = [];
    if (cardCols) ors.push(`card_name.ilike.%${word}%`);
    if (hash) ors.push(`caption.ilike.%#${hash}%`);
    if (!ors.length) return;
    let list = [];
    try {
      const { data, error } = await sb().from('user_loops').select(COLS)
        .eq('status', 'ready').or(ors.join(',')).order('created_at', { ascending: false }).limit(30);
      if (error) throw error;
      const now = Date.now();
      const whole = hash ? new RegExp('#' + hash + '(?![A-Za-z0-9_])', 'i') : null;
      list = (data || []).filter((l) => (l.pinned || new Date(l.expires_at).getTime() > now)
        && ((l.card_name && l.card_name.toLowerCase().includes(word.toLowerCase())) || (whole && whole.test(l.caption || ''))));
    } catch (_) { return; }
    if (!list.length) return;
    await loadFaces(list.map((l) => l.user_id));
    sets.set('strip', list);
    box.innerHTML = `<section class="lp-rail lp-strip" data-lp-strip>
      <h2><i>∞</i> Loops · ${esc(raw)}</h2>
      <div class="lp-row">${list.map((l, i) => tileHTML(l, 'strip', i, l.user_id === meId)).join('')}</div>
    </section>`;
  }

  const api = { on: false, stripFor, railHTML, profileStrip, profileGrid, countFor, startWithFile, refreshRows, showIntro };
  window.InfinitePullsLoops = api;
  gate().then((ok) => { if (ok && back()) introWhenClear(0); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fromLink);
  else fromLink();

})();
