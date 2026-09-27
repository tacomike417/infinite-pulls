/* THE LOOP MAKER (27 Sep 2026, Mike: "I suck at making reels")
 *
 * Pick 1-5 photos, pick a style, type a line, slap on stickers -- and it
 * makes a real video, right on the phone. Over the top on purpose ("I want
 * people to be like, that's cool").
 *
 *   STYLES   Pull Day  -- zoom punch, white flash, holo shimmer, gold text
 *            Hype      -- whip pans, shake, glitch, neon text
 *            At the Show -- spins, sparkles, confetti
 *            Chill     -- slow zooms and soft fades
 *   STICKERS the 30 in /assets/loops/stickers. Tap to add; drag to move;
 *            pinch (or mouse wheel) to size and turn. They pop in and keep
 *            moving -- bounce, wiggle, wobble or float, by style.
 *   MUSIC    not yet (license check first). The slot is ready.
 *
 * The preview and the finished video are drawn by THE SAME render(), so what
 * you see is what you get. The video is made with mediabunny (the phone's
 * own video chip, faster than real time); an older phone records the canvas
 * in real time instead. The result goes back to loops.js like any picked
 * video: caption, post, upload.
 *
 * A covering screen on the feed's back stack -- the phone's back button
 * closes it. No on-screen back button.
 */
