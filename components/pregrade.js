/* =============================================================================
   THE PRE-GRADING LAB  ->  THE INFINITE GRADE.   26 Oct 2026, Mike + Jeff.

   WHAT IT IS. Somebody has a card and wants to know what it would PROBABLY
   grade before they spend $150 to $1,000 sending it in. We beat the card up
   in photos, find every defect we can see, and say the likely grade. They
   decide what to do with that. No money math, no "grade it or don't".

   THE PARTNERSHIP (Mike): "we never want to put out a false grade based on
   their shitty technological hangups." They take the photos we ask for,
   the way we ask for them, or we cannot do our job -- and then we SAY so,
   kindly, and ask for the shots again. Never a guessed grade off bad
   photos. The responsibility is always on the person and their pictures.

   THE WALK
     0. HOW IT WORKS   one screen, first time: eight photos, hold a light
                       over the card, you line up the centering, the AI
                       comes back with your Infinite Grade.
     1. THE CARD       scan it or type it (the same engine as everywhere).
     2. THE SHOOT      eight guided photos, one at a time, each with an
                       outline. Checked on the phone first (too dark,
                       blurry) and retaken right there.
     3. CENTERING      your lines on the front and back shots, with the
                       loupe. Sent along with the photos.
     4. THE INFINITE GRADE   the server (supabase/functions/infinite-grade)
                       has Claude check every photo, then inspect. Back
                       comes: the grade range, every defect CIRCLED on its
                       photo, what could not be checked, and the fine print.
                       Or: "these shots need redoing", with why and how.
                       Then a slab PNG -- INFINITE PRE-GRADE, the range, the
                       card -- to save or share.

   Reached from the + dial (switched OFF there until Mike says; see
   LAB_ON in add-dial.js) and from /?page=lookup&pregrade=1.
   ========================================================================== */
