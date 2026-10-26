/* =============================================================================
   PRE-GRADE  --  25 Oct 2026 (night). Jeff's ask, Mike's order of build.

   WHAT IT IS FOR. Somebody is holding a card and wondering whether to spend
   real money sending it to PSA. This answers "is it worth it?" with the
   numbers in front of them -- and says so when the numbers are not there.

   FOUR OUTCOMES, and never a fake grade:
     Worth grading / Borderline / Probably not / Insufficient evidence.

   WHAT IS IN TONIGHT (free, no AI, Mike's stages 1 and 2):
     1. THE CARD   scan it or type it; its raw market value comes with it.
     2. CENTERING  a photo of the front (and the back), eight guide lines you
                   drag onto the card's edges and the printed border, a loupe
                   while you drag, and the left/right + top/bottom split it
                   measures. Shown against PSA's published centering
                   standards, labelled as what they are.
     3. THE MONEY  raw value vs what a graded copy sells for, minus the
                   grading fee, shipping both ways and selling fees. Every
                   number is on screen and every one is editable.
     4. VERDICT    one of the four, with the reasons and what would flip it.

   WHAT IS NOT: the AI defect check (stage 3, on Claude, 15 a month in beta)
   -- the screen says "coming" where it will sit, nothing pretends to see
   scratches. And no sold-comp numbers of our own: eBay's free API only
   shows ASKING prices (see ebayPriceFor in collection.js), so the graded
   price is a number the person reads off eBay's sold list -- there is a
   button that opens exactly that search -- and types in. Honest beats
   automatic here: a made-up PSA 10 price is how somebody loses $50.

   Reached from + -> the dial -> PRE-GRADE (above Scan card). The engine
   -- scanning, finding, pricing, the eBay sold link -- is all
   components/collection.js. This file is the four screens.
   ========================================================================== */