(function () {
  'use strict';
  if (window.InfinitePullsLoopMaker) return;

  const W = 720, H = 1280, FPS = 30;
  const MB_LIB = 'https://cdn.jsdelivr.net/npm/mediabunny@1.60.0/dist/bundles/mediabunny.min.mjs';
  const STICKERS = ['omg', 'big-pull-energy', 'lets-gooo', 'no-way', 'fire', 'hit', 'grail', 'god-pack',
    'pullday', 'pull-of-the-day', 'just-pulled', 'holo-hype', 'chase-card', 'pack-luck', 'rip', 'w',
    '10-10', 'mint', 'slab-it', 'sealed', 'binder-goals', 'dupes-again', 'for-trade', 'trade-me',
    'card-show', 'shop-day', 'were-here', 'hi-friends', 'vibe-check', 'infinite-pulls'];
  const STICKER_URL = (n) => `/assets/loops/stickers/${n}.webp`;
  const STYLES = [
    { key: 'pullday', name: 'Pull Day', icon: '⚡' },
    { key: 'hype', name: 'Hype', icon: '🔥' },
    { key: 'show', name: 'At the Show', icon: '🎉' },
    { key: 'chill', name: 'Chill', icon: '🌙' }
  ];
  const MAX_PHOTOS = 5;

  const back = () => window.InfinitePullsFeedBack || null;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  /* ---------------- state ---------------- */
  let st = null;          /* { photos:[{bmp,thumb}], style, text, stickers:[{n,img,x,y,s,r}], sel } */
  const imgCache = new Map();
  function stickerImg(n) {
    if (imgCache.has(n)) return imgCache.get(n);
    const im = new Image();
    im.src = STICKER_URL(n);
    imgCache.set(n, im);
    return im;
  }
  const duration = () => {
    const n = st.photos.length;
    return n ? Math.min(15, Math.max(6, n * 3)) : 6;
  };

  /* ---------------- drawing ---------------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const easeInOut = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;

  function drawCover(ctx, bmp, zoom, dx, dy, rot, alpha) {
    if (!bmp) return;
    const s = Math.max(W / bmp.width, H / bmp.height) * zoom;
    const w = bmp.width * s, h = bmp.height * s;
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(W / 2 + dx, H / 2 + dy);
    if (rot) ctx.rotate(rot);
    ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /* where photo i sits at progress p (0..1) through its own slot */
  function kenBurns(i, p, style) {
    const dir = i % 2 ? -1 : 1;
    if (style === 'hype') return { z: 1.12 + 0.16 * p, x: dir * 30 * (p - 0.5), y: 0 };
    if (style === 'chill') return { z: 1.04 + 0.08 * p, x: dir * 18 * (p - 0.5), y: -10 * p };
    if (style === 'show') return { z: 1.08 + 0.1 * p, x: 0, y: dir * 24 * (p - 0.5) };
    return { z: 1.06 + 0.14 * p, x: dir * 22 * (p - 0.5), y: 0 };
  }

  function render(ctx, t, preview) {
    const style = st.style;
    const n = st.photos.length;
    const D = duration();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, W, H);

    if (!n) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#1b1034'); g.addColorStop(0.5, '#0b1a33'); g.addColorStop(1, '#2a0c24');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.font = '800 44px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Add up to 5 photos', W / 2, H / 2);
    } else {
      const seg = D / n;
      const i = Math.min(n - 1, Math.floor(t / seg));
      const local = t - i * seg;
      const p = clamp(local / seg, 0, 1);
      const TR = style === 'chill' ? 0.7 : 0.45;
      const cur = st.photos[i].bmp;
      const kb = kenBurns(i, p, style);

      /* shake at the start of every photo in Hype */
      let sx = 0, sy = 0;
      if (style === 'hype' && local < 0.35) {
        const a = (1 - local / 0.35) * 18;
        sx = Math.sin(t * 90) * a; sy = Math.cos(t * 70) * a;
      }

      if (i > 0 && local < TR) {
        const q = clamp(local / TR, 0, 1);
        const prev = st.photos[i - 1].bmp;
        const kp = kenBurns(i - 1, 1, style);
        if (style === 'pullday') {
          drawCover(ctx, prev, kp.z, kp.x, kp.y, 0, 1);
          const z = 1.45 - 0.45 * easeOutBack(q);
          drawCover(ctx, cur, kb.z * z, kb.x, kb.y, 0, clamp(q * 3, 0, 1));
        } else if (style === 'hype') {
          const e = easeInOut(q);
          drawCover(ctx, prev, kp.z, kp.x - e * W, kp.y, 0, 1);
          for (let g = 3; g >= 1; g--) drawCover(ctx, cur, kb.z, kb.x + (1 - e) * W + g * 26 * (1 - q), kb.y, 0, 0.18);
          drawCover(ctx, cur, kb.z, kb.x + (1 - e) * W, kb.y, 0, 1);
        } else if (style === 'show') {
          drawCover(ctx, prev, kp.z, kp.x, kp.y, 0, 1);
          const e = easeOutBack(q);
          drawCover(ctx, cur, kb.z * (0.25 + 0.75 * e), kb.x, kb.y, (1 - e) * -0.9, clamp(q * 2, 0, 1));
        } else {
          drawCover(ctx, prev, kp.z, kp.x, kp.y, 0, 1);
          drawCover(ctx, cur, kb.z, kb.x, kb.y, 0, easeInOut(q));
        }
      } else {
        drawCover(ctx, cur, kb.z, kb.x + sx, kb.y + sy, 0, 1);
      }

      /* the flash */
      if (i > 0 && (style === 'pullday' || style === 'hype') && local < 0.3) {
        ctx.fillStyle = `rgba(255,255,255,${(1 - local / 0.3) * (style === 'hype' ? 0.55 : 0.8)})`;
        ctx.fillRect(0, 0, W, H);
      }
      /* glitch bands in Hype, just after each cut and now and then */
      if (style === 'hype' && ((i > 0 && local > 0.1 && local < 0.35) || (Math.sin(t * 3.1) > 0.985))) {
        for (let b = 0; b < 7; b++) {
          const y = ((b * 197 + Math.floor(t * 20) * 71) % H);
          const h = 14 + ((b * 37) % 40);
          const dx = ((b % 2 ? 1 : -1) * (20 + ((b * 53 + Math.floor(t * 30) * 13) % 60)));
          ctx.drawImage(ctx.canvas, 0, y, W, h, dx, y, W, h);
        }
        ctx.fillStyle = 'rgba(0,255,255,.08)'; ctx.fillRect(0, 0, W, H);
      }
    }

    /* holo shimmer (Pull Day) */
    if (style === 'pullday') {
      const x = ((t * 420) % (W * 2.4)) - W * 0.7;
      const g = ctx.createLinearGradient(x, 0, x + 360, H * 0.4);
      g.addColorStop(0, 'rgba(255,0,150,0)');
      g.addColorStop(0.3, 'rgba(255,90,200,.16)');
      g.addColorStop(0.5, 'rgba(90,220,255,.2)');
      g.addColorStop(0.7, 'rgba(255,230,90,.16)');
      g.addColorStop(1, 'rgba(0,255,150,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    /* sparkles + confetti (At the Show) */
    if (style === 'show') {
      for (let k = 0; k < 26; k++) {
        const sp = 60 + (k * 37) % 90;
        const x = (k * 263 + Math.sin(t * 1.3 + k) * 40) % W;
        const y = ((k * 149 + t * sp) % (H + 40)) - 20;
        ctx.save();
        ctx.translate(x, y); ctx.rotate(t * 3 + k);
        ctx.fillStyle = ['#ff3d8b', '#ffc13d', '#3dd6ff', '#8b5bff', '#35d07f'][k % 5];
        if (k % 3) ctx.fillRect(-6, -3, 12, 6);
        else { ctx.beginPath(); for (let a = 0; a < 4; a++) { ctx.rotate(Math.PI / 2); ctx.moveTo(0, 0); ctx.lineTo(0, 14); } ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); }
        ctx.restore();
      }
    }
    /* vignette */
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, style === 'chill' ? 'rgba(0,0,0,.55)' : 'rgba(0,0,0,.4)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    drawText(ctx, t);
    drawStickers(ctx, t, preview);

    /* the mark, small, so a Loop shared elsewhere says where it came from */
    ctx.save();
    ctx.font = '900 26px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillText('∞ INFINITE PULLS', W - 26, H - 38);
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillText('∞ INFINITE PULLS', W - 28, H - 40);
    ctx.restore();
  }

  function fitFont(ctx, text, max, weight) {
    let size = max;
    ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    while (size > 40 && ctx.measureText(text).width > W - 90) {
      size -= 4;
      ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    }
    return size;
  }

  function drawText(ctx, t) {
    const text = (st.text || '').trim();
    if (!text) return;
    const style = st.style;
    ctx.save();
    const size = fitFont(ctx, text.toUpperCase(), 118, 900);
    const up = text.toUpperCase();
    let sc = 1, a = 1, y = H * 0.2;
    const k = clamp((t - 0.15) / 0.5, 0, 1);
    if (style === 'chill') { a = k; y += (1 - k) * 30 + Math.sin(t * 1.2) * 6; }
    else { sc = k ? easeOutBack(k) : 0; y += Math.sin(t * (style === 'hype' ? 6 : 3)) * (style === 'hype' ? 6 : 8); }
    if (sc <= 0.01 || a <= 0.01) { ctx.restore(); return; }
    ctx.translate(W / 2, y);
    ctx.scale(sc, sc);
    if (style === 'hype') ctx.rotate(Math.sin(t * 8) * 0.03);
    ctx.globalAlpha = a;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (style === 'hype') {
      ctx.fillStyle = '#00f0ff'; ctx.fillText(up, -5, 3);
      ctx.fillStyle = '#ff2d8a'; ctx.fillText(up, 5, -3);
      ctx.lineWidth = size * 0.1; ctx.strokeStyle = '#000'; ctx.strokeText(up, 0, 0);
      ctx.fillStyle = '#fff'; ctx.fillText(up, 0, 0);
    } else if (style === 'show') {
      ctx.lineWidth = size * 0.16; ctx.strokeStyle = '#fff'; ctx.strokeText(up, 0, 0);
      const g = ctx.createLinearGradient(-W / 2, 0, W / 2, 0);
      g.addColorStop(0, '#ff8a00'); g.addColorStop(1, '#e52e71');
      ctx.fillStyle = g; ctx.fillText(up, 0, 0);
    } else if (style === 'chill') {
      ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 18;
      ctx.fillStyle = '#fff'; ctx.fillText(up, 0, 0);
    } else {
      ctx.lineWidth = size * 0.16; ctx.strokeStyle = '#1b1400'; ctx.strokeText(up, 0, 0);
      const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
      g.addColorStop(0, '#fff3b0'); g.addColorStop(0.5, '#ffd23f'); g.addColorStop(1, '#ff9a1f');
      ctx.fillStyle = g; ctx.fillText(up, 0, 0);
    }
    ctx.restore();
  }

  function stickerBox(s) {
    const img = s.img;
    const w = s.s * W;
    const ratio = img && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1;
    return { w, h: w * ratio, x: s.x * W, y: s.y * H };
  }

  function drawStickers(ctx, t, preview) {
    st.stickers.forEach((s, k) => {
      if (!s.img || !s.img.complete || !s.img.naturalWidth) return;
      const b = stickerBox(s);
      const t0 = 0.35 + k * 0.22;
      let sc = 1, rot = s.r, dy = 0;
      const k2 = clamp((t - t0) / 0.4, 0, 1);
      const live = preview && st.sel === k;
      if (!live) {
        if (k2 <= 0) return;
        sc = easeOutBack(k2);
        const tt = t + k * 0.7;
        if (st.style === 'hype') rot += Math.sin(tt * 9) * 0.12;
        else if (st.style === 'show') { rot += Math.sin(tt * 2.2) * 0.2; sc *= 1 + Math.sin(tt * 4.4) * 0.04; }
        else if (st.style === 'chill') dy = Math.sin(tt * 1.4) * 10;
        else { dy = -Math.abs(Math.sin(tt * 3.2)) * 18; }
      }
      ctx.save();
      ctx.translate(b.x, b.y + dy);
      ctx.rotate(rot);
      ctx.scale(sc, sc);
      ctx.drawImage(s.img, -b.w / 2, -b.h / 2, b.w, b.h);
      if (live) {
        ctx.setLineDash([14, 10]); ctx.lineWidth = 4; ctx.strokeStyle = '#ffc13d';
        ctx.strokeRect(-b.w / 2 - 8, -b.h / 2 - 8, b.w + 16, b.h + 16);
      }
      ctx.restore();
    });
  }

  /* ---------------- the screen ---------------- */
  const CSS = `
.lpm{position:fixed;inset:0;z-index:9560;background:#05080f;color:#fff;display:flex;flex-direction:column;font:500 15px/1.35 system-ui,-apple-system,sans-serif;overscroll-behavior:contain}
.lpm-stage{flex:1;min-height:0;display:grid;place-items:center;padding:calc(10px + env(safe-area-inset-top)) 10px 6px}
.lpm-stage canvas{display:block;border-radius:16px;background:#000;touch-action:none;box-shadow:0 10px 30px rgba(0,0,0,.6)}
.lpm-len{position:absolute;top:calc(16px + env(safe-area-inset-top));left:16px;padding:5px 10px;border-radius:999px;background:rgba(0,0,0,.55);font:800 12px/1 system-ui,sans-serif}
.lpm-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:6px 10px 0}
.lpm-tabs button{border:0;border-radius:10px 10px 0 0;padding:10px 4px;background:#0f172a;color:#94a3b8;font:900 12.5px/1 system-ui,sans-serif;cursor:pointer}
.lpm-tabs button.on{background:#1e293b;color:#fff}
.lpm-panel{background:#1e293b;margin:0 10px;border-radius:0 0 12px 12px;padding:10px;height:168px;overflow:auto}
.lpm-go{margin:8px 10px calc(10px + env(safe-area-inset-bottom));padding:15px;border:0;border-radius:14px;background:linear-gradient(135deg,#ff8a00,#e52e71);color:#fff;font:900 17px/1 system-ui,sans-serif;cursor:pointer}
.lpm-go[disabled]{opacity:.45}
.lpm-thumbs{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
.lpm-th{position:relative;flex:none;width:72px;height:110px;border-radius:10px;overflow:hidden;background:#0f172a;border:0;padding:0}
.lpm-th img{width:100%;height:100%;object-fit:cover}
.lpm-th b{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,.7);color:#fff;font:900 13px/22px system-ui;text-align:center}
.lpm-add{flex:none;width:72px;height:110px;border-radius:10px;border:2px dashed #ffc13d;background:none;color:#ffc13d;font:900 13px/1.2 system-ui,sans-serif;cursor:pointer}
.lpm-add i{display:block;font-style:normal;font-size:28px;margin-bottom:4px}
.lpm-styles{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.lpm-styles button{border:2px solid transparent;border-radius:12px;padding:14px 8px;background:#0f172a;color:#fff;font:900 15px/1 system-ui,sans-serif;cursor:pointer}
.lpm-styles button.on{border-color:#ffc13d;background:#2a2410}
.lpm-text input{box-sizing:border-box;width:100%;padding:14px;border-radius:12px;border:1px solid #334155;background:#0f172a;color:#fff;font:800 17px/1.2 system-ui,sans-serif}
.lpm-hint{margin:8px 2px 0;color:#94a3b8;font-size:12.5px}
.lpm-stk{display:grid;grid-template-rows:repeat(2,64px);grid-auto-flow:column;grid-auto-columns:64px;gap:8px;overflow-x:auto}
.lpm-stk button{border:0;background:#0f172a;border-radius:12px;padding:4px;cursor:pointer}
.lpm-stk img{width:100%;height:100%;object-fit:contain}
.lpm-selbar{display:flex;gap:8px;margin-bottom:8px}
.lpm-selbar button{flex:1;border:0;border-radius:10px;padding:10px;background:#3b0d12;color:#ffd7d9;font:900 13px/1 system-ui,sans-serif}
.lpm-busy{position:absolute;inset:0;z-index:2;display:grid;place-items:center;background:rgba(5,8,15,.86);text-align:center;font:900 18px/1.4 system-ui,sans-serif}
.lpm-busy .bar{width:220px;height:8px;margin:14px auto 0;border-radius:4px;background:#334155;overflow:hidden}
.lpm-busy .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#ff8a00,#e52e71)}
`;
  (function addCSS() {
    if (document.getElementById('loop-maker-css')) return;
    const s = document.createElement('style');
    s.id = 'loop-maker-css'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  })();

  let el = null, cv = null, ctx = null, raf = 0, t0 = 0, tab = 'photos', onDone = null, busy = false;
  let picker = null;

  /* the whole 9:16 picture, as big as the space allows */
  function fit() {
    if (!el || !cv) return;
    const r = el.querySelector('.lpm-stage').getBoundingClientRect();
    const h = Math.max(120, Math.min(r.height - 16, (r.width - 20) * 16 / 9));
    cv.style.height = h + 'px';
    cv.style.width = (h * 9 / 16) + 'px';
  }

  function close() {
    window.removeEventListener('resize', fit);
    cancelAnimationFrame(raf); raf = 0;
    if (el) { el.remove(); el = null; }
    if (st) st.photos.forEach((p) => { try { p.bmp.close && p.bmp.close(); } catch (_) {} if (p.thumb) URL.revokeObjectURL(p.thumb); });
    st = null;
  }
  const leave = (then) => {
    const b = back();
    if (!b || !b.pop('loopmaker')) close();
    if (then) setTimeout(then, 260);
  };

  function open(opts) {
    if (el) return;
    onDone = (opts && opts.onDone) || null;
    st = { photos: [], style: 'pullday', text: '', stickers: [], sel: -1 };
    tab = 'photos';
    el = document.createElement('div');
    el.className = 'lpm';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Make a Loop');
    el.innerHTML = `
      <div class="lpm-stage"><canvas width="${W}" height="${H}" aria-label="Preview"></canvas></div>
      <span class="lpm-len"></span>
      <nav class="lpm-tabs">
        <button type="button" data-tab="photos" class="on">📷 Photos</button>
        <button type="button" data-tab="style">✨ Style</button>
        <button type="button" data-tab="text">Aa Text</button>
        <button type="button" data-tab="stickers">😎 Stickers</button>
      </nav>
      <div class="lpm-panel"></div>
      <button type="button" class="lpm-go" disabled>Make my Loop</button>`;
    document.body.appendChild(el);
    const b = back();
    if (b) b.push('loopmaker', close);
    cv = el.querySelector('canvas');
    ctx = cv.getContext('2d');
    fit();
    window.addEventListener('resize', fit);
    STICKERS.forEach(stickerImg);
    wire();
    paintPanel();
    t0 = performance.now();
    const loop = () => {
      if (!el) return;
      const D = duration();
      render(ctx, ((performance.now() - t0) / 1000) % D, true);
      raf = requestAnimationFrame(loop);
    };
    loop();
  }

  function paintLen() {
    const l = el && el.querySelector('.lpm-len');
    if (l) l.textContent = `${duration()} sec`;
    const go = el && el.querySelector('.lpm-go');
    if (go) go.disabled = !st.photos.length || busy;
  }

  function paintPanel() {
    if (!el) return;
    el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.getAttribute('data-tab') === tab));
    const p = el.querySelector('.lpm-panel');
    if (tab === 'photos') {
      p.innerHTML = `<div class="lpm-thumbs">
        ${st.photos.map((ph, i) => `<button type="button" class="lpm-th" data-rm="${i}" aria-label="Remove photo"><img src="${ph.thumb}" alt=""><b>✕</b></button>`).join('')}
        ${st.photos.length < MAX_PHOTOS ? `<button type="button" class="lpm-add" data-add><i>+</i>Add photos</button>` : ''}
      </div><p class="lpm-hint">${st.photos.length ? 'About 3 seconds each, in this order. Tap one to take it out.' : 'Pick 1 to 5 pictures from your phone.'}</p>`;
    } else if (tab === 'style') {
      p.innerHTML = `<div class="lpm-styles">${STYLES.map((s) =>
        `<button type="button" data-style="${s.key}" class="${st.style === s.key ? 'on' : ''}">${s.icon} ${esc(s.name)}</button>`).join('')}</div>`;
    } else if (tab === 'text') {
      p.innerHTML = `<div class="lpm-text"><input type="text" maxlength="40" placeholder="Big text on your Loop (optional)" value="${esc(st.text)}" enterkeyhint="done"></div>
        <p class="lpm-hint">Short and loud works best: "PULL DAY", "LOOK AT THIS", "WE'RE HERE!"</p>`;
      const inp = p.querySelector('input');
      inp.addEventListener('input', () => { st.text = inp.value; });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    } else {
      p.innerHTML = `${st.sel >= 0 ? '<div class="lpm-selbar"><button type="button" data-unstick>✕ Remove this sticker</button></div>' : ''}
        <div class="lpm-stk">${STICKERS.map((n) =>
        `<button type="button" data-stk="${n}" aria-label="${esc(n.replace(/-/g, ' '))}"><img src="${STICKER_URL(n)}" alt="" loading="lazy"></button>`).join('')}</div>
        ${st.sel >= 0 ? '' : '<p class="lpm-hint">Tap to add. Drag it on the picture; pinch to size and turn.</p>'}`;
    }
    paintLen();
  }

  function pickPhotos() {
    if (!picker) {
      picker = document.createElement('input');
      picker.type = 'file'; picker.accept = 'image/*'; picker.multiple = true;
      picker.style.display = 'none';
      document.body.appendChild(picker);
      picker.addEventListener('change', async () => {
        const files = [...(picker.files || [])].slice(0, MAX_PHOTOS - (st ? st.photos.length : 0));
        picker.value = '';
        for (const f of files) {
          try {
            let bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
            const big = Math.max(bmp.width, bmp.height);
            if (big > 1600) {
              const s = 1600 / big;
              const small = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * s), resizeHeight: Math.round(bmp.height * s), resizeQuality: 'high' });
              bmp.close && bmp.close(); bmp = small;
            }
            if (!st) return;
            st.photos.push({ bmp, thumb: URL.createObjectURL(f) });
          } catch (_) {}
        }
        if (st) { t0 = performance.now(); paintPanel(); }
      });
    }
    picker.click();
  }

  /* ---- dragging stickers on the preview ---- */
  const pts = new Map();
  let gesture = null;
  function toCanvas(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }
  function hit(pt) {
    for (let k = st.stickers.length - 1; k >= 0; k--) {
      const s = st.stickers[k], b = stickerBox(s);
      const dx = pt.x - b.x, dy = pt.y - b.y;
      const c = Math.cos(-s.r), sn = Math.sin(-s.r);
      const lx = dx * c - dy * sn, ly = dx * sn + dy * c;
      if (Math.abs(lx) <= b.w / 2 + 10 && Math.abs(ly) <= b.h / 2 + 10) return k;
    }
    return -1;
  }
  function select(k) {
    if (st.sel === k) return;
    st.sel = k;
    if (k >= 0 && tab !== 'stickers') tab = 'stickers';
    paintPanel();
  }

  function wire() {
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) { tab = t.getAttribute('data-tab'); if (tab !== 'stickers') st.sel = -1; paintPanel(); return; }
      if (e.target.closest('[data-add]')) { pickPhotos(); return; }
      const rm = e.target.closest('[data-rm]');
      if (rm) {
        const i = Number(rm.getAttribute('data-rm'));
        const ph = st.photos.splice(i, 1)[0];
        if (ph) { try { ph.bmp.close && ph.bmp.close(); } catch (_) {} URL.revokeObjectURL(ph.thumb); }
        t0 = performance.now(); paintPanel(); return;
      }
      const sy = e.target.closest('[data-style]');
      if (sy) { st.style = sy.getAttribute('data-style'); t0 = performance.now(); paintPanel(); return; }
      const sk = e.target.closest('[data-stk]');
      if (sk) {
        const n = sk.getAttribute('data-stk');
        const k = st.stickers.length;
        st.stickers.push({ n, img: stickerImg(n), x: 0.3 + ((k * 0.23) % 0.4), y: 0.62 + ((k * 0.09) % 0.2), s: 0.34, r: (k % 2 ? 0.12 : -0.12) });
        st.sel = st.stickers.length - 1;
        paintPanel(); return;
      }
      if (e.target.closest('[data-unstick]')) {
        if (st.sel >= 0) st.stickers.splice(st.sel, 1);
        st.sel = -1; paintPanel(); return;
      }
      if (e.target.closest('.lpm-go')) { make(); return; }
    });

    cv.addEventListener('pointerdown', (e) => {
      const pt = toCanvas(e);
      pts.set(e.pointerId, pt);
      try { cv.setPointerCapture(e.pointerId); } catch (_) {}
      if (pts.size === 1) {
        const k = hit(pt);
        select(k);
        gesture = k >= 0 ? { k, from: pt, x: st.stickers[k].x, y: st.stickers[k].y } : null;
      } else if (pts.size === 2 && st.sel >= 0) {
        const [a, b] = [...pts.values()];
        const s = st.stickers[st.sel];
        gesture = { k: st.sel, pinch: true, d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), s: s.s, r: s.r };
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, toCanvas(e));
      if (!gesture) return;
      const s = st.stickers[gesture.k];
      if (!s) return;
      if (gesture.pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        s.s = clamp(gesture.s * d / Math.max(1, gesture.d), 0.12, 0.9);
        s.r = gesture.r + (Math.atan2(b.y - a.y, b.x - a.x) - gesture.ang);
      } else if (!gesture.pinch) {
        const pt = pts.get(e.pointerId);
        s.x = clamp(gesture.x + (pt.x - gesture.from.x) / W, 0.02, 0.98);
        s.y = clamp(gesture.y + (pt.y - gesture.from.y) / H, 0.02, 0.98);
      }
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size === 0) gesture = null;
      else if (gesture && gesture.pinch) {
        const [pt] = [...pts.values()];
        const s = st.stickers[gesture.k];
        gesture = s ? { k: gesture.k, from: pt, x: s.x, y: s.y } : null;
      }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      if (st.sel < 0) return;
      e.preventDefault();
      const s = st.stickers[st.sel];
      if (e.shiftKey) s.r += e.deltaY * 0.003;
      else s.s = clamp(s.s * (e.deltaY < 0 ? 1.06 : 0.94), 0.12, 0.9);
    }, { passive: false });
  }

  /* ---------------- making the video ---------------- */
  async function make() {
    if (busy || !st.photos.length) return;
    busy = true;
    st.sel = -1;
    paintLen();
    const cover = document.createElement('div');
    cover.className = 'lpm-busy';
    cover.innerHTML = '<div>Making your Loop…<div class="bar"><i></i></div><div style="font-size:13px;font-weight:700;color:#94a3b8;margin-top:10px">Keep this screen open</div></div>';
    el.appendChild(cover);
    const bar = cover.querySelector('.bar i');
    const prog = (p) => { bar.style.width = Math.round(p * 100) + '%'; };
    let file = null;
    try { file = await encodeFast(prog); } catch (_) { file = null; }
    if (!file) { try { file = await encodeRealtime(prog); } catch (_) { file = null; } }
    busy = false;
    if (!file) {
      cover.innerHTML = '<div>😕 This phone could not make the video.<br><span style="font-size:14px;font-weight:700;color:#94a3b8">Try again, or record one with your camera.</span></div>';
      setTimeout(() => cover.remove(), 3500);
      paintLen();
      return;
    }
    const done = onDone;
    leave(() => { if (done) done(file); });
  }

  /* Faster than real time, through the phone's video chip (WebCodecs). */
  async function encodeFast(prog) {
    if (!('VideoEncoder' in window)) return null;
    const M = await import(MB_LIB);
    const D = duration();
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const c = canvas.getContext('2d');
    let codec = 'avc', format = new M.Mp4OutputFormat({ fastStart: 'in-memory' }), type = 'video/mp4', ext = 'mp4';
    const cfg = { width: W, height: H, bitrate: 4000000 };
    if (!(await M.canEncodeVideo('avc', cfg))) {
      if (!(await M.canEncodeVideo('vp9', cfg))) return null;
      codec = 'vp9'; format = new M.WebMOutputFormat(); type = 'video/webm'; ext = 'webm';
    }
    const output = new M.Output({ format, target: new M.BufferTarget() });
    const src = new M.CanvasSource(canvas, { codec, bitrate: 4000000 });
    output.addVideoTrack(src, { frameRate: FPS });
    await output.start();
    const frames = Math.round(D * FPS);
    for (let f = 0; f < frames; f++) {
      render(c, f / FPS, false);
      await src.add(f / FPS, 1 / FPS);
      if (f % 6 === 0) prog(f / frames);
    }
    await output.finalize();
    prog(1);
    const buf = output.target.buffer;
    if (!buf || buf.byteLength < 1000) return null;
    return new File([buf], 'loop.' + ext, { type });
  }

  /* Older phones: play it once on a hidden canvas and record it. */
  function encodeRealtime(prog) {
    return new Promise((ok) => {
      if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return ok(null);
      const D = duration();
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const c = canvas.getContext('2d');
      render(c, 0, false);
      const stream = canvas.captureStream(FPS);
      const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
        .find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch (_) { return false; } });
      if (!type) return ok(null);
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4000000 });
      const parts = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
      rec.onstop = () => {
        const base = type.split(';')[0];
        const blob = new Blob(parts, { type: base });
        ok(blob.size > 1000 ? new File([blob], 'loop.' + (base === 'video/mp4' ? 'mp4' : 'webm'), { type: base }) : null);
      };
      rec.start(250);
      const start = performance.now();
      const step = () => {
        const t = (performance.now() - start) / 1000;
        if (t >= D) { rec.stop(); prog(1); return; }
        render(c, t, false);
        prog(t / D);
        requestAnimationFrame(step);
      };
      step();
    });
  }

  window.InfinitePullsLoopMaker = { open };
})();
