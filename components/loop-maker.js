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
    { key: 'chill', name: 'Chill', icon: '🌙' },
    { key: 'retro', name: 'Retro VHS', icon: '📼' },
    { key: 'comic', name: 'Comic', icon: '💥' }
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
  /* THE TIMELINE. st.photos holds every clip -- photos AND videos (the name
     stuck from before videos). Photos only: 3 sec each, 6-15 sec in all.
     With a video in it: each video plays its own length, photos 3 sec,
     and the whole thing stops at 15. */
  function segs() {
    const m = st.photos;
    if (!m.length) return [];
    const out = [];
    if (m.every((x) => x.kind !== 'video')) {
      const D = Math.min(15, Math.max(6, m.length * 3)), L = D / m.length;
      m.forEach((x, i) => out.push({ m: x, start: i * L, len: L }));
      return out;
    }
    let acc = 0;
    for (const x of m) {
      const len = Math.min(x.kind === 'video' ? (x.dur || 15) : 3, 15 - acc);
      if (len < 0.3) break;
      out.push({ m: x, start: acc, len });
      acc += len;
    }
    return out;
  }
  const duration = () => {
    const S = segs();
    if (!S.length) return 6;
    const last = S[S.length - 1];
    return Math.max(1, last.start + last.len);
  };
  const hasVideo = () => st.photos.some((x) => x.kind === 'video');

  /* Videos play in step with the timeline: the one on screen runs, the rest
     wait. Muted in the preview; sound on only while the Loop is being made. */
  function syncVideos(S, k, local, preview) {
    S.forEach((sg, j) => {
      if (sg.m.kind !== 'video') return;
      const v = sg.m.el;
      if (j === k) {
        v.muted = !!preview;
        const want = Math.min(local, Math.max(0, (sg.m.dur || 15) - 0.05));
        if (v.paused) {
          try { v.currentTime = want; } catch (_) {}
          const pr = v.play(); if (pr && pr.catch) pr.catch(() => {});
        } else if (Math.abs(v.currentTime - want) > 0.35) {
          try { v.currentTime = want; } catch (_) {}
        }
      } else if (!v.paused) {
        v.pause();
      }
    });
  }
  const srcOf = (x) => x.kind === 'video' ? x.el : x.bmp;

  /* ---------------- drawing ---------------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const easeInOut = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;

  function drawCover(ctx, bmp, zoom, dx, dy, rot, alpha) {
    if (!bmp) return;
    const bw = bmp.videoWidth || bmp.width, bh = bmp.videoHeight || bmp.height;
    if (!bw || !bh) return;
    const s = Math.max(W / bw, H / bh) * zoom;
    const w = bw * s, h = bh * s;
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(W / 2 + dx, H / 2 + dy);
    if (rot) ctx.rotate(rot);
    ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /* where photo i sits at progress p (0..1) through its own slot */
  function kenBurns(i, p, style, isVideo) {
    if (isVideo) return { z: 1 + 0.03 * p, x: 0, y: 0 };   /* a video already moves */
    const dir = i % 2 ? -1 : 1;
    if (style === 'hype') return { z: 1.12 + 0.16 * p, x: dir * 30 * (p - 0.5), y: 0 };
    if (style === 'chill') return { z: 1.04 + 0.08 * p, x: dir * 18 * (p - 0.5), y: -10 * p };
    if (style === 'show') return { z: 1.08 + 0.1 * p, x: 0, y: dir * 24 * (p - 0.5) };
    return { z: 1.06 + 0.14 * p, x: dir * 22 * (p - 0.5), y: 0 };
  }

  function render(ctx, t, preview) {
    const style = st.style;
    const S = segs();
    const n = S.length;
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
      ctx.fillText('Record a video', W / 2, H / 2 - 34);
      ctx.fillText('or add photos', W / 2, H / 2 + 34);
    } else {
      let i = S.findIndex((sg) => t < sg.start + sg.len);
      if (i < 0) i = n - 1;
      const sg = S[i];
      const local = t - sg.start;
      const p = clamp(local / sg.len, 0, 1);
      const TR = style === 'chill' ? 0.7 : 0.45;
      if (hasVideo()) syncVideos(S, i, local, preview);
      const cur = srcOf(sg.m);
      const kb = kenBurns(i, p, style, sg.m.kind === 'video');

      /* shake at the start of every photo in Hype */
      let sx = 0, sy = 0;
      if (style === 'hype' && local < 0.35) {
        const a = (1 - local / 0.35) * 18;
        sx = Math.sin(t * 90) * a; sy = Math.cos(t * 70) * a;
      }

      if (i > 0 && local < TR) {
        const q = clamp(local / TR, 0, 1);
        const prev = srcOf(S[i - 1].m);
        const kp = kenBurns(i - 1, 1, style, S[i - 1].m.kind === 'video');
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
        } else if (style === 'retro') {
          /* the tape rolls: the old picture slides up and away, jittering */
          const e = easeInOut(q);
          const jit = Math.sin(t * 60) * 10 * (1 - q);
          drawCover(ctx, prev, kp.z, kp.x + jit, kp.y - e * H, 0, 1);
          drawCover(ctx, cur, kb.z, kb.x - jit, kb.y + (1 - e) * H, 0, 1);
        } else if (style === 'comic') {
          /* a slashing panel wipe with a thick black edge */
          drawCover(ctx, prev, kp.z, kp.x, kp.y, 0, 1);
          const e = easeInOut(q);
          const edge = -W * 0.6 + e * W * 2.2;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(edge, 0); ctx.lineTo(edge - W * 0.6, H); ctx.lineTo(-W, H); ctx.lineTo(-W, 0); ctx.closePath();
          ctx.clip();
          drawCover(ctx, cur, kb.z, kb.x, kb.y, 0, 1);
          ctx.restore();
          ctx.save();
          ctx.lineWidth = 16; ctx.strokeStyle = '#000';
          ctx.beginPath(); ctx.moveTo(edge, 0); ctx.lineTo(edge - W * 0.6, H); ctx.stroke();
          ctx.lineWidth = 6; ctx.strokeStyle = '#fff';
          ctx.beginPath(); ctx.moveTo(edge + 12, 0); ctx.lineTo(edge - W * 0.6 + 12, H); ctx.stroke();
          ctx.restore();
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
    /* Retro VHS: scanlines, a rolling tracking band, REC and the date */
    if (style === 'retro') {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.16)';
      for (let y = 0; y < H; y += 5) ctx.fillRect(0, y, W, 2);
      const band = ((t * 260) % (H + 200)) - 100;
      ctx.globalAlpha = 0.18;
      ctx.drawImage(ctx.canvas, 0, band, W, 60, 14, band, W, 60);
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(0, band, W, 60);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,40,80,.07)'; ctx.fillRect(0, 0, W, H);
      ctx.font = '700 38px "Courier New", ui-monospace, monospace';
      ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 4;
      if (Math.floor(t * 2) % 2 === 0) { ctx.fillStyle = '#ff2a2a'; ctx.beginPath(); ctx.arc(52, 70, 13, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = '#fff'; ctx.fillText('REC', 76, 52);
      ctx.fillText('PLAY ►', W - 200, 52);
      const d = new Date();
      const stamp = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase().replace(',', '');
      const secs = Math.floor(t);
      ctx.fillStyle = '#ffb347';
      ctx.fillText(stamp, 40, H - 150);
      ctx.fillText(`00:00:${String(secs).padStart(2, '0')}`, 40, H - 104);
      ctx.restore();
    }
    /* Comic: halftone dots, a thick frame, and a POW! at every cut */
    if (style === 'comic') {
      ctx.save();
      if (!halftone) {
        const c = document.createElement('canvas'); c.width = c.height = 16;
        const x = c.getContext('2d'); x.fillStyle = 'rgba(0,0,0,.22)';
        x.beginPath(); x.arc(8, 8, 3, 0, Math.PI * 2); x.fill();
        halftone = ctx.createPattern(c, 'repeat');
      }
      ctx.fillStyle = halftone; ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = 24; ctx.strokeStyle = '#000'; ctx.strokeRect(12, 12, W - 24, H - 24);
      ctx.lineWidth = 6; ctx.strokeStyle = '#fff'; ctx.strokeRect(27, 27, W - 54, H - 54);
      const S2 = segs();
      let ci = S2.findIndex((sg) => t < sg.start + sg.len); if (ci < 0) ci = S2.length - 1;
      const loc = S2.length ? t - S2[ci].start : 9;
      if (loc < 0.7 && (ci > 0 || t > 0.1)) {
        const words = ['POW!', 'BAM!', 'WOW!', 'ZAP!', 'BOOM!'];
        const k = clamp(loc / 0.25, 0, 1);
        const sc = easeOutBack(k) * (loc > 0.5 ? 1 - (loc - 0.5) / 0.2 : 1);
        if (sc > 0.02) {
          ctx.translate(W * (ci % 2 ? 0.7 : 0.3), H * 0.42);
          ctx.rotate(ci % 2 ? 0.18 : -0.18);
          ctx.scale(sc, sc);
          ctx.beginPath();
          for (let a = 0; a < 24; a++) {
            const rr = a % 2 ? 110 : 190;
            const an = a / 24 * Math.PI * 2;
            ctx.lineTo(Math.cos(an) * rr * 1.25, Math.sin(an) * rr);
          }
          ctx.closePath();
          ctx.fillStyle = '#ffe14d'; ctx.fill();
          ctx.lineWidth = 10; ctx.strokeStyle = '#000'; ctx.stroke();
          ctx.font = '900 92px Impact, "Arial Black", system-ui, sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.lineWidth = 12; ctx.strokeStyle = '#000'; ctx.strokeText(words[ci % words.length], 0, 0);
          ctx.fillStyle = '#e8202a'; ctx.fillText(words[ci % words.length], 0, 0);
        }
      }
      ctx.restore();
    }
    /* vignette */
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, style === 'chill' ? 'rgba(0,0,0,.55)' : 'rgba(0,0,0,.4)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    drawText(ctx, t, preview);
    drawStickers(ctx, t, preview);

    /* the mark, small, so a Loop shared elsewhere says where it came from */
    ctx.save();
    ctx.font = '900 26px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillText('∞ INFINITE PULLS', W - 26, H - 38);
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillText('∞ INFINITE PULLS', W - 28, H - 40);
    ctx.restore();
  }

  function fitFont(ctx, text, max, weight, family) {
    const fam = family || 'system-ui, -apple-system, "Segoe UI", sans-serif';
    let size = max;
    ctx.font = `${weight} ${size}px ${fam}`;
    while (size > 40 && ctx.measureText(text).width > W - 90) {
      size -= 4;
      ctx.font = `${weight} ${size}px ${fam}`;
    }
    return size;
  }

  function drawText(ctx, t, preview) {
    const text = (st.text || '').trim();
    if (!text) { st.tbox = null; return; }
    const style = st.style;
    const tp = st.tp;
    const live = preview && st.sel === 'text';
    ctx.save();
    let up = text.toUpperCase();
    const font = style === 'retro' ? '"Courier New", ui-monospace, monospace'
      : style === 'comic' ? 'Impact, "Arial Black", system-ui, sans-serif' : null;
    const size = fitFont(ctx, up, 118, style === 'retro' ? 700 : 900, font);
    st.tbox = { w: ctx.measureText(up).width + 30, h: size * 1.2 };
    let sc = 1, a = 1, dy = 0;
    const k = clamp((t - 0.15) / 0.5, 0, 1);
    if (!live) {
      if (style === 'chill') { a = k; dy = (1 - k) * 30 + Math.sin(t * 1.2) * 6; }
      else if (style === 'retro') {
        /* typed out, a letter at a time */
        const n = Math.floor(clamp((t - 0.2) / 1.2, 0, 1) * up.length);
        up = up.slice(0, n) + (n < up.length && Math.floor(t * 4) % 2 ? '█' : '');
        dy = (Math.floor(t * 12) % 3 - 1) * 2;
      } else { sc = k ? easeOutBack(k) : 0; dy = Math.sin(t * (style === 'hype' ? 6 : 3)) * (style === 'hype' ? 6 : 8); }
    }
    if (sc <= 0.01 || a <= 0.01 || !up) { ctx.restore(); return; }
    ctx.translate(tp.x * W, tp.y * H + dy);
    ctx.rotate(tp.r + (style === 'comic' ? -0.06 : 0) + (!live && style === 'hype' ? Math.sin(t * 8) * 0.03 : 0));
    ctx.scale(sc * tp.s, sc * tp.s);
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
    } else if (style === 'retro') {
      ctx.fillStyle = 'rgba(255,0,60,.7)'; ctx.fillText(up, -4, 0);
      ctx.fillStyle = 'rgba(0,160,255,.7)'; ctx.fillText(up, 4, 0);
      ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 6;
      ctx.fillStyle = '#fff'; ctx.fillText(up, 0, 0);
    } else if (style === 'comic') {
      ctx.lineWidth = size * 0.22; ctx.strokeStyle = '#000'; ctx.strokeText(up, 6, 8);
      ctx.fillStyle = '#000'; ctx.fillText(up, 6, 8);
      ctx.lineWidth = size * 0.18; ctx.strokeStyle = '#000'; ctx.strokeText(up, 0, 0);
      ctx.fillStyle = '#ffe14d'; ctx.fillText(up, 0, 0);
    } else {
      ctx.lineWidth = size * 0.16; ctx.strokeStyle = '#1b1400'; ctx.strokeText(up, 0, 0);
      const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
      g.addColorStop(0, '#fff3b0'); g.addColorStop(0.5, '#ffd23f'); g.addColorStop(1, '#ff9a1f');
      ctx.fillStyle = g; ctx.fillText(up, 0, 0);
    }
    if (live) {
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      ctx.setLineDash([14, 10]); ctx.lineWidth = 4 / Math.max(0.4, tp.s); ctx.strokeStyle = '#ffc13d';
      ctx.strokeRect(-st.tbox.w / 2, -st.tbox.h / 2, st.tbox.w, st.tbox.h);
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
        else if (st.style === 'retro') { dy = (Math.floor(tt * 12) % 3 - 1) * 3; rot += (Math.floor(tt * 6) % 2 ? 0.02 : -0.02); }
        else if (st.style === 'comic') { const q = Math.abs(Math.sin(tt * 3)); sc *= 1 + q * 0.07; rot += Math.sin(tt * 3) * 0.08; }
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
.lpm-th img,.lpm-th video{width:100%;height:100%;object-fit:cover;pointer-events:none}
.lpm-dur{position:absolute;left:4px;bottom:4px;padding:2px 6px;border-radius:999px;background:rgba(0,0,0,.7);font:800 11px/1.3 system-ui,sans-serif}
.lpm-add.lpm-rec{border-color:#ff4f93;color:#ff7fb0}
.lpm-th b{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,.7);color:#fff;font:900 13px/22px system-ui;text-align:center}
.lpm-add{flex:none;width:72px;height:110px;border-radius:10px;border:2px dashed #ffc13d;background:none;color:#ffc13d;font:900 13px/1.2 system-ui,sans-serif;cursor:pointer}
.lpm-add i{display:block;font-style:normal;font-size:28px;margin-bottom:4px}
.lpm-styles{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.lpm-hint b{color:#e2e8f0}
.lpm-styles button{border:2px solid transparent;border-radius:12px;padding:12px 8px;background:#0f172a;color:#fff;font:900 15px/1 system-ui,sans-serif;cursor:pointer}
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

  let halftone = null;
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

  function dropClip(x) {
    try {
      if (x.kind === 'video') { x.el.pause(); x.el.removeAttribute('src'); x.el.load(); x.el.remove(); }
      else if (x.bmp && x.bmp.close) x.bmp.close();
    } catch (_) {}
    if (x.url) URL.revokeObjectURL(x.url);
  }

  function close() {
    window.removeEventListener('resize', fit);
    cancelAnimationFrame(raf); raf = 0;
    if (el) { el.remove(); el = null; }
    if (st) st.photos.forEach(dropClip);
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
    st = { photos: [], style: 'pullday', text: '', tp: { x: 0.5, y: 0.2, s: 1, r: 0 }, tbox: null, stickers: [], sel: -1 };
    tab = 'photos';
    el = document.createElement('div');
    el.className = 'lpm';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Make a Loop');
    el.innerHTML = `
      <div class="lpm-stage"><canvas width="${W}" height="${H}" aria-label="Preview"></canvas></div>
      <span class="lpm-len"></span>
      <nav class="lpm-tabs">
        <button type="button" data-tab="photos" class="on">🎬 Clips</button>
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
    restartPreview();
  }

  function restartPreview() {
    cancelAnimationFrame(raf);
    t0 = performance.now();
    const loop = () => {
      if (!el || !st) return;
      const D = duration();
      render(ctx, ((performance.now() - t0) / 1000) % D, true);
      raf = requestAnimationFrame(loop);
    };
    loop();
  }

  function paintLen() {
    const l = el && el.querySelector('.lpm-len');
    if (l) l.textContent = `${Math.round(duration())} sec`;
    const go = el && el.querySelector('.lpm-go');
    if (go) go.disabled = !st.photos.length || busy;
  }

  function paintPanel() {
    if (!el) return;
    el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.getAttribute('data-tab') === tab));
    const p = el.querySelector('.lpm-panel');
    if (tab === 'photos') {
      const room = st.photos.length < MAX_PHOTOS && duration() < 14.7;
      p.innerHTML = `<div class="lpm-thumbs">
        ${room ? `<button type="button" class="lpm-add lpm-rec" data-rec><i>🎥</i>Record</button>
                  <button type="button" class="lpm-add" data-add><i>+</i>From my phone</button>` : ''}
        ${st.photos.map((x, i) => `<button type="button" class="lpm-th" data-rm="${i}" aria-label="Take it out">${x.kind === 'video'
          ? `<video src="${x.url}#t=0.1" muted playsinline preload="metadata"></video><span class="lpm-dur">🎥 ${Math.round(Math.min(15, x.dur || 0))}s</span>`
          : `<img src="${x.url}" alt="">`}<b>✕</b></button>`).join('')}
      </div><p class="lpm-hint">${st.photos.length
        ? 'Plays in this order: videos their own length, photos 3 sec, 15 sec max. Tap one to take it out.'
        : 'Record right now, or pick videos and photos from your phone. Up to 15 seconds.'}</p>`;
    } else if (tab === 'style') {
      p.innerHTML = `<div class="lpm-styles">${STYLES.map((s) =>
        `<button type="button" data-style="${s.key}" class="${st.style === s.key ? 'on' : ''}">${s.icon} ${esc(s.name)}</button>`).join('')}</div>`;
    } else if (tab === 'text') {
      p.innerHTML = `<div class="lpm-text"><input type="text" maxlength="40" placeholder="Big text on your Loop (optional)" value="${esc(st.text)}" enterkeyhint="done"></div>
        <p class="lpm-hint">Short and loud works best: "PULL DAY", "LOOK AT THIS". <b>Drag the words on the picture to move them; pinch to size and turn.</b></p>`;
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

  let recorder = null;
  function pickClips(record) {
    let inp = record ? recorder : picker;
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file';
      inp.style.display = 'none';
      if (record) { inp.accept = 'video/*'; inp.setAttribute('capture', 'environment'); recorder = inp; }
      else { inp.accept = 'image/*,video/*'; inp.multiple = true; picker = inp; }
      document.body.appendChild(inp);
      inp.addEventListener('change', async () => {
        const files = [...(inp.files || [])].slice(0, MAX_PHOTOS - (st ? st.photos.length : 0));
        inp.value = '';
        for (const f of files) {
          try {
            const clip = /^video\//.test(f.type) || /\.(mov|mp4|webm|m4v)$/i.test(f.name) ? await videoClip(f) : await photoClip(f);
            if (!st) { dropClip(clip); return; }
            if (clip) st.photos.push(clip);
          } catch (_) {}
        }
        if (st) { t0 = performance.now(); paintPanel(); }
      });
    }
    inp.click();
  }

  async function photoClip(f) {
    let bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const big = Math.max(bmp.width, bmp.height);
    if (big > 1600) {
      const k = 1600 / big;
      const small = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' });
      bmp.close && bmp.close(); bmp = small;
    }
    return { kind: 'photo', bmp, url: URL.createObjectURL(f), file: f };
  }

  async function videoClip(f) {
    const url = URL.createObjectURL(f);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto';
    v.src = url;
    /* kept in the page (out of sight): some phones will not draw a video
       that is not in the page */
    v.style.cssText = 'position:fixed;left:-2px;top:-2px;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(v);
    await new Promise((ok) => { v.onloadedmetadata = ok; v.onerror = ok; setTimeout(ok, 8000); });
    if (!v.videoWidth) { v.remove(); URL.revokeObjectURL(url); return null; }
    const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : 15;
    return { kind: 'video', el: v, url, dur, file: f };
  }

  /* ---- dragging stickers on the preview ---- */
  const pts = new Map();
  let gesture = null;
  function toCanvas(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }
  /* what a finger can grab: a sticker (its number) or the words ('text') */
  const target = (k) => k === 'text' ? st.tp : st.stickers[k];
  const sizeRange = (k) => k === 'text' ? [0.35, 2.6] : [0.12, 0.9];
  function hit(pt) {
    const inBox = (cx, cy, w, h, r) => {
      const dx = pt.x - cx, dy = pt.y - cy;
      const c = Math.cos(-r), sn = Math.sin(-r);
      const lx = dx * c - dy * sn, ly = dx * sn + dy * c;
      return Math.abs(lx) <= w / 2 + 10 && Math.abs(ly) <= h / 2 + 10;
    };
    for (let k = st.stickers.length - 1; k >= 0; k--) {
      const s = st.stickers[k], b = stickerBox(s);
      if (inBox(b.x, b.y, b.w, b.h, s.r)) return k;
    }
    if (st.tbox && (st.text || '').trim()) {
      const tp = st.tp;
      if (inBox(tp.x * W, tp.y * H, st.tbox.w * tp.s, st.tbox.h * tp.s, tp.r)) return 'text';
    }
    return -1;
  }
  function select(k) {
    if (st.sel === k) return;
    st.sel = k;
    if (k === 'text') tab = 'text';
    else if (k >= 0 && tab !== 'stickers') tab = 'stickers';
    paintPanel();
  }

  function wire() {
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) { tab = t.getAttribute('data-tab'); if (tab !== 'stickers' && st.sel !== 'text') st.sel = -1; if (tab !== 'text' && st.sel === 'text') st.sel = -1; paintPanel(); return; }
      if (e.target.closest('[data-add]')) { pickClips(false); return; }
      if (e.target.closest('[data-rec]')) { openCamera(); return; }
      const rm = e.target.closest('[data-rm]');
      if (rm) {
        const i = Number(rm.getAttribute('data-rm'));
        const ph = st.photos.splice(i, 1)[0];
        if (ph) dropClip(ph);
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
        if (typeof st.sel === 'number' && st.sel >= 0) st.stickers.splice(st.sel, 1);
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
        const o = k === -1 ? null : target(k);
        gesture = o ? { k, from: pt, x: o.x, y: o.y } : null;
      } else if (pts.size === 2 && st.sel !== -1 && target(st.sel)) {
        const [a, b] = [...pts.values()];
        const s = target(st.sel);
        gesture = { k: st.sel, pinch: true, d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), s: s.s, r: s.r };
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, toCanvas(e));
      if (!gesture) return;
      const s = target(gesture.k);
      if (!s) return;
      if (gesture.pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        const [lo, hi] = sizeRange(gesture.k);
        s.s = clamp(gesture.s * d / Math.max(1, gesture.d), lo, hi);
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
        const s = target(gesture.k);
        gesture = s ? { k: gesture.k, from: pt, x: s.x, y: s.y } : null;
      }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      const s = st.sel === -1 ? null : target(st.sel);
      if (!s) return;
      e.preventDefault();
      const [lo, hi] = sizeRange(st.sel);
      if (e.shiftKey) s.r += e.deltaY * 0.003;
      else s.s = clamp(s.s * (e.deltaY < 0 ? 1.06 : 0.94), lo, hi);
    }, { passive: false });
  }

  /* ---------------- making the video ---------------- */
  async function make() {
    if (busy || !st.photos.length) return;
    const S = segs();
    /* EVERY Loop is made here -- even one video with nothing added -- so
       every Loop carries the ∞ INFINITE PULLS mark, wherever it is shared
       (Mike, 27 Sep). */
    const withSound = hasVideo();
    if (withSound) audioReady();          /* inside the tap, or phones keep it silent */
    busy = true;
    st.sel = -1;
    cancelAnimationFrame(raf); raf = 0;   /* the preview stops driving the videos */
    paintLen();
    const cover = document.createElement('div');
    cover.className = 'lpm-busy';
    cover.innerHTML = '<div>Making your Loop…<div class="bar"><i></i></div><div style="font-size:13px;font-weight:700;color:#94a3b8;margin-top:10px">Keep this screen open</div></div>';
    el.appendChild(cover);
    const bar = cover.querySelector('.bar i');
    const prog = (p) => { bar.style.width = Math.round(p * 100) + '%'; };
    let file = null;
    if (!withSound) { try { file = await encodeFast(prog); } catch (_) { file = null; } }
    if (!file) { try { file = await encodeRealtime(prog, withSound); } catch (_) { file = null; } }
    busy = false;
    st.photos.forEach((x) => { if (x.kind === 'video') { try { x.el.pause(); x.el.muted = true; } catch (_) {} } });
    if (!file) {
      cover.innerHTML = '<div>😕 This phone could not make the video.<br><span style="font-size:14px;font-weight:700;color:#94a3b8">Try again, or record one with your camera.</span></div>';
      setTimeout(() => cover.remove(), 3500);
      paintLen();
      restartPreview();
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

  /* The videos' sound, routed into the recording (and not the speaker). */
  let actx = null, adest = null;
  function audioReady() {
    try {
      if (!actx) {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        adest = actx.createMediaStreamDestination();
      }
      if (actx.state === 'suspended') actx.resume();
      st.photos.forEach((x) => {
        if (x.kind !== 'video' || x.node) return;
        x.node = actx.createMediaElementSource(x.el);
        x.node.connect(adest);
      });
    } catch (_) {}
  }

  /* Plays it once on a hidden canvas and records it -- for anything with a
     video in it (the video's own sound comes along), and for older phones. */
  function encodeRealtime(prog, withSound) {
    return new Promise((ok) => {
      if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return ok(null);
      const D = duration();
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const c = canvas.getContext('2d');
      render(c, 0, false);
      const stream = canvas.captureStream(FPS);
      if (withSound && adest) adest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      const type = (withSound
        ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        : ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'])
        .find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch (_) { return false; } });
      if (!type) return ok(null);
      /* start every video from the top */
      st.photos.forEach((x) => { if (x.kind === 'video') { try { x.el.pause(); x.el.currentTime = 0; } catch (_) {} } });
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 5000000, audioBitsPerSecond: 128000 });
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

  /* ======================================================================
     OUR OWN CAMERA (27 Sep, Mike: "it kept recording" -- the phone's camera
     app cannot be told to stop). Full screen, flip front/back, one big
     button: tap to record, tap to stop, and it STOPS BY ITSELF at the time
     left (15 sec, less if there are clips already). The ring fills as it
     goes. The clip drops straight into the maker. Phone back button closes
     it. A phone that says no to the camera gets its own camera app instead.
     ====================================================================== */
  let cam = null;     /* { el, stream, rec, facing, t0, max, raf, parts } */

  /* ---- VOICE CHANGER (27 Sep, Mike) -- the mic goes through Web Audio on
     its way into the recording. Pitch voices use a small pitch shifter
     (two sliding read heads, cross-faded) that runs on the phone. You hear
     it when the Loop plays back; nothing plays out loud while recording,
     so there is no feedback squeal. ---- */
  const VOICES = [
    { key: 'normal', icon: '🙂', name: 'Normal' },
    { key: 'chipmunk', icon: '🐿', name: 'Chipmunk' },
    { key: 'deep', icon: '👹', name: 'Deep' },
    { key: 'robot', icon: '🤖', name: 'Robot' },
    { key: 'echo', icon: '📢', name: 'Echo' },
    { key: 'announcer', icon: '📣', name: 'Announcer' },
    { key: 'alien', icon: '👽', name: 'Alien' }
  ];
  let voiceKey = 'normal';
  let va = null;      /* { ctx, dest, src, nodes:[], worklet } */
  const SHIFTER = `
class PitchShift extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'pitch', defaultValue: 1 }]; }
  constructor() { super(); this.L = Math.floor(sampleRate * 0.07); this.buf = new Float32Array(this.L * 4); this.w = 0; this.ph = 0; }
  read(pos) { const N = this.buf.length; pos = ((pos % N) + N) % N; const i = Math.floor(pos), f = pos - i; return this.buf[i] * (1 - f) + this.buf[(i + 1) % N] * f; }
  process(inputs, outputs, params) {
    const inp = inputs[0] && inputs[0][0], out = outputs[0];
    if (!inp) return true;
    const pitch = params.pitch[0], L = this.L, N = this.buf.length;
    for (let i = 0; i < inp.length; i++) {
      this.buf[this.w] = inp[i];
      this.ph += (1 - pitch) / L;
      if (this.ph >= 1) this.ph -= 1; else if (this.ph < 0) this.ph += 1;
      const p2 = (this.ph + 0.5) % 1;
      const v = this.read(this.w - this.ph * L) * (1 - Math.abs(2 * this.ph - 1)) + this.read(this.w - p2 * L) * (1 - Math.abs(2 * p2 - 1));
      for (let c = 0; c < out.length; c++) out[c][i] = v;
      this.w = (this.w + 1) % N;
    }
    return true;
  }
}
registerProcessor('ip-pitch-shift', PitchShift);`;

  /* ======================================================================
     LENSES (27 Sep) -- Snapchat-style props that follow your face. Each
     CHARACTER is a voice + a lens. Google's MediaPipe Face Landmarker (free,
     runs on the phone) finds 478 points on the face every frame; each prop
     is pinned to its spot, sized to the face and turned with the head.
     Art: /assets/loops/lenses/<file>.png from Mike's ChatGPT pack. Until a
     file exists, a sticker stands in so the tracking can be tried now.
     ====================================================================== */
  const CW = 720, CH = 1280;
  const MP_VER = '1.0.1';
  const MP_LIB = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`;
  const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`;
  const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  const LENS_BASE = '/assets/loops/lenses/';
  const CHARACTERS = [
    { key: 'normal', icon: '🙂', name: 'Normal', voice: 'normal', lens: null },
    { key: 'collector', icon: '😎', name: 'The Collector', voice: 'normal', lens: 'collector' },
    { key: 'zappy', icon: '⚡', name: 'Zappy', voice: 'chipmunk', lens: 'zappy' },
    { key: 'voidboss', icon: '🔮', name: 'Void Boss', voice: 'deep', lens: 'voidboss' },
    { key: 'boltbot', icon: '🤖', name: 'Bolt-Bot', voice: 'robot', lens: 'boltbot' },
    { key: 'crystal', icon: '💎', name: 'Crystal Cave', voice: 'echo', lens: 'crystal' },
    { key: 'mc', icon: '🎤', name: 'Card Show MC', voice: 'announcer', lens: 'mc' },
    { key: 'invader', icon: '👽', name: 'Pack Invader', voice: 'alien', lens: 'invader' }
  ];
  /* w = width as a share of face width; dy = shift up (+) / down (-) in face
     widths from the anchor; n = copies (floaters); fx = little animation */
  /* head pieces SIT on the forehead line (sink = how much of the piece
     comes down over the forehead); neck pieces HANG from the chin (sink =
     how much tucks up under it). w = width in face widths. */
  const LENSES = {
    collector: [
      { f: 'head-collector-grail-crown', at: 'head', w: 0.95, sink: 0.15 },
      { f: 'eyes-collector-holoshades', at: 'eyes', w: 1.1 },
      { f: 'mouth-collector-mustache', at: 'mouth', w: 0.6, dy: 0.09 },
      { f: 'neck-collector-chain', at: 'neck', w: 0.75, sink: 0.05 }
    ],
    zappy: [
      { f: 'head-zappy-antennae', at: 'head', w: 1.3, sink: 0.08, fx: 'boing' },
      { f: 'cheeks-zappy-sparks', at: 'cheeks', w: 1.15, fx: 'flicker' },
      { f: 'mouth-zappy-teeth', at: 'mouth', w: 0.5, dy: -0.02 },
      { f: 'float-zappy-bolt', at: 'float', w: 0.18, n: 3, fx: 'spin' }
    ],
    voidboss: [
      { f: 'head-voidboss-crown', at: 'head', w: 1.15, sink: -0.12, fx: 'hover' },
      { f: 'eyes-voidboss-glow', at: 'eyes', w: 1.05, dy: 0.08, fx: 'pulse' },
      { f: 'neck-voidboss-collar', at: 'neck', w: 1.35, sink: 0.35 },
      { f: 'float-voidboss-orb', at: 'float', w: 0.22, n: 2, fx: 'spin' }
    ],
    boltbot: [
      { f: 'head-boltbot-antenna', alt: 'head-boltbot-antenna-lit', at: 'head', w: 1.1, sink: 0.25, fx: 'blink' },
      { f: 'head-boltbot-cardslot', at: 'forehead', w: 0.5 },
      { f: 'eyes-boltbot-visor', at: 'eyes', w: 1.18 },
      { f: 'mouth-boltbot-grill', at: 'mouth', w: 0.55 }
    ],
    crystal: [
      { f: 'head-crystal-helmet', at: 'head', w: 1.35, sink: 0.42 },
      { f: 'cheeks-crystal-gems', at: 'cheeks', w: 1.0, fx: 'flicker' },
      { f: 'float-crystal-bat', at: 'float', w: 0.3, n: 2, fx: 'flap' },
      { f: 'float-crystal-sparkle', at: 'float', w: 0.12, n: 3, fx: 'spin', r: 0.62 }
    ],
    mc: [
      { f: 'head-mc-hair', at: 'head', w: 1.35, sink: 0.45 },
      { f: 'mouth-mc-headset', at: 'mouth', w: 0.8, dx: 0.32, dy: 0.22 },
      { f: 'neck-mc-collar', at: 'neck', w: 1.55, sink: -0.15, dy: -0.12 },
      { f: 'neck-mc-bowtie', at: 'neck', w: 0.42, sink: 0.5, dy: -0.38, fx: 'hover' }
    ],
    invader: [
      { f: 'face-invader-paint', at: 'face', w: 1.05, alpha: 0.85 },
      { f: 'eyes-invader-bugeyes', at: 'eyes', w: 1.05 },
      { f: 'head-invader-antennae', at: 'head', w: 1.0, sink: 0.05, fx: 'boing' },
      { f: 'float-invader-ufo', at: 'above', w: 0.45, dy: 0.95, fx: 'hover' }
    ]
  };
  /* stand-ins until the real art is in */
  const STAND_IN = { head: 'hit', forehead: 'infinite-pulls', eyes: 'omg', mouth: 'w', cheeks: 'fire', neck: 'grail', float: '10-10', face: 'no-way', above: 'god-pack' };
  let charKey = 'normal', lensKey = null, landmarker = null, lmLoading = null;
  const lensImgs = new Map();
  function lensImg(name, at) {
    if (lensImgs.has(name)) return lensImgs.get(name);
    const im = new Image();
    im.onerror = () => { if (!im.dataset.fb) { im.dataset.fb = '1'; im.src = STICKER_URL(STAND_IN[at] || 'omg'); } };
    im.src = LENS_BASE + name + '.webp';
    lensImgs.set(name, im);
    return im;
  }
  function ensureLandmarker() {
    if (landmarker) return Promise.resolve(landmarker);
    if (!lmLoading) lmLoading = (async () => {
      const M = await import(MP_LIB);
      const files = await M.FilesetResolver.forVisionTasks(MP_WASM);
      const opts = (delegate) => ({ baseOptions: { modelAssetPath: MP_MODEL, delegate }, runningMode: 'VIDEO', numFaces: 1 });
      try { landmarker = await M.FaceLandmarker.createFromOptions(files, opts('GPU')); }
      catch (_) { landmarker = await M.FaceLandmarker.createFromOptions(files, opts('CPU')); }
      return landmarker;
    })().catch((e) => { lmLoading = null; throw e; });
    return lmLoading;
  }
  const canvasOn = () => !!(lensKey || glowOn);
  async function lensSet(key) {
    if (!cam) return;
    lensKey = key || null;
    cancelAnimationFrame(cam.lraf);
    cam.el.classList.toggle('lens', canvasOn());
    if (!canvasOn()) return;
    if (lensKey) (LENSES[lensKey] || []).forEach((pc) => { lensImg(pc.f, pc.at); if (pc.alt) lensImg(pc.alt, pc.at); });
    const say = cam.el.querySelector('.lpc-say');
    /* the glow shows straight away; the face tracker catches up */
    smooth = null;
    lensLoop();
    if (!landmarker && lensKey && say) say.textContent = 'Loading the lens…';
    try { await ensureLandmarker(); }
    catch (_) {
      if (lensKey && say) say.textContent = 'Lenses need a newer phone — the voice still works';
      lensKey = null;
      if (cam) cam.el.classList.toggle('lens', canvasOn());
      return;
    }
    if (!cam || lensKey !== (key || null)) return;
    if (say) say.textContent = `Tap to record · stops by itself at ${Math.floor(camLeft())} sec`;
  }

  let smooth = null;       /* the face points, eased so props do not jitter */
  function lensLoop() {
    if (!cam || !canvasOn()) return;
    const v = cam.el.querySelector('video');
    const c = cam.cx;
    if (v.readyState >= 2 && v.videoWidth) {
      const vw = v.videoWidth, vh = v.videoHeight;
      const sc = Math.max(CW / vw, CH / vh), dw = vw * sc, dh = vh * sc;
      const ox = (CW - dw) / 2, oy = (CH - dh) / 2;
      const mirror = cam.facing === 'user';
      c.save();
      if (mirror) { c.translate(CW, 0); c.scale(-1, 1); }
      if (glowOn) c.filter = 'brightness(1.07) contrast(1.05) saturate(1.14)';
      c.drawImage(v, ox, oy, dw, dh);
      c.filter = 'none';
      c.restore();
      let face = null;
      if (landmarker) {
        try { const r = landmarker.detectForVideo(v, performance.now()); face = r && r.faceLandmarks && r.faceLandmarks[0]; } catch (_) {}
      }
      if (glowOn) glowUp(c, face, ox, oy, dw, dh, mirror);
      if (face && lensKey) {
        const P = (i) => {
          const q = face[i];
          let x = ox + q.x * dw;
          const y = oy + q.y * dh;
          if (mirror) x = CW - x;
          return { x, y };
        };
        const want = [10, 152, 33, 263, 234, 454, 13, 14, 1, 205, 425];
        const now = {};
        want.forEach((i) => { now[i] = P(i); });
        if (!smooth) smooth = now;
        else want.forEach((i) => { smooth[i].x += (now[i].x - smooth[i].x) * 0.55; smooth[i].y += (now[i].y - smooth[i].y) * 0.55; });
        drawLens(c, smooth, performance.now() / 1000);
      } else smooth = null;
    }
    cam.lraf = requestAnimationFrame(lensLoop);
  }

  /* ======================================================================
     ✨ GLOW (27 Sep, Mike: "silly and hot"). The flattering look people
     share: a little brighter and warmer, richer color, SOFT SKIN (the face
     only -- a blurred copy of the face laid over itself, so skin evens out
     but eyes and edges stay sharp enough), a soft dreamy bloom, and a gentle
     vignette. On by default; the ✨ button turns it off.
     ====================================================================== */
  let glowOn = true;
  try { glowOn = localStorage.getItem('ip-loop-glow') !== 'off'; } catch (_) {}
  const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
    148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
  let small = null, smallCx = null;
  function glowUp(c, face, ox, oy, dw, dh, mirror) {
    if (!small) {
      small = document.createElement('canvas'); small.width = CW / 2; small.height = CH / 2;
      smallCx = small.getContext('2d');
    }
    /* a soft copy of the frame */
    smallCx.filter = 'blur(4px)';
    smallCx.drawImage(c.canvas, 0, 0, small.width, small.height);
    smallCx.filter = 'none';
    /* SOFT SKIN: the soft copy, only inside the face */
    if (face) {
      c.save();
      c.beginPath();
      FACE_OVAL.forEach((i, k) => {
        const q = face[i];
        let x = ox + q.x * dw; const y = oy + q.y * dh;
        if (mirror) x = CW - x;
        if (k) c.lineTo(x, y); else c.moveTo(x, y);
      });
      c.closePath();
      c.clip();
      c.globalAlpha = 0.38;
      c.drawImage(small, 0, 0, CW, CH);
      c.restore();
    }
    /* a soft bloom over everything */
    c.save();
    c.globalCompositeOperation = 'screen';
    c.globalAlpha = 0.12;
    c.drawImage(small, 0, 0, CW, CH);
    c.restore();
    /* warm, golden-hour light and a gentle vignette */
    c.save();
    c.globalCompositeOperation = 'soft-light';
    const warm = c.createRadialGradient(CW / 2, CH * 0.4, 40, CW / 2, CH * 0.4, CH * 0.7);
    warm.addColorStop(0, 'rgba(255,214,170,0.55)');
    warm.addColorStop(1, 'rgba(255,170,120,0)');
    c.fillStyle = warm; c.fillRect(0, 0, CW, CH);
    c.globalCompositeOperation = 'source-over';
    const vg = c.createRadialGradient(CW / 2, CH / 2, CH * 0.35, CW / 2, CH / 2, CH * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.28)');
    c.fillStyle = vg; c.fillRect(0, 0, CW, CH);
    c.restore();
  }

  function drawLens(c, S, t) {
    const pieces = LENSES[lensKey];
    if (!pieces) return;
    let a = S[33], b = S[263];
    if (b.x < a.x) { const tmp = a; a = b; b = tmp; }
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const fw = Math.hypot(S[454].x - S[234].x, S[454].y - S[234].y);
    const up = { x: Math.sin(ang), y: -Math.cos(ang) };
    const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    const anchors = {
      head: S[10], forehead: { x: S[10].x - up.x * fw * 0.12, y: S[10].y - up.y * fw * 0.12 },
      eyes: mid(S[33], S[263]), mouth: mid(S[13], S[14]), cheeks: { x: S[1].x - up.x * fw * 0.08, y: S[1].y - up.y * fw * 0.08 },
      neck: S[152], face: mid(S[10], S[152]), above: S[10]
    };
    pieces.forEach((pc, k) => {
      let im = lensImg(pc.f, pc.at);
      if (pc.fx === 'blink' && pc.alt && Math.floor(t * 2) % 2) im = lensImg(pc.alt, pc.at);
      if (!im.complete || !im.naturalWidth) return;
      const n = pc.n || 1;
      for (let j = 0; j < n; j++) {
        let w = pc.w * fw;
        const h = w * im.naturalHeight / im.naturalWidth;
        let x, y, rot = ang, sy = 1;
        if (pc.at === 'float') {
          const ctr = anchors.face;
          const r = (pc.r || 0.85) * fw;
          const th = t * 1.6 + j * Math.PI * 2 / n + k;
          x = ctr.x + Math.cos(th) * r;
          y = ctr.y + Math.sin(th) * r * 0.75;
          rot = 0;
        } else {
          const base = anchors[pc.at] || anchors.face;
          let off = (pc.dy || 0) * fw;
          if (pc.at === 'head') off += h * (0.5 - (pc.sink == null ? 0.25 : pc.sink));
          if (pc.at === 'neck') off -= h * (0.5 - (pc.sink == null ? 0.1 : pc.sink));
          const side = (pc.dx || 0) * fw;      /* sideways, along the eye line */
          x = base.x + up.x * off + Math.cos(ang) * side;
          y = base.y + up.y * off + Math.sin(ang) * side;
        }
        if (pc.fx === 'hover') { x += up.x * Math.sin(t * 2.4) * fw * 0.03; y += up.y * Math.sin(t * 2.4) * fw * 0.03; }
        if (pc.fx === 'boing') sy = 1 + Math.sin(t * 7) * 0.06;
        if (pc.fx === 'spin') rot += t * 2.5 + j;
        if (pc.fx === 'flap') sy = 0.55 + Math.abs(Math.sin(t * 9 + j)) * 0.45;
        if (pc.fx === 'pulse') w *= 1 + Math.sin(t * 5) * 0.04;
        c.save();
        c.globalAlpha = (pc.alpha || 1) * (pc.fx === 'flicker' ? 0.75 + Math.random() * 0.25 : 1);
        c.translate(x, y); c.rotate(rot); c.scale(1, sy);
        c.drawImage(im, -w / 2, -(w * im.naturalHeight / im.naturalWidth) / 2, w, h * (w / (pc.w * fw)));
        c.restore();
      }
    });
  }

  function voiceStart() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      va = { ctx: new Ctx(), dest: null, src: null, nodes: [], worklet: null };
      va.dest = va.ctx.createMediaStreamDestination();
      if (va.ctx.state === 'suspended') va.ctx.resume();
      if (va.ctx.audioWorklet) {
        const url = URL.createObjectURL(new Blob([SHIFTER], { type: 'application/javascript' }));
        va.worklet = va.ctx.audioWorklet.addModule(url).then(() => true, () => false);
      } else va.worklet = Promise.resolve(false);
    } catch (_) { va = null; }
  }
  function voiceSource() {
    if (!va || !cam || !cam.stream || !cam.stream.getAudioTracks().length) return;
    try {
      if (va.src) va.src.disconnect();
      va.src = va.ctx.createMediaStreamSource(new MediaStream(cam.stream.getAudioTracks()));
      voiceChain();
    } catch (_) {}
  }
  async function voiceChain() {
    if (!va || !va.src) return;
    const gen = va.gen = (va.gen || 0) + 1;
    const c = va.ctx;
    try { va.src.disconnect(); } catch (_) {}
    va.nodes.forEach((n) => { try { n.disconnect(); if (n.stop) n.stop(); } catch (_) {} });
    va.nodes = [];
    const keep = (n) => { va.nodes.push(n); return n; };
    const shifter = async (ratio) => {
      if (!(await va.worklet) || !va || va.gen !== gen) return null;
      const n = keep(new AudioWorkletNode(c, 'ip-pitch-shift'));
      n.parameters.get('pitch').value = ratio;
      return n;
    };
    const k = voiceKey;
    if (k === 'chipmunk' || k === 'deep' || k === 'alien') { await va.worklet; if (!va || va.gen !== gen) return; }
    let last = va.src;
    const link = (n) => { last.connect(n); last = n; return n; };
    if (k === 'chipmunk' || k === 'deep' || k === 'alien') {
      const ps = await shifter(k === 'chipmunk' ? 1.6 : k === 'deep' ? 0.68 : 1.3);
      if (ps) link(ps);
      if (k === 'alien') {
        const g = keep(c.createGain()); g.gain.value = 0;
        const o = keep(c.createOscillator()); o.frequency.value = 12; o.connect(g.gain); o.start();
        const dry = keep(c.createGain()); dry.gain.value = 0.55;
        last.connect(dry); last.connect(g);
        const mix = keep(c.createGain()); dry.connect(mix); g.connect(mix);
        last = mix;
      }
    } else if (k === 'robot') {
      const g = keep(c.createGain()); g.gain.value = 0;
      const o = keep(c.createOscillator()); o.frequency.value = 55; o.type = 'square'; o.connect(g.gain); o.start();
      link(g);
      const boost = keep(c.createGain()); boost.gain.value = 1.4; link(boost);
    } else if (k === 'echo') {
      const d = keep(c.createDelay(1)); d.delayTime.value = 0.24;
      const fb = keep(c.createGain()); fb.gain.value = 0.45;
      const mix = keep(c.createGain());
      last.connect(mix); last.connect(d); d.connect(fb); fb.connect(d); d.connect(mix);
      last = mix;
    } else if (k === 'announcer') {
      const hp = keep(c.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = 450; link(hp);
      const lp = keep(c.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 3200; link(lp);
      const ws = keep(c.createWaveShaper());
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(3 * x); }
      ws.curve = curve; link(ws);
      const g = keep(c.createGain()); g.gain.value = 0.9; link(g);
    }
    last.connect(va.dest);
  }
  function voiceStop() {
    if (!va) return;
    try { va.ctx.close(); } catch (_) {}
    va = null;
  }
  const CAM_CSS = `
.lpc{position:fixed;inset:0;z-index:9575;background:#000;color:#fff;font:800 14px/1 system-ui,-apple-system,sans-serif}
.lpc video,.lpc-cv{position:absolute;left:50%;top:50%;width:min(100vw,56.25vh);height:min(100vh,177.78vw);transform:translate(-50%,-50%);object-fit:cover;border-radius:14px}
.lpc.front video{transform:translate(-50%,-50%) scaleX(-1)}
.lpc-cv{display:none}
.lpc.lens .lpc-cv{display:block}
.lpc.lens video{opacity:0}
.lpc-glow{position:absolute;z-index:2;top:calc(10px + env(safe-area-inset-top));right:12px;border:2px solid rgba(255,255,255,.4);border-radius:999px;padding:8px 12px;background:rgba(0,0,0,.45);color:#fff;font:900 13px/1 system-ui,sans-serif;cursor:pointer}
.lpc-glow.on{border-color:#ffc13d;background:rgba(255,193,61,.25)}
.lpc.rec .lpc-glow{opacity:.35;pointer-events:none}
.lpc-top{position:absolute;left:0;right:0;top:calc(14px + env(safe-area-inset-top));display:flex;justify-content:center}
.lpc-time{padding:7px 12px;border-radius:999px;background:rgba(0,0,0,.5);font-variant-numeric:tabular-nums}
.lpc.rec .lpc-time{background:#e5243b}
.lpc-bar{position:absolute;left:0;right:0;bottom:calc(26px + env(safe-area-inset-bottom));display:flex;align-items:center;justify-content:space-around}
.lpc-side{width:56px;height:56px;border:0;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;font-size:24px;cursor:pointer}
.lpc-go{position:relative;width:88px;height:88px;border:0;padding:0;background:none;cursor:pointer}
.lpc-go svg{position:absolute;inset:0;transform:rotate(-90deg)}
.lpc-go .dot{position:absolute;inset:14px;border-radius:50%;background:#e5243b;transition:all .2s}
.lpc.rec .lpc-go .dot{inset:28px;border-radius:8px}
.lpc-voices{position:absolute;left:0;right:0;bottom:calc(128px + env(safe-area-inset-bottom));display:flex;gap:8px;overflow-x:auto;padding:0 14px;scrollbar-width:none}
.lpc-voices::-webkit-scrollbar{display:none}
.lpc-voices button{flex:none;border:2px solid transparent;border-radius:999px;padding:8px 12px;background:rgba(0,0,0,.5);color:#fff;font:800 13px/1 system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.lpc-voices button.on{border-color:#ffc13d;background:rgba(255,193,61,.22)}
.lpc.rec .lpc-voices{opacity:.35;pointer-events:none}
.lpc-say{position:absolute;left:16px;right:16px;bottom:calc(180px + env(safe-area-inset-bottom));text-align:center;text-shadow:0 1px 4px #000;font-weight:700}
.lpc-msg{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:30px;font:700 16px/1.5 system-ui}`;

  function camLeft() {
    const used = st && st.photos.length ? duration() : 0;
    return clamp(15 - used, 1, 15);
  }

  async function openCamera() {
    if (cam) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { pickClips(true); return; }
    if (!document.getElementById('lpc-css')) {
      const s2 = document.createElement('style'); s2.id = 'lpc-css'; s2.textContent = CAM_CSS;
      document.head.appendChild(s2);
    }
    const el2 = document.createElement('div');
    el2.className = 'lpc';
    el2.setAttribute('role', 'dialog');
    el2.setAttribute('aria-label', 'Record a Loop');
    el2.innerHTML = `<video playsinline muted autoplay></video><canvas class="lpc-cv" width="${CW}" height="${CH}"></canvas>
      <button type="button" class="lpc-glow${glowOn ? ' on' : ''}" data-cam-glow aria-label="Glow on or off">✨ Glow</button>
      <div class="lpc-top"><span class="lpc-time">0:00 / 0:${String(Math.floor(camLeft())).padStart(2, '0')}</span></div>
      <p class="lpc-say">Tap to record · stops by itself at ${Math.floor(camLeft())} sec</p>
      <div class="lpc-voices" role="radiogroup" aria-label="Character">${CHARACTERS.map((ch) =>
        `<button type="button" data-char="${ch.key}" class="${ch.key === charKey ? 'on' : ''}">${ch.icon} ${ch.name}</button>`).join('')}</div>
      <div class="lpc-bar">
        <button type="button" class="lpc-side" data-cam-pick aria-label="Pick from my phone">🖼</button>
        <button type="button" class="lpc-go" data-cam-go aria-label="Record">
          <svg viewBox="0 0 88 88"><circle cx="44" cy="44" r="40" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="6"/>
            <circle class="ring" cx="44" cy="44" r="40" fill="none" stroke="#ffc13d" stroke-width="6" stroke-linecap="round"
              stroke-dasharray="251.3" stroke-dashoffset="251.3"/></svg>
          <span class="dot"></span></button>
        <button type="button" class="lpc-side" data-cam-flip aria-label="Flip camera">🔄</button>
      </div>`;
    document.body.appendChild(el2);
    cam = { el: el2, stream: null, rec: null, facing: 'environment', raf: 0, parts: [], cv: el2.querySelector('.lpc-cv') };
    cam.cx = cam.cv.getContext('2d');
    charKey = 'normal'; voiceKey = 'normal'; lensKey = null;
    voiceStart();     /* inside the tap, so the phone lets the sound run */
    const b = back();
    if (b) b.push('loopcam', closeCamera);
    el2.addEventListener('click', (e) => {
      if (e.target.closest('[data-cam-go]')) { cam && (cam.rec ? stopRec() : startRec()); return; }
      const gb = e.target.closest('[data-cam-glow]');
      if (gb) {
        if (cam && cam.rec) return;
        glowOn = !glowOn;
        try { localStorage.setItem('ip-loop-glow', glowOn ? 'on' : 'off'); } catch (_) {}
        gb.classList.toggle('on', glowOn);
        lensSet(lensKey);
        return;
      }
      const vb = e.target.closest('[data-char]');
      if (vb) {
        if (cam && cam.rec) return;
        const ch = CHARACTERS.find((x) => x.key === vb.getAttribute('data-char')) || CHARACTERS[0];
        charKey = ch.key;
        voiceKey = ch.voice;
        cam.el.querySelectorAll('[data-char]').forEach((x) => x.classList.toggle('on', x === vb));
        voiceChain();
        lensSet(ch.lens);
        return;
      }
      if (e.target.closest('[data-cam-flip]')) { if (cam && !cam.rec) { cam.facing = cam.facing === 'user' ? 'environment' : 'user'; startStream(); } return; }
      if (e.target.closest('[data-cam-pick]')) { leaveCamera(); setTimeout(() => pickClips(false), 250); }
    });
    startStream();
  }

  async function startStream() {
    if (!cam) return;
    if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
    try {
      cam.stream = await navigator.mediaDevices.getUserMedia({
        /* 4:3 (as the phone counts it, sideways) = the whole camera sensor.
           Asking for 16:9 made phones crop the sensor -- the "zoomed in" look. */
        video: { facingMode: cam.facing, width: { ideal: 1440 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: true
      });
    } catch (err) {
      if (!cam) return;
      cam.el.insertAdjacentHTML('beforeend', `<div class="lpc-msg"><div>The camera is blocked for this site.<br>
        <span style="font-weight:500;color:#cbd5e1">Allow the camera and microphone in your browser settings,<br>or use your phone's camera instead.</span><br><br>
        <button type="button" class="lpm-go" data-cam-native style="padding:14px 20px">Use my phone's camera</button></div></div>`);
      const nb = cam.el.querySelector('[data-cam-native]');
      if (nb) nb.addEventListener('click', () => { leaveCamera(); setTimeout(() => pickClips(true), 250); });
      return;
    }
    if (!cam) { cam = null; return; }
    /* WIDEST THE CAMERA GOES: phones that let a website set zoom (most
       Androids) start at their widest; the others ignore this. */
    try {
      const vt = cam.stream.getVideoTracks()[0];
      const caps = vt && vt.getCapabilities ? vt.getCapabilities() : null;
      if (caps && caps.zoom && typeof caps.zoom.min === 'number') {
        vt.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] }).catch(() => {});
      }
    } catch (_) {}
    voiceSource();
    const v = cam.el.querySelector('video');
    v.srcObject = cam.stream;
    cam.el.classList.toggle('front', cam.facing === 'user');
    v.play().catch(() => {});
    if (canvasOn()) lensSet(lensKey);      /* glow (and any lens) on the canvas */
  }

  function startRec() {
    if (!cam || !cam.stream) return;
    const type = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      .find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch (_) { return false; } });
    /* the picture from the camera, the sound through the voice changer */
    let recStream = cam.stream;
    const audio = (va && va.dest && voiceKey !== 'normal') ? va.dest.stream.getAudioTracks() : cam.stream.getAudioTracks();
    if (canvasOn() && cam.cv && cam.cv.captureStream) {
      /* with a lens on, the picture comes from our canvas (camera + props) */
      recStream = new MediaStream([...cam.cv.captureStream(30).getVideoTracks(), ...audio]);
    } else if (va && va.dest && voiceKey !== 'normal') {
      recStream = new MediaStream([...cam.stream.getVideoTracks(), ...audio]);
    }
    try { cam.rec = new MediaRecorder(recStream, type ? { mimeType: type, videoBitsPerSecond: 5000000 } : undefined); }
    catch (_) { cam.rec = null; return; }
    cam.parts = [];
    cam.max = camLeft();
    cam.rec.ondataavailable = (e) => { if (e.data && e.data.size) cam.parts.push(e.data); };
    cam.rec.onstop = async () => {
      if (!cam) return;
      const base = (cam.rec.mimeType || type || 'video/webm').split(';')[0];
      const blob = new Blob(cam.parts, { type: base });
      const file = new File([blob], 'loop-camera.' + (base === 'video/mp4' ? 'mp4' : 'webm'), { type: base });
      const took = cam.took || lastTook;
      cam.rec = null;
      leaveCamera();
      if (blob.size < 1000 || !st) return;
      const clip = await videoClip(file);
      if (!clip) return;
      /* a recording's length is often unknown to the phone; we know it */
      if (took && (!clip.dur || !isFinite(clip.dur) || clip.dur > took + 0.5)) clip.dur = Math.min(took, 15);
      if (st) { st.photos.push(clip); t0 = performance.now(); paintPanel(); }
    };
    cam.rec.start(250);
    cam.t0 = performance.now();
    cam.el.classList.add('rec');
    const say = cam.el.querySelector('.lpc-say'); if (say) say.textContent = 'Tap to stop';
    const ring = cam.el.querySelector('.ring');
    const time = cam.el.querySelector('.lpc-time');
    const tick = () => {
      if (!cam || !cam.rec) return;
      const t = (performance.now() - cam.t0) / 1000;
      ring.setAttribute('stroke-dashoffset', String(251.3 * (1 - Math.min(1, t / cam.max))));
      time.textContent = `0:${String(Math.floor(t)).padStart(2, '0')} / 0:${String(Math.floor(cam.max)).padStart(2, '0')}`;
      if (t >= cam.max) { stopRec(); return; }
      cam.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  function stopRec() {
    if (!cam || !cam.rec) return;
    cancelAnimationFrame(cam.raf);
    lastTook = Math.min(cam.max, (performance.now() - cam.t0) / 1000);
    cam.took = lastTook;
    try { cam.rec.stop(); } catch (_) {}
  }
  let lastTook = 0;

  function closeCamera() {
    if (!cam) return;
    const c = cam;
    if (c.rec) { try { c.rec.stop(); } catch (_) {} return; }   /* onstop finishes up */
    cancelAnimationFrame(c.raf);
    cancelAnimationFrame(c.lraf);
    lensKey = null;
    if (c.stream) c.stream.getTracks().forEach((t) => t.stop());
    voiceStop();
    c.el.remove();
    cam = null;
  }
  const leaveCamera = () => {
    const b = back();
    if (!b || !b.pop('loopcam')) closeCamera();
  };

  window.InfinitePullsLoopMaker = { open };
})();