(function () {
  'use strict';

  const col = () => window.InfinitePullsCollection;
  const KEY_REPORTS = 'ip-pregrade-reports-v1';
  const KEY_FEES = 'ip-pregrade-fees-v1';

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
  const money = (n) => (typeof n === 'number' && isFinite(n))
    ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
    : null;
  const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : null; };

  /* PSA's published centering standards (front / back), as the public
     grading standards page lists them. A reference, not a verdict: PSA
     grades the whole card, and a 55/45 front with a dinged corner is not
     a 10. The numbers are the worse of the two axes. */
  const PSA_CENTER = [
    { grade: 10, front: 55, back: 75, label: 'Gem Mint 10' },
    { grade: 9,  front: 60, back: 90, label: 'Mint 9' },
    { grade: 8,  front: 65, back: 90, label: 'NM-MT 8' },
    { grade: 7,  front: 70, back: 90, label: 'NM 7' }
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
.pg-steps{display:flex;gap:6px;padding:0 14px 10px}
.pg-steps button{flex:1;height:36px;border-radius:999px;border:1px solid rgba(255,255,255,.09);background:#0a1120;color:#9eb0c8;font-size:12px;font-weight:700;padding:0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pg-steps button.on{background:rgba(255,201,40,.14);border-color:#ffc928;color:#ffc928}
.pg-steps button.done{color:#f7f8fb;border-color:rgba(25,191,255,.35)}
.pg-body{flex:1;min-height:0;overflow-y:auto;padding:0 14px 16px;display:flex;flex-direction:column;gap:12px;-webkit-overflow-scrolling:touch}
.pg-body>*{flex:0 0 auto}
.pg-foot{padding:10px 14px max(18px,env(safe-area-inset-bottom));background:#0a1120;border-top:1px solid rgba(25,191,255,.25);display:flex;gap:10px}
.pg-foot button{height:52px;border-radius:999px;border:0;font-size:16px;font-weight:800;flex:1}
.pg-go{background:#19bfff;color:#03070d}
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
.pg-in.is-money{font-size:20px;font-weight:800}
.pg-hit{width:100%;display:flex;align-items:center;gap:12px;padding:8px 12px;min-height:60px;border-radius:14px;color:#f7f8fb;text-align:left;background:#03070d;border:1px solid rgba(255,255,255,.09)}
.pg-hit.on{border:2px solid #19bfff;background:rgba(25,191,255,.12)}
.pg-art{width:32px;height:44px;border-radius:5px;flex:0 0 auto;background:#1a2230;overflow:hidden}
.pg-art img{width:100%;height:100%;object-fit:cover;display:block}
.pg-art.big{width:72px;height:100px;border-radius:8px}
.pg-hit strong{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pg-hit small{display:block;font-size:12px;color:#9eb0c8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pg-hit b{font-size:15px;font-weight:800;flex:0 0 auto}
.pg-hit>span:nth-child(2){flex:1;min-width:0}
.pg-status{font-size:13px;color:#9eb0c8;min-height:16px}
.pg-tabs{display:flex;gap:8px}
.pg-tabs button{flex:1;height:40px;border-radius:999px;border:1px solid rgba(255,255,255,.09);background:#0a1120;color:#9eb0c8;font-size:14px;font-weight:700}
.pg-tabs button.on{background:#11213a;border-color:#19bfff;color:#f7f8fb}
.pg-stage{position:relative;width:100%;aspect-ratio:3/4;max-height:62vh;background:#1a2230;border-radius:18px;overflow:hidden;border:1px solid rgba(25,191,255,.25);touch-action:none;user-select:none;-webkit-user-select:none}
.pg-stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;-webkit-user-drag:none}
.pg-stage.is-empty{display:grid;place-items:center;text-align:center;padding:20px;color:#9eb0c8;font-size:14px;line-height:1.5}
.pg-line{position:absolute;pointer-events:none}
.pg-line.v{top:0;bottom:0;width:0;border-left:2px solid var(--c)}
.pg-line.h{left:0;right:0;height:0;border-top:2px solid var(--c)}
.pg-hand{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:999px;background:rgba(3,7,13,.55);border:2px solid var(--c);display:grid;place-items:center;color:var(--c);font-size:11px;font-weight:800;cursor:grab;touch-action:none}
.pg-hand.is-drag{background:var(--c);color:#03070d}
.pg-loupe{position:absolute;width:120px;height:120px;border-radius:999px;border:3px solid #fff;box-shadow:0 10px 30px rgba(0,0,0,.6);overflow:hidden;pointer-events:none;display:none;background:#000}
.pg-loupe canvas{width:100%;height:100%;display:block}
.pg-loupe::after{content:"";position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-7px;border:2px solid #ff3b3b;border-radius:999px}
.pg-legend{display:flex;gap:14px;font-size:12px;color:#9eb0c8}
.pg-legend i{display:inline-block;width:14px;height:3px;vertical-align:middle;margin-right:6px}
.pg-read{display:flex;gap:10px}
.pg-read>div{flex:1;background:#0a1120;border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:10px 12px}
.pg-read small{display:block;font-size:12px;color:#9eb0c8}
.pg-read b{display:block;font-size:22px;font-weight:800}
.pg-read b.is-gold{color:#ffc928}
.pg-std{font-size:13px;color:#9eb0c8;line-height:1.5}
.pg-std b{color:#f7f8fb}
.pg-math{background:#03070d;border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:4px 14px}
.pg-math div{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px}
.pg-math div:last-child{border:0;font-weight:800}
.pg-math span:first-child{color:#c9d4e3}
.pg-math .neg{color:#ff9a9a}
.pg-math .pos{color:#3ddc84}
.pg-verdict{border-radius:22px;padding:22px 18px;text-align:center;display:flex;flex-direction:column;gap:6px;border:1px solid}
.pg-verdict small{font-size:13px;opacity:.85}
.pg-verdict b{font-size:28px;font-weight:800;line-height:1.1}
.pg-verdict.v-yes{background:rgba(61,220,132,.10);border-color:rgba(61,220,132,.5);color:#3ddc84}
.pg-verdict.v-maybe{background:rgba(255,201,40,.10);border-color:rgba(255,201,40,.5);color:#ffc928}
.pg-verdict.v-no{background:rgba(255,120,120,.10);border-color:rgba(255,120,120,.5);color:#ff9a9a}
.pg-verdict.v-none{background:#0a1120;border-color:rgba(255,255,255,.14);color:#9eb0c8}
.pg-why{margin:0;padding-left:18px;font-size:14px;line-height:1.55;color:#c9d4e3}
.pg-why li+li{margin-top:6px}
.pg-fine{font-size:12px;color:#9eb0c8;line-height:1.5}
.pg-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.pg-field label{display:block;font-size:12px;font-weight:700;color:#9eb0c8;margin-bottom:6px}
.pg-seg{display:flex;gap:6px}
.pg-seg button{flex:1;height:40px;border-radius:999px;border:1px solid rgba(255,255,255,.09);background:#03070d;color:#9eb0c8;font-size:13px;font-weight:700}
.pg-seg button.on{background:#11213a;border-color:#19bfff;color:#f7f8fb}
.pg-soon{border:1px dashed rgba(255,255,255,.18);border-radius:18px;padding:14px;font-size:13px;color:#9eb0c8;line-height:1.5}
.pg-soon b{color:#f7f8fb}
@media (prefers-reduced-motion:reduce){.pg *{transition:none!important}}
`;
  function injectCss() {
    if (document.getElementById('pg-css')) return;
    const s = document.createElement('style'); s.id = 'pg-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  const X_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const BACK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  const CAM_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  const OUT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v6H5V6h6"/></svg>';

  function loadFees() { try { return JSON.parse(localStorage.getItem(KEY_FEES) || 'null') || {}; } catch (_) { return {}; } }
  function saveFees(f) { try { localStorage.setItem(KEY_FEES, JSON.stringify(f)); } catch (_) {} }

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

  /* ---- the lab ---------------------------------------------------------- */
  async function open(opts) {
    opts = opts || {};
    const C = col();
    if (!C) { alert('Give it a second and try again.'); return; }
    injectCss();
    const mode = opts.mode === 'ja' ? 'ja' : 'en';
    let fx = null;
    try { fx = await C.loadEurToUsd(); } catch (_) {}

    /* the state of one pre-grade */
    const S = {
      step: 1,
      card: opts.card ? briefOf({ card: opts.card, amount: opts.amount }, mode) : null,
      side: 'front',
      photos: { front: null, back: null },        /* data urls */
      guides: { front: null, back: null },        /* {L,R,T,B,l,r,t,b} as 0..1 of the image box */
      fees: Object.assign({ grade: 10, graded: '', fee: '', ship: '', sell: 13 }, loadFees()),
      raw: null
    };
    if (S.card && typeof S.card.price === 'number') S.raw = S.card.price;

    const root = document.createElement('div');
    root.className = 'pg';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Pre-grading Lab');
    root.innerHTML = `
      <div class="pg-top">
        <button type="button" class="pg-x" data-x aria-label="Close">${X_ICON}</button>
        <div class="pg-title"><span class="pg-badge"><svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><rect x="14" y="5" width="30" height="48" rx="4" fill="#1b1400"/><rect x="17.5" y="8.5" width="23" height="9" rx="1.6" fill="#ffffff"/><path d="M29 13c-1.1-1.5-2-2.2-3.3-2.2a2.2 2.2 0 0 0 0 4.4c1.3 0 2.2-.7 3.3-2.2zm0 0c1.1 1.5 2 2.2 3.3 2.2a2.2 2.2 0 0 0 0-4.4c-1.3 0-2.2.7-3.3 2.2z" stroke="#1b1400" stroke-width="1.5" stroke-linecap="round"/><rect x="17.5" y="20.5" width="23" height="29" rx="1.6" fill="#2a6df4"/><circle cx="42" cy="40" r="11" fill="#1b1400"/><circle cx="42" cy="40" r="7.5" fill="#ffd23f"/><path d="M38.5 40.5l2.5 2.5 4.5-5" stroke="#1b1400" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M50 48l7 7" stroke="#1b1400" stroke-width="5" stroke-linecap="round"/></svg></span><span><b>Pre-grading Lab</b><small data-sub>Is this card worth sending in?</small></span></div>
      </div>
      <div class="pg-steps" role="tablist">
        <button type="button" data-step="1">1 Card</button>
        <button type="button" data-step="2">2 Centering</button>
        <button type="button" data-step="3">3 Money</button>
        <button type="button" data-step="4">4 Verdict</button>
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
      /* Back walks the steps before it leaves, like the phone expects. */
      if (S.step > 1) { S.step--; paint(); try { backReg.push('pregrade', onBack); } catch (_) {} return; }
      popped = true; close();
    }
    if (backReg && typeof backReg.push === 'function') backReg.push('pregrade', onBack);
    function leave() { if (!(backReg && backReg.pop('pregrade'))) close(); }
    q('[data-x]').addEventListener('click', leave);
    q('.pg-steps').addEventListener('click', (e) => {
      const b = e.target.closest('[data-step]'); if (!b) return;
      const n = Number(b.getAttribute('data-step'));
      if (n <= maxStep()) { S.step = n; paint(); }
    });
    function maxStep() {
      if (!S.card) return 1;
      return 4;   /* centering and money can be skipped; the verdict says what is missing */
    }

    /* ---- painting --------------------------------------------------------- */
    function paint() {
      root.querySelectorAll('[data-step]').forEach(b => {
        const n = Number(b.getAttribute('data-step'));
        b.classList.toggle('on', n === S.step);
        b.classList.toggle('done', n < S.step);
        b.disabled = n > maxStep();
      });
      body.scrollTop = 0;
      if (S.step === 1) paintCard();
      else if (S.step === 2) paintCenter();
      else if (S.step === 3) paintMoney();
      else paintVerdict();
    }
    function footHtml(backLabel, goLabel, goDisabled) {
      foot.innerHTML = `${backLabel ? `<button type="button" class="pg-ghost" data-back>${esc(backLabel)}</button>` : ''}
        <button type="button" class="pg-go" data-go ${goDisabled ? 'disabled' : ''}>${esc(goLabel)}</button>`;
      foot.querySelector('[data-back]')?.addEventListener('click', () => { S.step = Math.max(1, S.step - 1); paint(); });
      foot.querySelector('[data-go]').addEventListener('click', () => { if (S.step < 4) { S.step++; paint(); } else finish(); });
    }

    /* ---- 1. the card ------------------------------------------------------ */
    function cardHtml(c, on) {
      return `<button type="button" class="pg-hit${on ? ' on' : ''}" data-pick="${esc(c.id)}">
        <span class="pg-art">${c.img ? `<img src="${esc(c.img)}" alt="">` : ''}</span>
        <span><strong>${esc(c.name)}</strong><small>${esc([c.set, c.num].filter(Boolean).join(' · '))}</small></span>
        <b>${esc(money(c.price) || 'No price')}</b></button>`;
    }
    let found = [];
    function paintCard() {
      q('[data-sub]').textContent = 'Which card?';
      body.innerHTML = `
        ${S.card ? `<div class="pg-card"><div class="pg-lab" style="margin-bottom:8px">This card</div>${cardHtml(S.card, true)}
          <p style="margin-top:8px">Raw market value right now: <b style="color:#f7f8fb">${esc(money(S.raw) || 'no price found')}</b>. That is what it is worth ungraded.</p></div>` : ''}
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
        <div class="pg-card"><h3>What this does</h3><p>Measures the centering off your photos, then does the math: what the card is worth raw, what a graded one sells for, minus the fee and shipping. You get one of four answers. It never guesses a grade and it cannot see scratches in a phone photo.</p></div>`;
      footHtml('', S.card ? 'Next: centering' : 'Pick a card first', !S.card);

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
        S.card = c; S.raw = typeof c.price === 'number' ? c.price : S.raw;
        S.fees.graded = ''; /* a new card, a new graded price */
        paint();
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
      if (found.length === 1) { S.card = found[0]; S.raw = typeof found[0].price === 'number' ? found[0].price : null; S.fees.graded = ''; paint(); return; }
      status(found.length + ' found. Tap the right one.');
      body.querySelector('[data-results]').innerHTML = found.map(c => cardHtml(c, false)).join('');
    }

    /* ---- 2. centering ------------------------------------------------------ */
    const DEFAULT_GUIDES = { L: .06, R: .94, T: .05, B: .95, l: .12, r: .88, t: .11, b: .89 };
    function ratios(g) {
      if (!g) return null;
      const left = g.l - g.L, right = g.R - g.r, top = g.t - g.T, bottom = g.B - g.b;
      if (left <= 0 || right <= 0 || top <= 0 || bottom <= 0) return { bad: true };
      const lr = Math.round(100 * Math.max(left, right) / (left + right));
      const tb = Math.round(100 * Math.max(top, bottom) / (top + bottom));
      return { lr, tb, worst: Math.max(lr, tb), leftHeavy: left > right, topHeavy: top > bottom };
    }
    function stdFor(worst, side) {
      for (const s of PSA_CENTER) if (worst <= s[side]) return s;
      return null;
    }
    function paintCenter() {
      q('[data-sub]').textContent = 'Centering, from your photo';
      const side = S.side;
      const photo = S.photos[side];
      const g = S.guides[side];
      const r = ratios(g);
      const std = r && !r.bad ? stdFor(r.worst, side) : null;
      body.innerHTML = `
        <div class="pg-tabs"><button type="button" data-side="front" class="${side === 'front' ? 'on' : ''}">Front${S.guides.front ? ' ✓' : ''}</button><button type="button" data-side="back" class="${side === 'back' ? 'on' : ''}">Back${S.guides.back ? ' ✓' : ''}</button></div>
        <div class="pg-stage${photo ? '' : ' is-empty'}" data-stage>
          ${photo ? `<img src="${esc(photo)}" alt="The ${side} of the card" data-img>` : `<div>Lay the card flat on a plain background. Shoot it straight on, out of the sleeve, no glare. The whole card in the frame.</div>`}
          <div class="pg-loupe" data-loupe><canvas width="120" height="120"></canvas></div>
        </div>
        <div class="pg-row">
          <button type="button" class="pg-btn ${photo ? '' : 'is-blue'}" data-shoot style="flex:1">${CAM_ICON} ${photo ? 'Retake the ' + side : 'Photo of the ' + side}</button>
          ${photo ? `<button type="button" class="pg-btn" data-reset>Reset lines</button>` : ''}
          <input type="file" accept="image/*" capture="environment" hidden data-file>
        </div>
        ${photo ? `
        <div class="pg-legend"><span><i style="background:#ffc928"></i>card edge</span><span><i style="background:#19bfff"></i>printed border</span><span>Drag the handles. The loupe shows where the line is.</span></div>
        <div class="pg-read">
          <div><small>Left / right</small><b data-lr class="${r && !r.bad && r.lr > 60 ? 'is-gold' : ''}">${r && !r.bad ? r.lr + '/' + (100 - r.lr) : '—'}</b></div>
          <div><small>Top / bottom</small><b data-tb class="${r && !r.bad && r.tb > 60 ? 'is-gold' : ''}">${r && !r.bad ? r.tb + '/' + (100 - r.tb) : '—'}</b></div>
        </div>
        <div class="pg-std" data-std>${stdText(r, side, std)}</div>` : ''}
        <div class="pg-card"><h3>How to read it</h3><p>Yellow lines go on the outside edge of the card, blue lines on the edge of the printed border. The split is the bigger margin against the smaller one, so 50/50 is perfect and 60/40 means one side has half again the margin of the other. PSA's published standards for centering are ${PSA_CENTER.map(s => s.label.split(' ').pop() + ': ' + s.front + '/' + (100 - s.front)).join(', ')} on the front (the back is looser). Centering is one part of a grade, not the grade.</p></div>`;
      footHtml('Back', 'Next: the money', false);

      body.querySelector('.pg-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-side]'); if (!b) return; S.side = b.getAttribute('data-side'); paint(); });
      const file = body.querySelector('[data-file]');
      body.querySelector('[data-shoot]').addEventListener('click', () => file.click());
      file.addEventListener('change', async () => {
        const f = file.files && file.files[0]; file.value = '';
        if (!f) return;
        const url = await fileToDataUrl(f, 1800);
        if (!url) return;
        S.photos[side] = url;
        S.guides[side] = Object.assign({}, DEFAULT_GUIDES);
        paint();
      });
      body.querySelector('[data-reset]')?.addEventListener('click', () => { S.guides[side] = Object.assign({}, DEFAULT_GUIDES); paint(); });
      if (photo) mountGuides(side);
    }
    function stdText(r, side, std) {
      if (!r) return '';
      if (r.bad) return 'The blue lines have to sit inside the yellow ones. Drag them back in.';
      const worst = r.worst + '/' + (100 - r.worst);
      if (!std) return `<b>${worst}</b> on the ${side} is outside PSA's published centering standard for a 7. Off-center this far usually caps the grade on its own.`;
      return `<b>${worst}</b> at its worst, which sits inside PSA's published centering standard for a <b>${std.label}</b> on the ${side}${std.grade < 10 ? ' (not a 10: that needs ' + PSA_CENTER[0][side] + '/' + (100 - PSA_CENTER[0][side]) + ' or better)' : ''}. Corners, edges and surface still decide the rest.`;
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
            resolve(c.toDataURL('image/jpeg', 0.9));
          } catch (_) { resolve(null); }
          URL.revokeObjectURL(u);
        };
        img.onerror = () => { URL.revokeObjectURL(u); resolve(null); };
        img.src = u;
      });
    }

    /* The eight lines and their handles. Positions are fractions of the
       IMAGE's drawn box (object-fit: contain inside the stage), so they
       survive a resize and a rotation of the phone. */
    function mountGuides(side) {
      const stage = body.querySelector('[data-stage]');
      const img = body.querySelector('[data-img]');
      const loupe = body.querySelector('[data-loupe]');
      const lctx = loupe.querySelector('canvas').getContext('2d');
      const g = S.guides[side];
      const defs = [
        /* handles sit a third of the way along, so an edge handle and a
           border handle never land on top of each other near a corner */
        ['L', 'v', '#ffc928', .3], ['R', 'v', '#ffc928', .7], ['T', 'h', '#ffc928', .3], ['B', 'h', '#ffc928', .7],
        ['l', 'v', '#19bfff', .5], ['r', 'v', '#19bfff', .5], ['t', 'h', '#19bfff', .5], ['b', 'h', '#19bfff', .5]
      ];
      const els = {};
      defs.forEach(([k, dir, color, along]) => {
        const line = document.createElement('div'); line.className = 'pg-line ' + dir; line.style.setProperty('--c', color);
        const hand = document.createElement('div'); hand.className = 'pg-hand'; hand.style.setProperty('--c', color);
        hand.setAttribute('role', 'slider'); hand.setAttribute('tabindex', '0'); hand.setAttribute('aria-label', ({ L: 'left card edge', R: 'right card edge', T: 'top card edge', B: 'bottom card edge', l: 'left border', r: 'right border', t: 'top border', b: 'bottom border' })[k]);
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
      let box = null;   /* the image's drawn box inside the stage, in stage px */
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
        if (st) st.innerHTML = stdText(r, side, r && !r.bad ? stdFor(r.worst, side) : null);
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
        /* the loupe sits in the corner away from the finger */
        const sx = box.x + fx * box.w, sy = box.y + fy * box.h;
        const sr = stage.getBoundingClientRect();
        loupe.style.left = (sx < sr.width / 2 ? sr.width - 132 : 12) + 'px';
        loupe.style.top = (sy < sr.height / 2 ? sr.height - 132 : 12) + 'px';
        loupe.style.display = 'block';
      }
      const ready = () => { measure(); layout(); };
      if (img.complete && img.naturalWidth) ready(); else img.addEventListener('load', ready);
      window.addEventListener('resize', ready);
      /* no listener leak: the stage goes away with the next paint() */
      const mo = new MutationObserver(() => { if (!document.body.contains(stage)) { window.removeEventListener('resize', ready); mo.disconnect(); } });
      mo.observe(body, { childList: true });
    }

    /* ---- 3. the money ------------------------------------------------------- */
    function mathOf() {
      const f = S.fees;
      const raw = num(S.raw), graded = num(f.graded), fee = num(f.fee), ship = num(f.ship), sell = num(f.sell);
      if (raw == null || graded == null || fee == null || ship == null || sell == null) return { missing: true, raw, graded, fee, ship, sell };
      const sellPct = Math.min(100, Math.max(0, sell)) / 100;
      const netGraded = graded * (1 - sellPct);
      const netRaw = raw * (1 - sellPct);
      const costs = fee + ship;
      const gain = netGraded - costs - netRaw;
      return { missing: false, raw, graded, fee, ship, sell, netGraded, netRaw, costs, gain };
    }
    function paintMoney() {
      q('[data-sub]').textContent = 'The money';
      const f = S.fees;
      const soldUrl = (grade) => {
        try {
          const u = S.card && S.card.card ? C.ebaySoldUrl(S.card.card, null) : '';
          if (!u) return '';
          const parts = u.split('_nkw=');
          const rest = parts[1].split('&');
          rest[0] = rest[0] + encodeURIComponent(' PSA ' + grade);
          return parts[0] + '_nkw=' + rest.join('&');
        } catch (_) { return ''; }
      };
      body.innerHTML = `
        <div class="pg-card">
          <div class="pg-field"><label for="pg-raw">Raw value (what it sells for ungraded)</label>
            <input id="pg-raw" class="pg-in is-money" inputmode="decimal" data-f="raw" value="${S.raw != null ? Number(S.raw).toFixed(2) : ''}" placeholder="0.00"></div>
          <p style="margin-top:6px">Filled in from the market price. Change it if you know better.</p>
        </div>
        <div class="pg-card">
          <div class="pg-lab" style="margin-bottom:8px">Graded copy sells for</div>
          <div class="pg-seg" style="margin-bottom:8px"><button type="button" data-g="10" class="${f.grade == 10 ? 'on' : ''}">PSA 10</button><button type="button" data-g="9" class="${f.grade == 9 ? 'on' : ''}">PSA 9</button><button type="button" data-g="8" class="${f.grade == 8 ? 'on' : ''}">PSA 8</button></div>
          <input class="pg-in is-money" inputmode="decimal" data-f="graded" value="${esc(f.graded)}" placeholder="What a PSA ${f.grade} actually sold for" aria-label="Graded sale price">
          <div class="pg-row" style="margin-top:8px">
            ${soldUrl(f.grade) ? `<a class="pg-btn is-gold" href="${esc(soldUrl(f.grade))}" target="_blank" rel="noopener" style="flex:1">${OUT_ICON} See PSA ${f.grade} sold on eBay</a>` : ''}
          </div>
          <p style="margin-top:8px">Look at real <b style="color:#f7f8fb">sold</b> prices, not asking prices, and type a typical recent one. We don't make this number up: eBay only hands out asking prices to apps.</p>
        </div>
        <div class="pg-card">
          <div class="pg-lab" style="margin-bottom:8px">What grading costs</div>
          <div class="pg-grid2">
            <div class="pg-field"><label for="pg-fee">Grading fee</label><input id="pg-fee" class="pg-in" inputmode="decimal" data-f="fee" value="${esc(f.fee)}" placeholder="per card"></div>
            <div class="pg-field"><label for="pg-ship">Shipping, both ways</label><input id="pg-ship" class="pg-in" inputmode="decimal" data-f="ship" value="${esc(f.ship)}" placeholder="to them + back"></div>
          </div>
          <div class="pg-field" style="margin-top:8px"><label for="pg-sell">Selling fees when you sell it, %</label><input id="pg-sell" class="pg-in" inputmode="decimal" data-f="sell" value="${esc(f.sell)}" placeholder="13"></div>
          <p style="margin-top:8px">Check the grading company's current price list for the fee; it changes with the card's value and how fast you want it back. These are remembered for next time.</p>
        </div>
        <div class="pg-math" data-math></div>`;
      footHtml('Back', 'See the verdict', false);
      const repaintMath = () => {
        const m = mathOf();
        const el = body.querySelector('[data-math]');
        if (m.missing) { el.innerHTML = '<div><span style="color:#9eb0c8">Fill in the blanks above and the math shows here.</span><span></span></div>'; return; }
        el.innerHTML = `
          <div><span>PSA ${f.grade} sells for</span><span>${esc(money(m.graded))}</span></div>
          <div><span>minus selling fees (${m.sell}%)</span><span class="neg">−${esc(money(m.graded - m.netGraded))}</span></div>
          <div><span>minus grading fee + shipping</span><span class="neg">−${esc(money(m.costs))}</span></div>
          <div><span>minus what it brings raw, after fees</span><span class="neg">−${esc(money(m.netRaw))}</span></div>
          <div><span>Extra money from grading</span><span class="${m.gain >= 0 ? 'pos' : 'neg'}">${m.gain >= 0 ? '+' : '−'}${esc(money(Math.abs(m.gain)))}</span></div>`;
      };
      body.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('input', () => {
        const k = inp.getAttribute('data-f');
        if (k === 'raw') S.raw = num(inp.value); else f[k] = inp.value;
        saveFees({ fee: f.fee, ship: f.ship, sell: f.sell, grade: f.grade });
        repaintMath();
      }));
      body.querySelector('.pg-seg').addEventListener('click', (e) => {
        const b = e.target.closest('[data-g]'); if (!b) return;
        f.grade = Number(b.getAttribute('data-g')); f.graded = '';
        saveFees({ fee: f.fee, ship: f.ship, sell: f.sell, grade: f.grade });
        paint();
      });
      repaintMath();
    }

    /* ---- 4. the verdict ----------------------------------------------------- */
    function verdict() {
      const m = mathOf();
      const rf = ratios(S.guides.front), rb = ratios(S.guides.back);
      const front = rf && !rf.bad ? rf : null, back = rb && !rb.bad ? rb : null;
      const why = [], flip = [];
      let kind = 'none', title = 'Insufficient evidence';

      if (!front) why.push('No centering measured on the front yet. That is the one thing a phone photo can measure well.');
      if (m.missing) why.push('The money is not all there: ' + [m.raw == null && 'raw value', m.graded == null && 'what a graded copy sold for', m.fee == null && 'the grading fee', m.ship == null && 'shipping'].filter(Boolean).join(', ') + '.');
      if (!front || m.missing) return { kind, title, why, flip, m, front, back };

      /* centering caps the grade the money was typed for */
      const grade = S.fees.grade;
      const capF = stdFor(front.worst, 'front');
      const capB = back ? stdFor(back.worst, 'back') : null;
      const cap = Math.min(capF ? capF.grade : 6, capB ? capB.grade : 10);
      let capped = false;
      if (cap < grade) {
        capped = true;
        why.push(`Centering alone makes a PSA ${grade} unlikely: ${front.worst}/${100 - front.worst} on the front${back && capB && capB.grade < grade ? ', ' + back.worst + '/' + (100 - back.worst) + ' on the back' : ''} sits in PSA's published range for a ${cap >= 7 ? cap : '6 or lower'}. The money below is for a ${grade}, so it is optimistic.`);
        flip.push(`Run the money again with the PSA ${cap >= 7 ? cap : 7} sold price instead.`);
      } else {
        why.push(`Centering is inside PSA's published range for a ${grade}: ${front.worst}/${100 - front.worst} on the front${back ? ', ' + back.worst + '/' + (100 - back.worst) + ' on the back' : ' (back not measured)'}.`);
      }
      if (!back) flip.push('Measure the back too. A back that is way off caps the grade as well.');

      const ratio = m.costs > 0 ? m.gain / m.costs : (m.gain > 0 ? 9 : -9);
      if (m.gain <= 0) {
        kind = 'no'; title = 'Probably not worth grading';
        why.push(`Graded and sold, it comes out ${money(Math.abs(m.gain))} ${m.gain < 0 ? 'behind' : 'even with'} just selling it raw, after the ${money(m.costs)} it costs to grade.`);
        flip.push(`A PSA ${grade} would have to sell for about ${money(m.netRaw + m.costs + 0.01 + (m.costs * 0.5))} or more (after fees) to make this worth it.`);
      } else if (capped) {
        kind = 'maybe'; title = 'Borderline';
        why.push(`At a PSA ${grade} it would add about ${money(m.gain)} over selling it raw, after the ${money(m.costs)} it costs. But the centering says a ${grade} is unlikely, and a grade lower can sell for a lot less.`);
      } else if (ratio < 0.5) {
        kind = 'maybe'; title = 'Borderline';
        why.push(`Grading adds about ${money(m.gain)} over selling it raw, after the ${money(m.costs)} it costs. That is a thin margin: one grade lower and it is gone.`);
        flip.push(`If a PSA ${grade} sells for more than ${money(m.graded)} lately, this tips to worth it. If the corners are not clean, it tips the other way.`);
      } else {
        kind = 'yes'; title = 'Worth grading';
        why.push(`Grading adds about ${money(m.gain)} over selling it raw, after the ${money(m.costs)} it costs. The upside covers the cost with room for a grade lower.`);
        flip.push(`A whitened corner, a scratch or a print line you cannot see in a phone photo. Look at it under a bright light before you send it.`);
      }
      return { kind, title, why, flip, m, front, back };
    }
    function paintVerdict() {
      q('[data-sub]').textContent = 'The verdict';
      const v = verdict();
      body.innerHTML = `
        ${S.card ? `<div class="pg-hit on" style="pointer-events:none"><span class="pg-art">${S.card.img ? `<img src="${esc(S.card.img)}" alt="">` : ''}</span><span><strong>${esc(S.card.name)}</strong><small>${esc([S.card.set, S.card.num].filter(Boolean).join(' · '))}</small></span><b>${esc(money(S.raw) || '')}</b></div>` : ''}
        <div class="pg-verdict v-${v.kind}"><small>From your photos and your numbers</small><b>${esc(v.title)}</b>${v.m && !v.m.missing ? `<small>${v.m.gain >= 0 ? '+' : '−'}${esc(money(Math.abs(v.m.gain)))} from grading, after all costs</small>` : ''}</div>
        <div class="pg-card"><h3>Why</h3><ul class="pg-why">${v.why.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>
        ${v.flip.length ? `<div class="pg-card"><h3>What would change it</h3><ul class="pg-why">${v.flip.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
        <div class="pg-soon"><b>Coming: the AI condition check.</b> It will look at corner and edge close-ups for whitening, chips and print lines and show you exactly where it is looking. Not here yet, and no photo check replaces your own eyes under a good light.</div>
        <p class="pg-fine">This is decision support, not a grade. A phone photo cannot rule out scratches, dents or a bent corner, and sold prices move. Grading a card you love is a different question from grading one to sell.</p>`;
      footHtml('Back', 'Save and start another', false);
    }
    function finish() {
      try {
        const v = verdict();
        const saved = JSON.parse(localStorage.getItem(KEY_REPORTS) || '[]');
        saved.unshift({ at: Date.now(), card: S.card && { id: S.card.id, name: S.card.name, set: S.card.set, num: S.card.num, img: S.card.img }, raw: S.raw,
          front: v.front && { lr: v.front.lr, tb: v.front.tb }, back: v.back && { lr: v.back.lr, tb: v.back.tb },
          grade: S.fees.grade, graded: num(S.fees.graded), fee: num(S.fees.fee), ship: num(S.fees.ship), sell: num(S.fees.sell),
          gain: v.m && !v.m.missing ? v.m.gain : null, verdict: v.title });
        localStorage.setItem(KEY_REPORTS, JSON.stringify(saved.slice(0, 20)));
      } catch (_) {}
      S.card = null; S.raw = null; S.photos = { front: null, back: null }; S.guides = { front: null, back: null }; S.fees.graded = ''; S.side = 'front';
      found = [];
      S.step = 1; paint();
    }

    paint();
  }

  if (document.head) injectCss(); else document.addEventListener('DOMContentLoaded', injectCss);
  window.InfinitePullsPregrade = { open };
})();