(function () {
  'use strict';

  const col = () => window.InfinitePullsCollection;
  const sb = () => window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
  const KEY_REPORTS = 'ip-infinite-grade-reports-v1';
  const KEY_TUT = 'ip-infinite-grade-tutorial-v1';

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
  const money = (n) => (typeof n === 'number' && isFinite(n))
    ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
    : null;

  /* THE SHOOT, in order. Same list as the server's SHOTS. `tip` is what the
     person reads; `frame` is the outline drawn on the live preview:
     'card' = the whole card, 'corner' = a corner, 'tilt' = the card at an angle. */
  const SHOTS = [
    { kind: 'front',      label: 'Front',               tip: 'Whole card, straight on, filling the box. No sleeve.', frame: 'card' },
    { kind: 'back',       label: 'Back',                tip: 'Flip it. Whole back, straight on, filling the box.', frame: 'card' },
    { kind: 'corner-tl',  label: 'Top-left corner',     tip: 'Get close. The corner tip and the two edges beside it.', frame: 'corner', pos: 'tl' },
    { kind: 'corner-tr',  label: 'Top-right corner',    tip: 'Same again, top right.', frame: 'corner', pos: 'tr' },
    { kind: 'corner-bl',  label: 'Bottom-left corner',  tip: 'Bottom left, up close.', frame: 'corner', pos: 'bl' },
    { kind: 'corner-br',  label: 'Bottom-right corner', tip: 'Bottom right, up close.', frame: 'corner', pos: 'br' },
    { kind: 'front-tilt', label: 'Front, tilted under the light', tip: 'Tilt the card so the light slides across it. Scratches and print lines show up here.', frame: 'tilt' },
    { kind: 'back-tilt',  label: 'Back, tilted under the light',  tip: 'Same tilt, back side.', frame: 'tilt', optional: true },
  ];

  const CSS = `
.pg{position:fixed;inset:0;z-index:9999;background:#03070d;color:#f7f8fb;display:flex;flex-direction:column;
  font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;overscroll-behavior:contain}
.pg *{box-sizing:border-box}
.pg button{font-family:inherit}
.pg a{color:#19bfff}
.pg-top{display:flex;align-items:center;gap:10px;padding:max(10px,env(safe-area-inset-top)) 14px 8px}
.pg-x{width:44px;height:44px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:#0a1120;color:#f7f8fb;display:grid;place-items:center;padding:0;flex:0 0 auto}
.pg-x svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.pg-title{flex:1;min-width:0;display:flex;align-items:center;gap:10px;white-space:nowrap;overflow:hidden}
.pg-title .pg-badge{width:38px;height:38px;flex:0 0 auto;border-radius:999px;background:linear-gradient(145deg,#ffd23f,#d99a00);display:grid;place-items:center}
.pg-title .pg-badge svg{width:26px;height:26px}
.pg-title>span{display:flex;flex-direction:column;line-height:1;min-width:0}
.pg-title b{font:800 14px/1 system-ui,-apple-system,sans-serif;letter-spacing:.2em;text-transform:uppercase}
.pg-title small{font-size:12px;font-weight:600;color:#9eb0c8;margin-top:4px;overflow:hidden;text-overflow:ellipsis}
.pg-help{width:44px;height:44px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:#0a1120;color:#9eb0c8;font-size:18px;font-weight:800;flex:0 0 auto}
.pg-steps{display:flex;gap:6px;padding:0 14px 10px}
.pg-steps button{flex:1;height:36px;border-radius:999px;border:1px solid rgba(255,255,255,.09);background:#0a1120;color:#9eb0c8;font-size:12px;font-weight:700;padding:0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pg-steps button.on{background:rgba(255,201,40,.14);border-color:#ffc928;color:#ffc928}
.pg-steps button.done{color:#f7f8fb;border-color:rgba(25,191,255,.35)}
.pg-body{flex:1;min-height:0;overflow-y:auto;padding:0 14px 16px;display:flex;flex-direction:column;gap:12px;-webkit-overflow-scrolling:touch}
.pg-body>*{flex:0 0 auto}
.pg-foot{padding:10px 14px max(18px,env(safe-area-inset-bottom));background:#0a1120;border-top:1px solid rgba(25,191,255,.25);display:flex;gap:10px}
.pg-foot button{height:52px;border-radius:999px;border:0;font-size:16px;font-weight:800;flex:1}
.pg-go{background:#19bfff;color:#03070d}
.pg-go.is-gold{background:#ffc928}
.pg-go:disabled{opacity:.45}
.pg-ghost{background:transparent;border:1px solid rgba(255,255,255,.14)!important;color:#f7f8fb;flex:0 0 auto!important;padding:0 18px}
.pg-card{background:#0a1120;border:1px solid rgba(255,255,255,.09);border-radius:18px;padding:14px}
.pg-card h3{margin:0 0 6px;font-size:15px;font-weight:800}
.pg-card p{margin:0;font-size:13px;color:#9eb0c8;line-height:1.5}
.pg-lab{font-size:12px;font-weight:700;color:#9eb0c8;text-transform:uppercase;letter-spacing:.06em}
.pg-row{display:flex;gap:8px;align-items:center}
.pg-btn{height:50px;border-radius:14px;border:1px solid rgba(255,255,255,.09);background:#11213a;color:#f7f8fb;font-size:14px;font-weight:700;padding:0 14px;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none}
.pg-btn.is-gold{background:rgba(255,201,40,.14);border-color:#ffc928;color:#ffc928}
.pg-btn.is-blue{background:#19bfff;border-color:#19bfff;color:#03070d}
.pg-btn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.pg-in{height:50px;border-radius:14px;border:1px solid rgba(25,191,255,.25);background:#03070d;color:#f7f8fb;font:inherit;font-size:16px;padding:0 14px;width:100%;min-width:0}
.pg-hit{width:100%;display:flex;align-items:center;gap:12px;padding:8px 12px;min-height:60px;border-radius:14px;color:#f7f8fb;text-align:left;background:#03070d;border:1px solid rgba(255,255,255,.09)}
.pg-hit.on{border:2px solid #19bfff;background:rgba(25,191,255,.12)}
.pg-art{width:32px;height:44px;border-radius:5px;flex:0 0 auto;background:#1a2230;overflow:hidden}
.pg-art img{width:100%;height:100%;object-fit:cover;display:block}
.pg-hit strong{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pg-hit small{display:block;font-size:12px;color:#9eb0c8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pg-hit b{font-size:15px;font-weight:800;flex:0 0 auto}
.pg-hit>span:nth-child(2){flex:1;min-width:0}
.pg-status{font-size:13px;color:#9eb0c8;min-height:16px}

/* the tutorial */
.pg-tut{display:flex;flex-direction:column;gap:12px}
.pg-tut-step{display:flex;gap:12px;align-items:flex-start;background:#0a1120;border:1px solid rgba(255,255,255,.09);border-radius:18px;padding:14px}
.pg-tut-step b.n{width:34px;height:34px;border-radius:999px;background:#ffc928;color:#03070d;display:grid;place-items:center;font-size:15px;font-weight:800;flex:0 0 auto}
.pg-tut-step div{flex:1;min-width:0}
.pg-tut-step strong{display:block;font-size:15px;font-weight:800;margin-bottom:3px}
.pg-tut-step p{margin:0;font-size:13px;color:#9eb0c8;line-height:1.5}

/* the shoot */
.pg-shots{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.pg-shot{aspect-ratio:3/4;border-radius:12px;background:#0a1120;border:1px solid rgba(255,255,255,.09);position:relative;overflow:hidden;padding:0;color:#9eb0c8}
.pg-shot img{width:100%;height:100%;object-fit:cover;display:block}
.pg-shot span{position:absolute;left:0;right:0;bottom:0;padding:4px;font-size:10px;font-weight:700;background:rgba(3,7,13,.75);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pg-shot.on{border:2px solid #ffc928}
.pg-shot.ok{border-color:rgba(61,220,132,.6)}
.pg-shot.bad{border-color:#ff9a9a}
.pg-shot i{position:absolute;top:4px;right:4px;width:18px;height:18px;border-radius:999px;display:grid;place-items:center;font-style:normal;font-size:11px;font-weight:800}
.pg-shot.ok i{background:#3ddc84;color:#03070d}
.pg-shot.bad i{background:#ff9a9a;color:#03070d}
.pg-stage{position:relative;width:100%;aspect-ratio:3/4;max-height:52vh;background:#1a2230;border-radius:18px;overflow:hidden;border:1px solid rgba(25,191,255,.25);touch-action:none;user-select:none;-webkit-user-select:none}
.pg-stage img,.pg-stage video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;-webkit-user-drag:none}
.pg-stage video{object-fit:cover}
.pg-stage.is-empty{display:grid;place-items:center;text-align:center;padding:20px;color:#9eb0c8;font-size:14px;line-height:1.5}
.pg-frame{position:absolute;pointer-events:none;border:3px dashed rgba(255,201,40,.85);border-radius:10px}
.pg-frame.card{left:12%;top:6%;right:12%;bottom:6%}
.pg-frame.corner{width:60%;height:60%;border-radius:0}
.pg-frame.corner.tl{left:20%;top:20%;border-right:0;border-bottom:0;border-top-left-radius:14px}
.pg-frame.corner.tr{right:20%;top:20%;border-left:0;border-bottom:0;border-top-right-radius:14px}
.pg-frame.corner.bl{left:20%;bottom:20%;border-right:0;border-top:0;border-bottom-left-radius:14px}
.pg-frame.corner.br{right:20%;bottom:20%;border-left:0;border-top:0;border-bottom-right-radius:14px}
.pg-frame.tilt{left:14%;top:10%;right:14%;bottom:10%;transform:perspective(500px) rotateX(28deg)}
.pg-shotsay{position:absolute;left:10px;right:10px;bottom:10px;padding:10px 12px;border-radius:14px;background:rgba(3,7,13,.8);font-size:13px;line-height:1.4}
.pg-shotsay b{color:#ffc928}
.pg-warn{background:rgba(255,154,154,.10);border:1px solid rgba(255,154,154,.5);border-radius:14px;padding:12px 14px;font-size:14px;line-height:1.5;color:#ffd1d1}
.pg-warn b{color:#fff}
.pg-good{background:rgba(61,220,132,.10);border:1px solid rgba(61,220,132,.5);border-radius:14px;padding:12px 14px;font-size:14px;color:#c9f5dc}
.pg-line{position:absolute;pointer-events:none}
.pg-line.v{top:0;bottom:0;width:0;border-left:2px solid var(--c)}
.pg-line.h{left:0;right:0;height:0;border-top:2px solid var(--c)}
.pg-hand{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:999px;background:rgba(3,7,13,.55);border:2px solid var(--c);display:grid;place-items:center;color:var(--c);font-size:11px;font-weight:800;cursor:grab;touch-action:none}
.pg-hand.is-drag{background:var(--c);color:#03070d}
.pg-loupe{position:absolute;width:120px;height:120px;border-radius:999px;border:3px solid #fff;box-shadow:0 10px 30px rgba(0,0,0,.6);overflow:hidden;pointer-events:none;display:none;background:#000}
.pg-loupe canvas{width:100%;height:100%;display:block}
.pg-loupe::after{content:"";position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-7px;border:2px solid #ff3b3b;border-radius:999px}
.pg-legend{display:flex;gap:14px;font-size:12px;color:#9eb0c8;flex-wrap:wrap}
.pg-legend i{display:inline-block;width:14px;height:3px;vertical-align:middle;margin-right:6px}
.pg-read{display:flex;gap:10px}
.pg-read>div{flex:1;background:#0a1120;border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:10px 12px}
.pg-read small{display:block;font-size:12px;color:#9eb0c8}
.pg-read b{display:block;font-size:22px;font-weight:800}
.pg-read b.is-gold{color:#ffc928}
.pg-tabs{display:flex;gap:8px}
.pg-tabs button{flex:1;height:40px;border-radius:999px;border:1px solid rgba(255,255,255,.09);background:#0a1120;color:#9eb0c8;font-size:14px;font-weight:700}
.pg-tabs button.on{background:#11213a;border-color:#19bfff;color:#f7f8fb}

/* waiting + the grade */
.pg-wait{display:flex;flex-direction:column;align-items:center;gap:14px;padding:40px 10px;text-align:center}
.pg-spin{width:56px;height:56px;border-radius:999px;border:4px solid rgba(255,201,40,.2);border-top-color:#ffc928;animation:pg-spin 1s linear infinite}
@keyframes pg-spin{to{transform:rotate(360deg)}}
.pg-grade{border-radius:22px;padding:22px 18px;text-align:center;display:flex;flex-direction:column;gap:4px;background:#0a1120;border:2px solid #ffc928;position:relative;overflow:hidden}
.pg-grade::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 0,rgba(255,201,40,.18),transparent 60%);pointer-events:none}
.pg-grade small{font:800 11px/1 system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#ffc928}
.pg-grade b{font-size:64px;font-weight:800;line-height:1;color:#f7f8fb}
.pg-grade em{font-style:normal;font-size:13px;color:#9eb0c8;margin-top:6px}
.pg-def{display:flex;gap:12px;align-items:flex-start;background:#0a1120;border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:10px}
.pg-def .pic{width:96px;height:96px;border-radius:10px;overflow:hidden;position:relative;flex:0 0 auto;background:#000}
.pg-def .pic img{width:100%;height:100%;object-fit:cover;display:block}
.pg-def .pic i{position:absolute;border:2.5px solid #ff3b3b;border-radius:8px;box-shadow:0 0 0 2px rgba(0,0,0,.5)}
.pg-def>div{flex:1;min-width:0}
.pg-def strong{display:block;font-size:15px;font-weight:800;text-transform:capitalize}
.pg-def small{display:block;font-size:12px;color:#9eb0c8;margin-top:2px}
.pg-def .sev{display:inline-block;margin-top:6px;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}
.sev.light{background:rgba(61,220,132,.15);color:#3ddc84}
.sev.moderate{background:rgba(255,201,40,.15);color:#ffc928}
.sev.heavy{background:rgba(255,154,154,.15);color:#ff9a9a}
.pg-why{margin:0;padding-left:18px;font-size:14px;line-height:1.55;color:#c9d4e3}
.pg-why li+li{margin-top:6px}
.pg-fine{font-size:12px;color:#9eb0c8;line-height:1.55;border-top:1px solid rgba(255,255,255,.08);padding-top:12px}
.pg-slabwrap{display:flex;justify-content:center}
.pg-slabwrap canvas{width:min(100%,260px);height:auto;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.6)}
@media (prefers-reduced-motion:reduce){.pg *{transition:none!important;animation:none!important}}
`;
  function injectCss() {
    if (document.getElementById('pg-css')) return;
    const s = document.createElement('style'); s.id = 'pg-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  const X_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const CAM_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  const SLAB_ICON = '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><rect x="14" y="5" width="30" height="48" rx="4" fill="#1b1400"/><rect x="17.5" y="8.5" width="23" height="9" rx="1.6" fill="#ffffff"/><path d="M29 13c-1.1-1.5-2-2.2-3.3-2.2a2.2 2.2 0 0 0 0 4.4c1.3 0 2.2-.7 3.3-2.2zm0 0c1.1 1.5 2 2.2 3.3 2.2a2.2 2.2 0 0 0 0-4.4c-1.3 0-2.2.7-3.3 2.2z" stroke="#1b1400" stroke-width="1.5" stroke-linecap="round"/><rect x="17.5" y="20.5" width="23" height="29" rx="1.6" fill="#2a6df4"/><circle cx="42" cy="40" r="11" fill="#1b1400"/><circle cx="42" cy="40" r="7.5" fill="#ffd23f"/><path d="M38.5 40.5l2.5 2.5 4.5-5" stroke="#1b1400" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M50 48l7 7" stroke="#1b1400" stroke-width="5" stroke-linecap="round"/></svg>';

  function briefOf(hit, lang) {
    const c = (hit && (hit.card || hit.brief)) || {};
    const total = c.set && c.set.cardCount && c.set.cardCount.official;
    return {
      id: c.id || null, lang,
      name: c.name || 'Unknown card',
      set: (c.set && c.set.name) || '',
      num: c.localId ? String(c.localId) + (total ? '/' + total : '') : '',
      img: c.image ? c.image + '/low.webp' : '',
      price: (hit && typeof hit.amount === 'number') ? hit.amount : null,
      card: hit && hit.card ? hit.card : null
    };
  }

  /* ---- reading a photo on the phone before it is accepted --------------------
     Not the real check (Claude does that). This catches the two things a
     person can fix on the spot without a round trip: too dark, and blurry.
     Measured on a 160px copy so it is instant. */
  function judgePhoto(img) {
    try {
      const W = 160, H = Math.max(1, Math.round(160 * img.naturalHeight / img.naturalWidth));
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data;
      const g = new Float32Array(W * H);
      let sum = 0;
      for (let i = 0, j = 0; i < d.length; i += 4, j++) { g[j] = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114; sum += g[j]; }
      const mean = sum / g.length;
      /* Laplacian variance: a sharp picture has lots of strong edges. */
      let lv = 0, n = 0, lsum = 0; const lap = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W];
        lap.push(v); lsum += v; n++;
      }
      const lmean = lsum / n;
      for (const v of lap) lv += (v - lmean) * (v - lmean);
      lv /= n;
      return { brightness: mean, sharpness: lv };
    } catch (_) { return { brightness: 128, sharpness: 999 }; }
  }

  /* ---- the lab ---------------------------------------------------------- */
  async function open(opts) {
    opts = opts || {};
    const C = col();
    if (!C) { alert('Give it a second and try again.'); return; }
    injectCss();
    const mode = opts.mode === 'ja' ? 'ja' : 'en';

    const S = {
      step: 1,
      card: null,
      shots: {},                 /* kind -> { url, w, h, ok, why, fix } */
      cur: 0,                    /* which shot is up */
      side: 'front',
      guides: { front: null, back: null },
      result: null,              /* the server's answer */
      busy: false
    };

    const root = document.createElement('div');
    root.className = 'pg';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Pre-grading Lab');
    root.innerHTML = `
      <div class="pg-top">
        <button type="button" class="pg-x" data-x aria-label="Close">${X_ICON}</button>
        <div class="pg-title"><span class="pg-badge">${SLAB_ICON}</span><span><b>Pre-grading Lab</b><small data-sub>The Infinite Grade</small></span></div>
        <button type="button" class="pg-help" data-help aria-label="How it works">?</button>
      </div>
      <div class="pg-steps" role="tablist">
        <button type="button" data-step="1">1 Card</button>
        <button type="button" data-step="2">2 Photos</button>
        <button type="button" data-step="3">3 Centering</button>
        <button type="button" data-step="4">4 Grade</button>
      </div>
      <div class="pg-body" data-body></div>
      <div class="pg-foot" data-foot></div>`;
    document.body.appendChild(root);
    document.body.classList.add('scan-open');
    const q = (s) => root.querySelector(s);
    const body = q('[data-body]');
    const foot = q('[data-foot]');

    /* ---- the way out ---------------------------------------------------- */
    let closed = false, popped = false;
    const backReg = window.InfinitePullsBack;
    function close() {
      if (closed) return;
      closed = true;
      document.body.classList.remove('scan-open');
      document.removeEventListener('keydown', onKey);
      root.remove();
      if (backReg && !popped) { try { backReg.pop('pregrade'); } catch (_) {} }
    }
    const onKey = (e) => { if (e.key === 'Escape') leave(); };
    document.addEventListener('keydown', onKey);
    function onBack() {
      if (S.step === 0) { S.step = 1; paint(); try { backReg.push('pregrade', onBack); } catch (_) {} return; }
      if (S.step > 1 && !S.busy) { S.step--; paint(); try { backReg.push('pregrade', onBack); } catch (_) {} return; }
      popped = true; close();
    }
    if (backReg && typeof backReg.push === 'function') backReg.push('pregrade', onBack);
    function leave() { if (S.busy) return; if (!(backReg && backReg.pop('pregrade'))) close(); }
    q('[data-x]').addEventListener('click', leave);
    q('[data-help]').addEventListener('click', () => { S.step = 0; paint(); });
    q('.pg-steps').addEventListener('click', (e) => {
      const b = e.target.closest('[data-step]'); if (!b || S.busy) return;
      const n = Number(b.getAttribute('data-step'));
      if (n <= maxStep()) { S.step = n; paint(); }
    });
    const shotsDone = () => SHOTS.every(s => s.optional || S.shots[s.kind]);
    function maxStep() {
      if (!S.card) return 1;
      if (!shotsDone()) return 2;
      if (!S.guides.front) return 3;
      return 4;
    }

    /* ---- painting --------------------------------------------------------- */
    function paint() {
      root.querySelectorAll('[data-step]').forEach(b => {
        const n = Number(b.getAttribute('data-step'));
        b.classList.toggle('on', n === S.step);
        b.classList.toggle('done', n < S.step && S.step > 0);
        b.disabled = n > maxStep();
      });
      body.scrollTop = 0;
      if (S.step === 0) paintTutorial();
      else if (S.step === 1) paintCard();
      else if (S.step === 2) paintShoot();
      else if (S.step === 3) paintCenter();
      else paintGrade();
    }
    function footHtml(backLabel, goLabel, goDisabled, gold) {
      foot.innerHTML = `${backLabel ? `<button type="button" class="pg-ghost" data-back>${esc(backLabel)}</button>` : ''}
        <button type="button" class="pg-go${gold ? ' is-gold' : ''}" data-go ${goDisabled ? 'disabled' : ''}>${esc(goLabel)}</button>`;
      foot.querySelector('[data-back]')?.addEventListener('click', () => { S.step = Math.max(1, S.step - 1); paint(); });
      return foot.querySelector('[data-go]');
    }

    /* ---- 0. how it works ----------------------------------------------- */
    function paintTutorial() {
      q('[data-sub]').textContent = 'How it works';
      body.innerHTML = `
        <div class="pg-tut">
          <div class="pg-tut-step"><b class="n">1</b><div><strong>We'll take 8 photos of your card.</strong><p>Front, back, each corner up close, and the card tilted under a light. We show you an outline for every one.</p></div></div>
          <div class="pg-tut-step"><b class="n">2</b><div><strong>Hold a light over the card.</strong><p>A lamp, a flashlight, a window. Scratches and dings only show up when light slides across the card. Take it out of the sleeve.</p></div></div>
          <div class="pg-tut-step"><b class="n">3</b><div><strong>You line up the centering.</strong><p>Drag the lines onto the card's edges and the printed border on the front and back. There's a loupe so you can be exact.</p></div></div>
          <div class="pg-tut-step"><b class="n">4</b><div><strong>The AI inspects every photo.</strong><p>It circles every defect it finds, says what it couldn't check, and gives you your <b style="color:#ffc928">Infinite Grade</b>: the range your card would probably grade. You get a slab picture to save.</p></div></div>
          <div class="pg-warn"><b>The deal:</b> if a photo is too dark, blurry or doesn't show what we need, we won't grade it. We'll tell you which shots to redo. A grade off a bad photo is worse than no grade.</div>
        </div>`;
      footHtml('', 'Got it, let\'s go', false).addEventListener('click', () => { try { localStorage.setItem(KEY_TUT, '1'); } catch (_) {} S.step = 1; paint(); });
    }

    /* ---- 1. the card ------------------------------------------------------ */
    function cardHtml(c, on) {
      return `<button type="button" class="pg-hit${on ? ' on' : ''}" data-pick="${esc(c.id)}">
        <span class="pg-art">${c.img ? `<img src="${esc(c.img)}" alt="">` : ''}</span>
        <span><strong>${esc(c.name)}</strong><small>${esc([c.set, c.num].filter(Boolean).join(' · '))}</small></span>
        <b>${esc(money(c.price) || '')}</b></button>`;
    }
    let found = [];
    function paintCard() {
      q('[data-sub]').textContent = 'Which card?';
      body.innerHTML = `
        ${S.card ? `<div class="pg-card"><div class="pg-lab" style="margin-bottom:8px">This card</div>${cardHtml(S.card, true)}</div>` : ''}
        <div class="pg-card">
          <div class="pg-row">
            <button type="button" class="pg-btn is-blue" data-scan style="flex:1">${CAM_ICON} Scan the card</button>
          </div>
          <form class="pg-row" data-search style="margin-top:8px">
            <input class="pg-in" name="q" type="text" inputmode="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Or type it: Charizard, or 4/102" aria-label="Search for the card">
            <button type="submit" class="pg-btn">Find</button>
          </form>
          <div class="pg-status" data-status style="margin-top:8px"></div>
          <div data-results style="display:flex;flex-direction:column;gap:8px;margin-top:8px">${found.map(c => cardHtml(c, S.card && c.id === S.card.id)).join('')}</div>
        </div>
        <div class="pg-card"><h3>Then: 8 photos, your centering lines, and the AI inspects it.</h3><p>Grab a light before you start. Tap ? up top any time to see how it works.</p></div>`;
      footHtml('', S.card ? 'Next: the photos' : 'Pick a card first', !S.card).addEventListener('click', () => { S.step = 2; paint(); });

      const status = (t) => { const el = body.querySelector('[data-status]'); if (el) el.textContent = t; };
      body.querySelector('[data-scan]').addEventListener('click', async () => {
        const scan = C.scanCardSmart || C.scanCardNumber;
        if (!scan) { status('The scanner is not available right now.'); return; }
        status('Reading the card…');
        let res = null;
        try { res = await scan.call(C, mode, { typeInstead: true }); } catch (_) { res = { status: 'error' }; }
        if (!res || res.status === 'cancelled') { status(''); return; }
        if (res.status === 'type') { status(''); body.querySelector('[data-search] input').focus(); if (res.typed) { body.querySelector('[data-search] input').value = res.typed; search(res.typed); } return; }
        if (res.status === 'unavailable') { status('No camera here. Type the card instead.'); return; }
        if (res.status === 'ok' && res.number) { search(res.number, res.lines); return; }
        if (res.status === 'name' && res.name) { search(res.name, res.lines); return; }
        status('Could not read that one. Hold it straight on with the bottom corner sharp, or type it.');
      });
      body.querySelector('[data-search]').addEventListener('submit', (e) => {
        e.preventDefault();
        const t = body.querySelector('[data-search] input').value.trim();
        if (t) search(t);
      });
      body.querySelector('[data-results]').addEventListener('click', (e) => {
        const b = e.target.closest('[data-pick]'); if (!b) return;
        const c = found.find(x => x.id === b.getAttribute('data-pick'));
        if (!c) return;
        S.card = c; paint();
      });
    }
    async function search(text, lines) {
      const status = (t) => { const el = body.querySelector('[data-status]'); if (el) el.textContent = t; };
      status('Looking…');
      let results = [];
      try {
        const r = await C.lookupBySearch(text, mode);
        if (r && r.briefs && r.briefs.length) results = (await C.priceBriefs(r.briefs.slice(0, 8), mode)).filter(h => h && h.card);
      } catch (_) {}
      if (!results.length) { try { const r = await C.lookupByNumber(text, mode); results = (r && r.results || []).filter(h => h && h.card); } catch (_) {} }
      if (!results.length && /[A-Za-z]{3,}/.test(text)) { try { const r = await C.lookupByName(text, mode); results = (r && r.results || []).filter(h => h && h.card); } catch (_) {} }
      if (results.length > 1 && lines && lines.length) { try { const rk = C.rankCandidates(results, lines); if (rk && rk.ranked.length) results = rk.ranked; } catch (_) {} }
      found = results.slice(0, 8).map(h => briefOf(h, mode));
      if (!found.length) { status('Nothing found for "' + text + '". Try the number on the bottom of the card.'); return; }
      if (found.length === 1) { S.card = found[0]; paint(); return; }
      status(found.length + ' found. Tap the right one.');
      body.querySelector('[data-results]').innerHTML = found.map(c => cardHtml(c, false)).join('');
    }

    /* ---- 2. the shoot ------------------------------------------------------ */
    function paintShoot() {
      const spec = SHOTS[S.cur];
      const have = S.shots[spec.kind];
      q('[data-sub]').textContent = `Photo ${S.cur + 1} of ${SHOTS.length}`;
      body.innerHTML = `
        <div class="pg-shots" data-strip>
          ${SHOTS.map((s, i) => `<button type="button" class="pg-shot${i === S.cur ? ' on' : ''}${S.shots[s.kind] ? (S.shots[s.kind].ok === false ? ' bad' : ' ok') : ''}" data-shot="${i}" aria-label="${esc(s.label)}">
            ${S.shots[s.kind] ? `<img src="${esc(S.shots[s.kind].url)}" alt=""><i>${S.shots[s.kind].ok === false ? '!' : '✓'}</i>` : ''}<span>${esc(s.label.split(',')[0])}</span></button>`).join('')}
        </div>
        <div class="pg-stage${have ? '' : ' is-empty'}" data-stage>
          ${have ? `<img src="${esc(have.url)}" alt="${esc(spec.label)}">` : `<div class="pg-frame ${spec.frame}${spec.pos ? ' ' + spec.pos : ''}"></div><div></div>`}
          <div class="pg-shotsay"><b>${esc(spec.label)}.</b> ${esc(spec.tip)}${spec.optional ? ' <span style="color:#9eb0c8">(optional)</span>' : ''}</div>
        </div>
        ${have && have.ok === false ? `<div class="pg-warn"><b>Retake this one.</b> ${esc(have.why)} ${esc(have.fix || '')}</div>` : ''}
        ${have && have.ok !== false ? `<div class="pg-good">Looks usable. The AI gives it a harder look later.</div>` : ''}
        <div class="pg-row">
          <button type="button" class="pg-btn ${have ? '' : 'is-blue'}" data-take style="flex:1">${CAM_ICON} ${have ? 'Retake' : 'Take the photo'}</button>
          ${have ? `<button type="button" class="pg-btn is-blue" data-nextshot>${S.cur < SHOTS.length - 1 ? 'Next photo' : 'Done'}</button>` : (spec.optional ? `<button type="button" class="pg-btn" data-skip>Skip</button>` : '')}
          <input type="file" accept="image/*" capture="environment" hidden data-file>
        </div>
        <div class="pg-card"><p><b style="color:#f7f8fb">Light over the card, not behind it.</b> Out of the sleeve. Fill the outline. Hold still a second before you tap.</p></div>`;
      const go = footHtml('Back', shotsDone() ? 'Next: centering' : `${SHOTS.filter(s => !s.optional && !S.shots[s.kind]).length} photos to go`, !shotsDone());
      go.addEventListener('click', () => { S.step = 3; paint(); });

      body.querySelector('[data-strip]').addEventListener('click', (e) => { const b = e.target.closest('[data-shot]'); if (!b) return; S.cur = Number(b.getAttribute('data-shot')); paint(); });
      const file = body.querySelector('[data-file]');
      body.querySelector('[data-take]').addEventListener('click', () => file.click());
      body.querySelector('[data-nextshot]')?.addEventListener('click', () => { if (S.cur < SHOTS.length - 1) { S.cur++; paint(); } else { S.step = 3; paint(); } });
      body.querySelector('[data-skip]')?.addEventListener('click', () => { if (S.cur < SHOTS.length - 1) { S.cur++; paint(); } else { S.step = 3; paint(); } });
      file.addEventListener('change', async () => {
        const f = file.files && file.files[0]; file.value = '';
        if (!f) return;
        const got = await fileToDataUrl(f, 1400);
        if (!got) return;
        const j = judgePhoto(got.img);
        const shot = { url: got.url, w: got.w, h: got.h, ok: true, why: '', fix: '' };
        if (j.brightness < 55) { shot.ok = false; shot.why = 'Too dark.'; shot.fix = 'Get more light on the card. A lamp or a window right over it.'; }
        else if (j.sharpness < 25) { shot.ok = false; shot.why = 'Blurry.'; shot.fix = 'Hold still a second, let the camera focus, then tap.'; }
        S.shots[spec.kind] = shot;
        if (shot.ok && S.cur < SHOTS.length - 1 && !S.shots[SHOTS[S.cur + 1].kind]) S.cur++;   /* a good shot moves to the next one */
        paint();
      });
    }
    function fileToDataUrl(f, lim) {
      return new Promise((resolve) => {
        const img = new Image();
        const u = URL.createObjectURL(f);
        img.onload = () => {
          try {
            const s = Math.min(1, lim / Math.max(img.naturalWidth, img.naturalHeight));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            resolve({ url: c.toDataURL('image/jpeg', 0.86), w: c.width, h: c.height, img });
          } catch (_) { resolve(null); }
          URL.revokeObjectURL(u);
        };
        img.onerror = () => { URL.revokeObjectURL(u); resolve(null); };
        img.src = u;
      });
    }

    /* ---- 3. centering ------------------------------------------------------ */
    const DEFAULT_GUIDES = { L: .06, R: .94, T: .05, B: .95, l: .12, r: .88, t: .11, b: .89 };
    function ratios(g) {
      if (!g) return null;
      const left = g.l - g.L, right = g.R - g.r, top = g.t - g.T, bottom = g.B - g.b;
      if (left <= 0 || right <= 0 || top <= 0 || bottom <= 0) return { bad: true };
      const lr = Math.round(100 * Math.max(left, right) / (left + right));
      const tb = Math.round(100 * Math.max(top, bottom) / (top + bottom));
      return { lr, tb, worst: Math.max(lr, tb) };
    }
    function paintCenter() {
      q('[data-sub]').textContent = 'Centering, your lines';
      const side = S.side;
      const photo = S.shots[side] && S.shots[side].url;
      if (photo && !S.guides[side]) S.guides[side] = Object.assign({}, DEFAULT_GUIDES);
      const r = ratios(S.guides[side]);
      body.innerHTML = `
        <div class="pg-tabs"><button type="button" data-side="front" class="${side === 'front' ? 'on' : ''}">Front</button><button type="button" data-side="back" class="${side === 'back' ? 'on' : ''}">Back</button></div>
        <div class="pg-stage${photo ? '' : ' is-empty'}" data-stage>
          ${photo ? `<img src="${esc(photo)}" alt="The ${side} of the card" data-img>` : `<div>No ${side} photo yet.</div>`}
          <div class="pg-loupe" data-loupe><canvas width="120" height="120"></canvas></div>
        </div>
        ${photo ? `
        <div class="pg-legend"><span><i style="background:#ffc928"></i>card edge</span><span><i style="background:#19bfff"></i>printed border</span><button type="button" class="pg-btn" data-reset style="height:34px;padding:0 10px;font-size:12px;margin-left:auto">Reset lines</button></div>
        <div class="pg-read">
          <div><small>Left / right</small><b data-lr class="${r && !r.bad && r.lr > 60 ? 'is-gold' : ''}">${r && !r.bad ? r.lr + '/' + (100 - r.lr) : '—'}</b></div>
          <div><small>Top / bottom</small><b data-tb class="${r && !r.bad && r.tb > 60 ? 'is-gold' : ''}">${r && !r.bad ? r.tb + '/' + (100 - r.tb) : '—'}</b></div>
        </div>
        <div class="pg-std" data-std style="font-size:13px;color:#9eb0c8;line-height:1.5">${stdText(r)}</div>` : ''}
        <div class="pg-card"><p>Yellow on the outside edge of the card, blue on the edge of the printed border. Drag the handles; the loupe shows exactly where the line sits. 50/50 is perfect. Do the front and the back.</p></div>`;
      const go = footHtml('Back', S.guides.back ? 'Next: the Infinite Grade' : (side === 'front' ? 'Now the back' : 'Next: the Infinite Grade'), !S.guides.front, true);
      go.addEventListener('click', () => { if (side === 'front' && !S.guides.back && S.shots.back) { S.side = 'back'; paint(); } else { S.step = 4; paint(); } });
      body.querySelector('.pg-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-side]'); if (!b) return; S.side = b.getAttribute('data-side'); paint(); });
      body.querySelector('[data-reset]')?.addEventListener('click', () => { S.guides[side] = Object.assign({}, DEFAULT_GUIDES); paint(); });
      if (photo) mountGuides(side);
    }
    function stdText(r) {
      if (!r) return '';
      if (r.bad) return 'The blue lines have to sit inside the yellow ones. Drag them back in.';
      return `Worst axis <b style="color:#f7f8fb">${r.worst}/${100 - r.worst}</b>. The AI reads the same photo and uses your lines as a check.`;
    }
    function mountGuides(side) {
      const stage = body.querySelector('[data-stage]');
      const img = body.querySelector('[data-img]');
      const loupe = body.querySelector('[data-loupe]');
      const lctx = loupe.querySelector('canvas').getContext('2d');
      const g = S.guides[side];
      const defs = [
        ['L', 'v', '#ffc928', .3], ['R', 'v', '#ffc928', .7], ['T', 'h', '#ffc928', .3], ['B', 'h', '#ffc928', .7],
        ['l', 'v', '#19bfff', .5], ['r', 'v', '#19bfff', .5], ['t', 'h', '#19bfff', .5], ['b', 'h', '#19bfff', .5]
      ];
      const els = {};
      defs.forEach(([k, dir, color, along]) => {
        const line = document.createElement('div'); line.className = 'pg-line ' + dir; line.style.setProperty('--c', color);
        const hand = document.createElement('div'); hand.className = 'pg-hand'; hand.style.setProperty('--c', color);
        hand.setAttribute('role', 'slider'); hand.setAttribute('tabindex', '0');
        hand.setAttribute('aria-label', ({ L: 'left card edge', R: 'right card edge', T: 'top card edge', B: 'bottom card edge', l: 'left border', r: 'right border', t: 'top border', b: 'bottom border' })[k]);
        hand.textContent = k.toUpperCase() === k ? 'EDGE' : 'ART';
        stage.appendChild(line); stage.appendChild(hand);
        els[k] = { line, hand, dir, along };
        hand.addEventListener('keydown', (e) => {
          const d = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -0.002 : (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 0.002 : 0;
          if (!d) return; e.preventDefault(); g[k] = Math.min(1, Math.max(0, g[k] + d)); layout(); readout();
        });
        hand.addEventListener('pointerdown', (e) => {
          e.preventDefault(); hand.setPointerCapture(e.pointerId); hand.classList.add('is-drag');
          const move = (ev) => { const f = toFrac(ev); if (!f) return; g[k] = dir === 'v' ? f.x : f.y; layout(); readout(); showLoupe(k); };
          const up = () => { hand.classList.remove('is-drag'); loupe.style.display = 'none'; hand.removeEventListener('pointermove', move); hand.removeEventListener('pointerup', up); hand.removeEventListener('pointercancel', up); };
          hand.addEventListener('pointermove', move); hand.addEventListener('pointerup', up); hand.addEventListener('pointercancel', up);
        });
      });
      let box = null;
      function measure() {
        const sr = stage.getBoundingClientRect();
        const iw = img.naturalWidth, ih = img.naturalHeight;
        if (!iw || !ih) { box = { x: 0, y: 0, w: sr.width, h: sr.height }; return; }
        const s = Math.min(sr.width / iw, sr.height / ih);
        const w = iw * s, h = ih * s;
        box = { x: (sr.width - w) / 2, y: (sr.height - h) / 2, w, h, s };
      }
      function toFrac(ev) {
        const sr = stage.getBoundingClientRect();
        if (!box) measure();
        const x = (ev.clientX - sr.left - box.x) / box.w, y = (ev.clientY - sr.top - box.y) / box.h;
        return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
      }
      function layout() {
        if (!box) measure();
        Object.keys(els).forEach(k => {
          const { line, hand, dir, along } = els[k];
          if (dir === 'v') {
            const x = box.x + g[k] * box.w;
            line.style.left = x + 'px'; line.style.top = box.y + 'px'; line.style.bottom = 'auto'; line.style.height = box.h + 'px';
            hand.style.left = x + 'px'; hand.style.top = (box.y + along * box.h) + 'px';
          } else {
            const y = box.y + g[k] * box.h;
            line.style.top = y + 'px'; line.style.left = box.x + 'px'; line.style.right = 'auto'; line.style.width = box.w + 'px';
            hand.style.top = y + 'px'; hand.style.left = (box.x + along * box.w) + 'px';
          }
        });
      }
      function readout() {
        const r = ratios(g);
        const lr = body.querySelector('[data-lr]'), tb = body.querySelector('[data-tb]'), st = body.querySelector('[data-std]');
        if (lr) { lr.textContent = r && !r.bad ? r.lr + '/' + (100 - r.lr) : '—'; lr.classList.toggle('is-gold', !!(r && !r.bad && r.lr > 60)); }
        if (tb) { tb.textContent = r && !r.bad ? r.tb + '/' + (100 - r.tb) : '—'; tb.classList.toggle('is-gold', !!(r && !r.bad && r.tb > 60)); }
        if (st) st.innerHTML = stdText(r);
      }
      function showLoupe(k) {
        const { dir, along } = els[k];
        const fx = dir === 'v' ? g[k] : along, fy = dir === 'h' ? g[k] : along;
        const px = fx * img.naturalWidth, py = fy * img.naturalHeight;
        const zoom = 4, R = 60 / zoom;
        try {
          lctx.fillStyle = '#000'; lctx.fillRect(0, 0, 120, 120);
          lctx.drawImage(img, px - R, py - R, R * 2, R * 2, 0, 0, 120, 120);
          lctx.strokeStyle = els[k].hand.style.getPropertyValue('--c'); lctx.lineWidth = 2;
          lctx.beginPath();
          if (dir === 'v') { lctx.moveTo(60, 0); lctx.lineTo(60, 120); } else { lctx.moveTo(0, 60); lctx.lineTo(120, 60); }
          lctx.stroke();
        } catch (_) {}
        const sx = box.x + fx * box.w, sy = box.y + fy * box.h;
        const sr = stage.getBoundingClientRect();
        loupe.style.left = (sx < sr.width / 2 ? sr.width - 132 : 12) + 'px';
        loupe.style.top = (sy < sr.height / 2 ? sr.height - 132 : 12) + 'px';
        loupe.style.display = 'block';
      }
      const ready = () => { measure(); layout(); };
      if (img.complete && img.naturalWidth) ready(); else img.addEventListener('load', ready);
      window.addEventListener('resize', ready);
      const mo = new MutationObserver(() => { if (!document.body.contains(stage)) { window.removeEventListener('resize', ready); mo.disconnect(); } });
      mo.observe(body, { childList: true });
    }

    /* ---- 4. the Infinite Grade ---------------------------------------------- */
    function paintGrade() {
      q('[data-sub]').textContent = 'The Infinite Grade';
      if (!S.result) { send(); return; }
      const R = S.result;
      if (R.status === 'reshoot') { paintReshoot(R); return; }
      if (R.status !== 'ok') {
        body.innerHTML = `<div class="pg-warn"><b>${R.status === 'limit' ? 'Out of grades this month.' : R.status === 'off' ? 'Not switched on yet.' : 'That didn\'t go through.'}</b> ${esc(R.reason || '')}</div>`;
        footHtml('Back', R.status === 'error' ? 'Try again' : 'Start over', false).addEventListener('click', () => { if (R.status === 'error') { S.result = null; paint(); } else reset(); });
        return;
      }
      const rep = R.report;
      const g = rep.grade;
      const range = g.low === g.high ? String(g.low) : `${g.low}–${g.high}`;
      const c = rep.centering || {};
      const fc = c.front || {}, bc = c.back || {};
      const sevRank = { heavy: 0, moderate: 1, light: 2 };
      const defects = (rep.defects || []).slice().sort((a, b) => (sevRank[a.severity] ?? 1) - (sevRank[b.severity] ?? 1));
      body.innerHTML = `
        ${S.card ? `<div class="pg-hit on" style="pointer-events:none"><span class="pg-art">${S.card.img ? `<img src="${esc(S.card.img)}" alt="">` : ''}</span><span><strong>${esc(S.card.name)}</strong><small>${esc([S.card.set, S.card.num].filter(Boolean).join(' · '))}</small></span></div>` : ''}
        <div class="pg-grade"><small>Infinite Pre-Grade</small><b>${esc(range)}</b><em>${esc(g.why || '')}</em></div>
        ${rep.summary ? `<div class="pg-card"><p style="color:#c9d4e3;font-size:14px">${esc(rep.summary)}</p></div>` : ''}
        <div class="pg-lab">${defects.length ? defects.length + ' thing' + (defects.length === 1 ? '' : 's') + ' we found' : 'Nothing we could see'}</div>
        ${defects.length ? defects.map(d => defectHtml(d)).join('') : '<div class="pg-good">No defects showed up in these photos. That is not the same as none exist: see what we couldn\'t check below.</div>'}
        <div class="pg-lab">Centering</div>
        <div class="pg-read">
          <div><small>Front L/R · T/B</small><b>${fc.lr ? fc.lr + '/' + (100 - fc.lr) : '—'} · ${fc.tb ? fc.tb + '/' + (100 - fc.tb) : '—'}</b></div>
          <div><small>Back L/R · T/B</small><b>${bc.lr ? bc.lr + '/' + (100 - bc.lr) : '—'} · ${bc.tb ? bc.tb + '/' + (100 - bc.tb) : '—'}</b></div>
        </div>
        ${rep.unseen && rep.unseen.length ? `<div class="pg-card"><h3>Couldn't check</h3><ul class="pg-why">${rep.unseen.map(u => `<li>${esc(u)}</li>`).join('')}</ul></div>` : ''}
        <div class="pg-lab">Your slab</div>
        <div class="pg-slabwrap"><canvas data-slab width="600" height="840"></canvas></div>
        <div class="pg-row"><button type="button" class="pg-btn is-gold" data-save style="flex:1">Save the slab picture</button><button type="button" class="pg-btn" data-share>Share</button></div>
        <p class="pg-fine">This is a <b style="color:#f7f8fb">pre-grade</b>, our estimate from the photos you took, not a grade from PSA, CGC, BGS or anyone else. A phone photo can't show everything, and the AI only sees what your pictures show. The responsibility for the photos, and for what you do next, is yours.${R.used ? ` Infinite Grades used this month: ${R.used} of ${R.limit}.` : ''}</p>`;
      footHtml('', 'Grade another card', false).addEventListener('click', reset);
      drawSlab(body.querySelector('[data-slab]'), range);
      body.querySelector('[data-save]').addEventListener('click', () => saveSlab(body.querySelector('[data-slab]'), false));
      body.querySelector('[data-share]').addEventListener('click', () => saveSlab(body.querySelector('[data-slab]'), true));
      remember(rep, range);
    }
    function defectHtml(d) {
      const shot = S.shots[d.image];
      const b = d.box;
      const label = (SHOTS.find(s => s.kind === d.image) || {}).label || d.image;
      /* the thumbnail is the photo cropped to a window around the box, so the
         circle is big enough to see; the window is at least 40% of the photo */
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const win = Math.min(1, Math.max(0.4, Math.max(b.w, b.h) * 2.2));
      const wx = Math.min(1 - win, Math.max(0, cx - win / 2)), wy = Math.min(1 - win, Math.max(0, cy - win / 2));
      const scale = 100 / win;
      return `<div class="pg-def">
        <div class="pic"><img src="${shot ? esc(shot.url) : ''}" alt="" style="width:${scale}%;height:${scale}%;object-fit:fill;position:absolute;left:${-wx * scale}%;top:${-wy * scale}%">
          <i style="left:${(b.x - wx) * scale}%;top:${(b.y - wy) * scale}%;width:${b.w * scale}%;height:${b.h * scale}%"></i></div>
        <div><strong>${esc(d.kind)}</strong><small>${esc(label)}${d.note ? ' · ' + esc(d.note) : ''}</small><span class="sev ${esc(d.severity)}">${esc(d.severity)}</span></div>
      </div>`;
    }
    function paintReshoot(R) {
      const bad = (R.shots || []).filter(s => !s.ok);
      bad.forEach(s => { if (S.shots[s.kind]) { S.shots[s.kind].ok = false; S.shots[s.kind].why = s.why; S.shots[s.kind].fix = s.fix; } });
      body.innerHTML = `
        <div class="pg-warn"><b>We can't grade this from these photos yet.</b> ${bad.length} shot${bad.length === 1 ? '' : 's'} need${bad.length === 1 ? 's' : ''} redoing. Nothing was counted against your month.</div>
        ${bad.map(s => { const spec = SHOTS.find(x => x.kind === s.kind) || {}; const shot = S.shots[s.kind]; return `
          <div class="pg-def"><div class="pic">${shot ? `<img src="${esc(shot.url)}" alt="">` : ''}</div>
          <div><strong style="text-transform:none">${esc(spec.label || s.kind)}</strong><small>${esc(s.why)}</small><small style="color:#f7f8fb;margin-top:4px">${esc(s.fix)}</small></div></div>`; }).join('')}
        <div class="pg-card"><p><b style="color:#f7f8fb">Most fixes are light.</b> Get a lamp or a flashlight right over the card, take it out of the sleeve, fill the outline, hold still a second.</p></div>`;
      footHtml('', 'Redo those photos', false, true).addEventListener('click', () => {
        S.result = null;
        const first = SHOTS.findIndex(s => bad.some(b => b.kind === s.kind));
        S.cur = first >= 0 ? first : 0;
        S.step = 2; paint();
      });
    }

    async function send() {
      S.busy = true;
      body.innerHTML = `<div class="pg-wait"><div class="pg-spin"></div><b style="font-size:17px">Inspecting your ${Object.keys(S.shots).length} photos</b><p style="margin:0;color:#9eb0c8;font-size:13px;line-height:1.5">First a look at whether every shot is good enough, then the full inspection. About a minute. Don't close this.</p></div>`;
      foot.innerHTML = '';
      const db = sb();
      const cf = ratios(S.guides.front), cb = ratios(S.guides.back);
      const payload = {
        card: S.card ? { name: S.card.name, set: S.card.set, num: S.card.num } : null,
        centering: { front: cf && !cf.bad ? { lr: cf.lr, tb: cf.tb } : null, back: cb && !cb.bad ? { lr: cb.lr, tb: cb.tb } : null },
        shots: SHOTS.filter(s => S.shots[s.kind]).map(s => ({ kind: s.kind, image: S.shots[s.kind].url }))
      };
      let res = null;
      try {
        const r = await db.functions.invoke('infinite-grade', { body: payload });
        if (r.error) {
          let msg = 'Could not reach the inspector.';
          try { const ctx = r.error.context; if (ctx && ctx.json) { const j = await ctx.json(); if (j && j.error) msg = j.error; } } catch (_) {}
          res = { status: 'error', reason: msg };
        } else res = r.data || { status: 'error', reason: 'Empty answer.' };
      } catch (e) {
        res = { status: 'error', reason: 'No connection. Your photos are still here; try again in a moment.' };
      }
      S.busy = false;
      if (closed) return;
      S.result = res;
      paint();
    }

    /* ---- the slab picture ------------------------------------------------ */
    function drawSlab(canvas, range) {
      if (!canvas) return;
      const W = canvas.width, H = canvas.height;
      const ctx = canvas.getContext('2d');
      const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
      /* the case */
      ctx.fillStyle = '#03070d'; ctx.fillRect(0, 0, W, H);
      const cg = ctx.createLinearGradient(0, 0, W, H); cg.addColorStop(0, '#1b2740'); cg.addColorStop(1, '#0a1120');
      ctx.fillStyle = cg; rr(16, 16, W - 32, H - 32, 28); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 3; rr(16, 16, W - 32, H - 32, 28); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1; rr(30, 30, W - 60, H - 60, 20); ctx.stroke();
      /* the label */
      ctx.fillStyle = '#ffffff'; rr(44, 44, W - 88, 150, 14); ctx.fill();
      ctx.fillStyle = '#03070d';
      ctx.font = '800 20px system-ui, -apple-system, sans-serif'; ctx.textBaseline = 'top';
      const name = (S.card ? S.card.name : 'Pokémon card').toUpperCase().slice(0, 26);
      const sub = S.card ? [S.card.set, S.card.num].filter(Boolean).join(' · ').slice(0, 40) : '';
      ctx.fillText(name, 64, 60);
      ctx.font = '600 16px system-ui, -apple-system, sans-serif'; ctx.fillStyle = '#5c6a80'; ctx.fillText(sub, 64, 88);
      ctx.fillStyle = '#d99a00'; ctx.font = '900 13px system-ui, -apple-system, sans-serif';
      ctx.fillText('I N F I N I T E   P R E - G R A D E', 64, 120);
      ctx.fillStyle = '#5c6a80'; ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      ctx.fillText('AI estimate from your photos · not a PSA/CGC/BGS grade', 64, 142);
      ctx.fillText('infinitepulls.com', 64, 158);
      /* the grade box */
      ctx.fillStyle = '#ffc928'; rr(W - 44 - 150, 60, 150, 118, 12); ctx.fill();
      ctx.fillStyle = '#1b1400'; ctx.textAlign = 'center';
      ctx.font = `800 ${range.length > 3 ? 48 : 60}px system-ui, -apple-system, sans-serif`;
      ctx.fillText(range, W - 44 - 75, 72);
      ctx.font = '800 12px system-ui, -apple-system, sans-serif'; ctx.fillText('PRE-GRADE', W - 44 - 75, 150);
      ctx.textAlign = 'left';
      /* the card, under the plastic */
      const shot = S.shots.front;
      const cx = 86, cy = 222, cw = W - 172, ch = H - 222 - 70;
      ctx.fillStyle = '#000'; rr(cx, cy, cw, ch, 14); ctx.fill();
      if (shot) {
        const img = new Image();
        img.onload = () => {
          ctx.save(); rr(cx, cy, cw, ch, 14); ctx.clip();
          const s = Math.max(cw / img.width, ch / img.height);
          const dw = img.width * s, dh = img.height * s;
          ctx.drawImage(img, cx + (cw - dw) / 2, cy + (ch - dh) / 2, dw, dh);
          /* a glass shine */
          const sh = ctx.createLinearGradient(cx, cy, cx + cw, cy + ch); sh.addColorStop(0, 'rgba(255,255,255,.14)'); sh.addColorStop(.45, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(255,255,255,.06)');
          ctx.fillStyle = sh; ctx.fillRect(cx, cy, cw, ch);
          ctx.restore();
          ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '700 12px system-ui, -apple-system, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('∞  INFINITE PULLS  ·  PRE-GRADE, NOT A CERTIFICATION', W / 2, H - 46);
          ctx.textAlign = 'left';
        };
        img.src = shot.url;
      }
    }
    async function saveSlab(canvas, share) {
      if (!canvas) return;
      const name = ((S.card && S.card.name) || 'card').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const file = await new Promise(r => canvas.toBlob(b => r(b && new File([b], `infinite-pre-grade-${name}.png`, { type: 'image/png' })), 'image/png'));
      if (!file) return;
      if (share && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'My Infinite Pre-Grade' }); return; } catch (_) { /* fall through */ }
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    function remember(rep, range) {
      try {
        const saved = JSON.parse(localStorage.getItem(KEY_REPORTS) || '[]');
        saved.unshift({ at: Date.now(), card: S.card && { id: S.card.id, name: S.card.name, set: S.card.set, num: S.card.num, img: S.card.img }, range, grade: rep.grade, defects: rep.defects.length, unseen: rep.unseen });
        localStorage.setItem(KEY_REPORTS, JSON.stringify(saved.slice(0, 20)));
      } catch (_) {}
    }
    function reset() {
      S.card = null; S.shots = {}; S.cur = 0; S.side = 'front'; S.guides = { front: null, back: null }; S.result = null; found = [];
      S.step = 1; paint();
    }

    let seen = false;
    try { seen = !!localStorage.getItem(KEY_TUT); } catch (_) {}
    S.step = seen ? 1 : 0;
    paint();
  }

  if (document.head) injectCss(); else document.addEventListener('DOMContentLoaded', injectCss);
  window.InfinitePullsPregrade = { open };
})();
