/* =============================================================================
   THE INFINITE SCANNER (continuous)  --  25 Oct 2026, Mike + Jeff.

   WHAT IT IS FOR. Somebody has a STACK of cards -- a trade across a table,
   twenty-five cards somebody wants to sell Jeff, a binder page's worth of
   pulls -- and wants one number for the pile, not a price per card with the
   camera reopening in between.

   HOW IT GOES
     hold a card in the outline -> it shoots BY ITSELF when the card holds
     still -> the card drops onto the list with its price -> swap the next
     card in -> it shoots again. A running total sits on the list. DONE
     shows the stack, what it is worth, and what a shop paying X% would
     offer. "Add all to My Stuff" is the second button, on purpose: Mike
     said this is for trades and comparing first, collecting second.

   WHERE IT LIVES. + -> Scan card -> the "∞ Infinite Scanner (continuous)"
   pill across the top of the camera. Everybody gets it, not only the shop.

   TONKA TRUCK RULES (Mike: "they're going to be rough on it")
     - The stack is written to localStorage after every change. A phone
       call, a refresh, bad wifi, the app being killed -- the stack is
       there when they come back, with a "keep going / start fresh" ask.
     - A read that fails is NOT an error. It becomes a gold "Pick it" row
       that is fixed with a tap. Scanning never stops for it.
     - The same card twice in a row is never shot twice by accident. After
       a shot, the scanner waits for the card to MOVE before it arms again.
       A second copy scanned on purpose stacks as x2 with its own minus.
     - Wrong card? Tap the row: the other cards it thought it might be,
       a search box that finds by name or number, Retake, Remove.

   NOTHING HERE IS WRITTEN TWICE. Reading the frame (the scan-card edge
   function), finding the card (lookupByNumber / findCardFromScan /
   lookupBySearch), ranking the candidates and pricing them are all
   components/collection.js -- the same engine the one-card scanner, Card
   Lookup and My Stuff use, as Mike asked for on 9 Sep ("one engine, not
   three"). This file is the camera loop and the list.
   ========================================================================== */
(function () {
  'use strict';

  const col = () => window.InfinitePullsCollection;
  const sb  = () => window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;

  const KEY_STACK = 'ip-infinite-stack-v1';
  const KEY_PAY   = 'ip-infinite-pay-v1';
  const KEY_SAVED = 'ip-infinite-saved-v1';
  const KEY_TIP   = 'ip-infinite-tip-v1';

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
  const money = (n) => (typeof n === 'number' && isFinite(n))
    ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
    : null;

  /* ---- its own look, so it is the same on every page that loads it ---- */
  const CSS = `
.inf{position:fixed;inset:0;z-index:9999;background:#03070d;color:#f7f8fb;display:flex;flex-direction:column;
  font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;overscroll-behavior:contain}
.inf *{box-sizing:border-box}
.inf button{font-family:inherit}
.inf-top{display:flex;align-items:center;gap:10px;padding:max(10px,env(safe-area-inset-top)) 14px 8px}
.inf-x{width:44px;height:44px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:#0a1120;color:#f7f8fb;
  display:grid;place-items:center;padding:0;flex:0 0 auto}
.inf-x svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round}
.inf-title{flex:1;min-width:0;height:44px;border-radius:999px;border:2px solid #ffc928;background:rgba(255,201,40,.12);color:#ffc928;
  display:flex;align-items:center;justify-content:center;gap:8px;font-weight:800;font-size:15px;white-space:nowrap}
.inf-title svg{width:28px;height:16px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;flex:0 0 auto}
.inf-title small{font-size:12px;font-weight:600;opacity:.85}
.inf-count{flex:0 0 auto;min-width:44px;height:44px;padding:0 12px;border-radius:999px;background:#11213a;border:1px solid rgba(25,191,255,.25);
  display:grid;place-items:center;font-weight:800;font-size:15px}

.inf-cam{position:relative;margin:0 14px;height:min(42vh,320px);border-radius:22px;overflow:hidden;background:#1a2230;border:1px solid rgba(25,191,255,.25);flex:0 0 auto}
.inf-cam video{width:100%;height:100%;object-fit:cover;display:block}
.inf-mask{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.inf-guide{position:relative;height:84%;aspect-ratio:63/88;border-radius:12px;box-shadow:0 0 0 100vmax rgba(0,0,0,.5);transition:box-shadow .15s}
.inf-guide i{position:absolute;width:24px;height:24px;border:3px solid #19bfff}
.inf-guide i:nth-child(1){top:-2px;left:-2px;border-right:0;border-bottom:0;border-radius:10px 0 0 0}
.inf-guide i:nth-child(2){top:-2px;right:-2px;border-left:0;border-bottom:0;border-radius:0 10px 0 0}
.inf-guide i:nth-child(3){bottom:-2px;left:-2px;border-right:0;border-top:0;border-radius:0 0 0 10px}
.inf-guide i:nth-child(4){bottom:-2px;right:-2px;border-left:0;border-top:0;border-radius:0 0 10px 0}
.inf.is-steady .inf-guide i{border-color:#ffc928}
.inf.is-flash .inf-cam::after{content:"";position:absolute;inset:0;background:#fff;animation:inf-flash .25s ease-out forwards}
@keyframes inf-flash{from{opacity:.9}to{opacity:0}}
.inf-state{position:absolute;top:10px;left:10px;display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;
  background:rgba(3,7,13,.75);font-size:12px;color:#9eb0c8}
.inf-state b{width:8px;height:8px;border-radius:999px;background:#3ddc84;display:inline-block}
.inf.is-reading .inf-state b{background:#ffc928;animation:inf-pulse .8s infinite alternate}
@keyframes inf-pulse{to{opacity:.3}}
.inf-toast{position:absolute;left:10px;right:10px;bottom:10px;display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:14px;
  background:#ffc928;color:#03070d;font-weight:800;font-size:14px;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s;pointer-events:none}
.inf-toast.on{opacity:1;transform:none}
.inf-toast.is-pick{background:#11213a;color:#ffc928;border:1px solid rgba(255,201,40,.45)}
.inf-toast span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.inf-toast svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto}
.inf-shoot{position:absolute;right:10px;top:10px;height:34px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,255,255,.25);
  background:rgba(3,7,13,.7);color:#f7f8fb;font-size:12px;font-weight:700}
.inf-hint{margin:8px 18px 0;font-size:12px;color:#9eb0c8;text-align:center;min-height:16px}

.inf-listhead{display:flex;justify-content:space-between;align-items:baseline;padding:10px 18px 4px}
.inf-listhead b{font-size:12px;font-weight:700;color:#9eb0c8;text-transform:uppercase;letter-spacing:.06em}
.inf-listhead small{font-size:12px;color:#9eb0c8}
.inf-list{flex:1;min-height:0;overflow-y:auto;padding:0 14px 10px;display:flex;flex-direction:column;gap:8px;-webkit-overflow-scrolling:touch}
.inf-empty{padding:28px 16px;text-align:center;color:#9eb0c8;font-size:14px;line-height:1.5}
.inf-row{width:100%;display:flex;align-items:center;gap:12px;padding:8px 12px;min-height:60px;border-radius:16px;color:#f7f8fb;text-align:left;
  background:#0a1120;border:1px solid rgba(255,255,255,.09);animation:inf-in .25s ease-out}
.inf-row.is-pick{background:rgba(255,201,40,.10);border-color:rgba(255,201,40,.45)}
.inf-row.is-busy{opacity:.7}
@keyframes inf-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.inf-art{width:32px;height:44px;border-radius:5px;flex:0 0 auto;background:#1a2230;overflow:hidden}
.inf-art img{width:100%;height:100%;object-fit:cover;display:block}
.inf-body{flex:1;min-width:0}
.inf-body strong{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.inf-body small{display:block;font-size:12px;color:#9eb0c8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.inf-row.is-pick .inf-body small{color:#ffc928}
.inf-price{font-size:16px;font-weight:800;flex:0 0 auto}
.inf-price.is-none{font-size:13px;color:#9eb0c8;font-weight:600}
.inf-qty{flex:0 0 auto;font-size:12px;font-weight:800;color:#03070d;background:#ffc928;border-radius:999px;padding:3px 7px}

.inf-foot{background:#0a1120;border-top:1px solid rgba(25,191,255,.25);padding:12px 14px max(18px,env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:10px}
.inf-nums{display:flex;gap:10px}
.inf-nums>div{flex:1}
.inf-nums>div+div{text-align:right}
.inf-nums small{display:block;font-size:12px;color:#9eb0c8}
.inf-nums b{display:block;font-size:24px;font-weight:800}
.inf-nums .is-offer b{color:#ffc928}
.inf-done{height:52px;border-radius:999px;border:0;background:#19bfff;color:#03070d;font-size:16px;font-weight:800}
.inf-done:disabled{opacity:.45}

/* the sheets: fix a card, the offer */
.inf-sheet{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;justify-content:flex-end;background:rgba(3,7,13,.6)}
.inf-sheet>div{background:#0a1120;border-top:1px solid rgba(25,191,255,.25);border-radius:26px 26px 0 0;padding:10px 16px max(22px,env(safe-area-inset-bottom));
  display:flex;flex-direction:column;gap:14px;max-height:92%;overflow-y:auto;animation:inf-up .22s ease-out}
@keyframes inf-up{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}
.inf-grip{width:44px;height:5px;border-radius:999px;background:#2a3a55;align-self:center;flex:0 0 auto}
.inf-sheet h2{margin:0;font-size:20px;font-weight:800}
.inf-sheet .inf-sub{font-size:13px;color:#9eb0c8}
.inf-sheet .inf-sub.is-gold{color:#ffc928}
.inf-head{display:flex;align-items:flex-start;gap:14px}
.inf-head .inf-art{width:64px;height:90px;border-radius:8px}
.inf-head>div{flex:1;min-width:0}
.inf-lab{font-size:12px;font-weight:700;color:#9eb0c8;text-transform:uppercase;letter-spacing:.06em}
.inf-choices{display:flex;flex-direction:column;gap:8px}
.inf-choice{width:100%;min-height:56px;display:flex;align-items:center;gap:12px;padding:8px 12px;border-radius:14px;color:#f7f8fb;text-align:left;
  background:#03070d;border:1px solid rgba(255,255,255,.09)}
.inf-choice.on{background:rgba(25,191,255,.12);border:2px solid #19bfff}
.inf-choice .inf-art{width:26px;height:36px;border-radius:4px}
.inf-search{display:flex;gap:8px}
.inf-search input{flex:1;min-width:0;height:50px;border-radius:14px;border:1px solid rgba(25,191,255,.25);background:#03070d;color:#f7f8fb;font:inherit;font-size:16px;padding:0 14px}
.inf-search button{height:50px;padding:0 14px;border-radius:14px;border:1px solid rgba(255,255,255,.09);background:#11213a;color:#f7f8fb;font-size:14px;font-weight:700}
.inf-more{font-size:13px;color:#9eb0c8;min-height:16px}
.inf-pricebox{display:flex;gap:8px;align-items:center}
.inf-pricebox input{flex:1;min-width:0;height:50px;border-radius:14px;border:1px solid rgba(25,191,255,.25);background:#03070d;color:#f7f8fb;font:inherit;font-size:20px;font-weight:800;padding:0 14px}
.inf-pricebox button{height:50px;padding:0 14px;border-radius:14px;border:1px solid rgba(255,255,255,.09);background:#11213a;color:#f7f8fb;font-size:13px;font-weight:700}
.inf-qtyrow{display:flex;align-items:center;gap:12px}
.inf-qtyrow>span{flex:1;font-size:15px;font-weight:600}
.inf-pm{width:44px;height:44px;border-radius:999px;border:1px solid rgba(255,255,255,.09);background:#11213a;color:#f7f8fb;font-size:22px;font-weight:800}
.inf-qtyn{width:40px;text-align:center;font-size:20px;font-weight:800}
.inf-btns{display:flex;gap:10px}
.inf-btns button,.inf-btns a{height:52px;flex:1;border-radius:999px;border:0;font-size:15px;font-weight:800;display:flex;align-items:center;justify-content:center;text-decoration:none;color:#f7f8fb}
.inf-btns .is-bad{background:transparent;border:1px solid rgba(255,120,120,.45);color:#ff9a9a;flex:1}
.inf-btns .is-ghost{background:transparent;border:1px solid rgba(255,255,255,.14)}
.inf-btns .is-go{background:#19bfff;color:#03070d;flex:2}
.inf-btns .is-gold{background:#ffc928;color:#03070d}
.inf-big{background:#0a1120;border:1px solid rgba(255,201,40,.45);border-radius:22px;padding:20px;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center}
.inf-big small{font-size:13px;color:#9eb0c8}
.inf-big b{font-size:48px;font-weight:800;color:#ffc928;line-height:1}
.inf-payrow{display:flex;align-items:center;gap:10px;background:#03070d;border:1px solid rgba(255,255,255,.09);border-radius:18px;padding:12px 14px}
.inf-payrow>div{flex:1}
.inf-payrow>div b{display:block;font-size:15px;font-weight:600}
.inf-payrow>div small{font-size:12px;color:#9eb0c8}
.inf-payn{width:58px;text-align:center;font-size:22px;font-weight:800}
.inf-mini{background:#03070d;border:1px solid rgba(255,255,255,.09);border-radius:18px;padding:4px 14px}
.inf-mini div{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px}
.inf-mini div:last-child{border:0}
.inf-mini span:first-child{color:#c9d4e3;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.inf-mini span:last-child{font-weight:600;flex:0 0 auto}
.inf-said{font-size:13px;color:#9eb0c8;text-align:center;min-height:16px}
.inf-ask{position:absolute;inset:0;z-index:3;display:grid;place-items:center;background:rgba(3,7,13,.8);padding:24px}
.inf-ask>div{background:#0a1120;border:1px solid rgba(25,191,255,.25);border-radius:22px;padding:22px 18px;display:flex;flex-direction:column;gap:14px;width:100%;max-width:360px;text-align:center}
.inf-ask h3{margin:0;font-size:18px;font-weight:800}
.inf-ask p{margin:0;font-size:14px;color:#9eb0c8;line-height:1.5}
@media (prefers-reduced-motion:reduce){.inf-row,.inf-sheet>div{animation:none}}

/* the two doors in: the pill across the top of the one-card camera, and
   the ∞ button beside Scan Card on Card Lookup */
.scan-overlay .scan-infinite{flex:0 0 auto;margin:calc(10px + env(safe-area-inset-top)) 12px 8px;height:46px;border-radius:999px;
  border:2px solid #ffc928;background:rgba(255,201,40,.14);color:#ffc928;display:flex;align-items:center;justify-content:center;gap:8px;
  font:800 15px/1 system-ui,-apple-system,sans-serif;cursor:pointer}
.scan-overlay .ig-pills+.scan-infinite{margin-top:0}
.scan-overlay .scan-infinite svg{width:30px;height:16px;fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round}
.scan-overlay .scan-infinite small{font-size:12px;font-weight:600;opacity:.85}
.scan-overlay.is-reviewing .scan-infinite{display:none}
.lookup-infinite{border-color:rgba(255,201,40,.55)!important;color:#ffc928!important}
.lookup-infinite span{font-size:1.35em;line-height:1;font-weight:900}
`;
  function injectCss() {
    if (document.getElementById('inf-scanner-css')) return;
    const s = document.createElement('style');
    s.id = 'inf-scanner-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const INF_ICON = '<svg viewBox="0 0 36 18" aria-hidden="true"><path d="M18 9c-3-4-5.5-6-9-6a6 6 0 0 0 0 12c3.5 0 6-2 9-6zm0 0c3 4 5.5 6 9 6a6 6 0 0 0 0-12c-3.5 0-6 2-9 6z"/></svg>';
  const X_ICON   = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const OK_ICON  = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';
  const Q_ICON   = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9a3 3 0 1 1 4 2.8c-.7.4-1 1-1 1.7V15"/><path d="M12 19h.01"/></svg>';

  /* ---- the stack on disk ------------------------------------------------
     Rows are kept small: what the list needs to paint and what the fix
     sheet needs to offer. The full card object stays in memory for Add
     to My Stuff; after a reload it is fetched again by id when needed. */
  function loadStack() {
    try {
      const raw = localStorage.getItem(KEY_STACK);
      const s = raw ? JSON.parse(raw) : null;
      if (s && Array.isArray(s.rows)) return s;
    } catch (_) {}
    return null;
  }
  function saveStack(st) {
    try {
      localStorage.setItem(KEY_STACK, JSON.stringify({
        at: st.at, mode: st.mode,
        rows: st.rows.map(r => ({
          key: r.key, id: r.id, lang: r.lang, name: r.name, set: r.set, num: r.num, img: r.img,
          price: r.price, qty: r.qty, pick: !!r.pick, manual: !!r.manual,
          cands: (r.cands || []).slice(0, 6).map(c => ({ id: c.id, lang: c.lang, name: c.name, set: c.set, num: c.num, img: c.img, price: c.price })),
          readName: r.readName || null, readNumber: r.readNumber || null
        }))
      }));
    } catch (_) {}
  }
  function clearStack() { try { localStorage.removeItem(KEY_STACK); } catch (_) {} }
  function loadPay() { const n = Number(localStorage.getItem(KEY_PAY)); return isFinite(n) && n >= 10 && n <= 100 ? n : 60; }
  function savePay(n) { try { localStorage.setItem(KEY_PAY, String(n)); } catch (_) {} }

  /* A hit from collection.js -> the row shape the list paints. */
  function briefOf(hit, lang) {
    const c = (hit && (hit.card || hit.brief)) || hit || {};
    const total = c.set && c.set.cardCount && c.set.cardCount.official;
    return {
      id: c.id || null,
      lang: c._lang || lang,
      name: c.name || (hit && hit.enName) || 'Unknown card',
      set: (c.set && c.set.name) || '',
      num: c.localId ? String(c.localId) + (total ? '/' + total : '') : '',
      img: c.image ? c.image + '/low.webp' : '',
      price: (hit && typeof hit.amount === 'number') ? hit.amount : null,
      card: hit && hit.card ? hit.card : null
    };
  }

  /* ---- the whole thing ---------------------------------------------- */
  async function open(opts) {
    opts = opts || {};
    const C = col();
    if (!C) { alert('The scanner is not loaded yet. Give it a second and try again.'); return; }
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext)) {
      alert('No camera available here. The Infinite Scanner needs the phone camera.');
      return;
    }
    injectCss();

    const mode = opts.mode === 'ja' ? 'ja' : 'en';
    let st = { at: Date.now(), mode, rows: [] };
    let pay = loadPay();
    let fx = null;
    try { fx = await C.loadEurToUsd(); } catch (_) {}

    const root = document.createElement('div');
    root.className = 'inf';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Infinite Scanner');
    root.innerHTML = `
      <div class="inf-top">
        <button type="button" class="inf-x" data-x aria-label="Close the scanner">${X_ICON}</button>
        <div class="inf-title">${INF_ICON}<span>Infinite Scanner <small>(continuous)</small></span></div>
        <div class="inf-count" data-count>0</div>
      </div>
      <div class="inf-cam">
        <video playsinline muted autoplay></video>
        <div class="inf-mask"><div class="inf-guide"><i></i><i></i><i></i><i></i></div></div>
        <div class="inf-state"><b></b><span data-state>Starting camera…</span></div>
        <button type="button" class="inf-shoot" data-shoot>Shoot now</button>
        <div class="inf-toast" data-toast>${OK_ICON}<span></span><em data-toast-price></em></div>
      </div>
      <p class="inf-hint" data-hint>Hold a card in the box. It shoots when the card holds still.</p>
      <div class="inf-listhead"><b>This stack</b><small>Tap a card to fix it</small></div>
      <div class="inf-list" data-list></div>
      <div class="inf-foot">
        <div class="inf-nums">
          <div><small>Stack value</small><b data-total>$0.00</b></div>
          <div class="is-offer"><small>Offer at <span data-pay>${pay}</span>%</small><b data-offer>$0.00</b></div>
        </div>
        <button type="button" class="inf-done" data-done disabled>Done, see the total</button>
      </div>`;
    document.body.appendChild(root);
    document.body.classList.add('scan-open');

    const q = (s) => root.querySelector(s);
    const video = q('video');
    const guide = q('.inf-guide');
    const cam = q('.inf-cam');
    const list = q('[data-list]');

    let stream = null;
    let closed = false;
    let armed = true;          /* allowed to auto-shoot */
    let needMove = false;      /* after a shot: wait for the card to change */
    let reading = 0;           /* reads in flight */
    let steadyFor = 0;
    let lastSmall = null;
    let loopTimer = null;
    let toastTimer = null;

    /* ---- the way out, every way --------------------------------------- */
    const backReg = window.InfinitePullsBack;
    let popped = false;
    function close() {
      if (closed) return;
      closed = true;
      clearInterval(loopTimer);
      try { stream && stream.getTracks().forEach(t => t.stop()); } catch (_) {}
      document.body.classList.remove('scan-open');
      document.removeEventListener('keydown', onKey);
      root.remove();
      if (backReg && !popped) { try { backReg.pop('infinite'); } catch (_) {} }
      if (opts.onClose) { try { opts.onClose(st); } catch (_) {} }
    }
    const onKey = (e) => { if (e.key === 'Escape') { if (!closeSheet()) close(); } };
    document.addEventListener('keydown', onKey);
    /* THE PHONE'S BACK BUTTON. A sheet over the scanner is one step back;
       the scanner itself is the next. The stack is saved either way, so
       Back never loses anything. */
    function onBack() {
      if (closeSheet()) { try { backReg.push('infinite', onBack); } catch (_) {} return; }
      popped = true;
      close();
    }
    if (backReg && typeof backReg.push === 'function') backReg.push('infinite', onBack);
    q('[data-x]').addEventListener('click', () => {
      if (st.rows.length) { askLeave(); return; }
      if (!(backReg && backReg.pop('infinite'))) close();
    });

    /* ---- painting ----------------------------------------------------- */
    function totals() {
      let t = 0;
      /* A card that still needs a pick is not in the total. A number that
         might be the wrong card is worse than a number that is short. */
      st.rows.forEach(r => { if (!r.pick && typeof r.price === 'number') t += r.price * (r.qty || 1); });
      return { total: t, offer: t * pay / 100, count: st.rows.reduce((n, r) => n + (r.qty || 1), 0) };
    }
    function rowHtml(r) {
      const pick = r.pick || typeof r.price !== 'number';
      const price = pick ? null : money(r.price);
      return `
        <button type="button" class="inf-row${pick ? ' is-pick' : ''}${r.busy ? ' is-busy' : ''}" data-row="${esc(r.key)}">
          <span class="inf-art">${r.img ? `<img src="${esc(r.img)}" alt="" loading="lazy" decoding="async">` : ''}</span>
          <span class="inf-body">
            <strong>${esc(r.name)}</strong>
            <small>${r.busy ? 'Reading…' : (pick ? (r.cands && r.cands.length ? 'Not sure which one. Tap to pick.' : 'Could not read it. Tap to find it.') : esc([r.set, r.num].filter(Boolean).join(' · ')))}</small>
          </span>
          ${(r.qty || 1) > 1 ? `<span class="inf-qty">×${r.qty}</span>` : ''}
          <span class="inf-price${price ? '' : ' is-none'}">${price ? esc(price) : (r.busy ? '…' : 'Pick')}</span>
        </button>`;
    }
    function paint() {
      const t = totals();
      q('[data-count]').textContent = String(t.count);
      q('[data-total]').textContent = money(t.total) || '$0.00';
      q('[data-offer]').textContent = money(t.offer) || '$0.00';
      q('[data-pay]').textContent = String(pay);
      q('[data-done]').disabled = !st.rows.length;
      list.innerHTML = st.rows.length
        ? st.rows.slice().reverse().map(rowHtml).join('')
        : '<div class="inf-empty">Nothing yet. Hold the first card in the box up top.<br>Newest cards show at the top of this list.</div>';
      saveStack(st);
    }
    function toast(text, price, kind) {
      const t = q('[data-toast]');
      t.querySelector('span').textContent = text;
      t.querySelector('[data-toast-price]').textContent = price || '';
      t.classList.toggle('is-pick', kind === 'pick');
      t.querySelector('svg').outerHTML = kind === 'pick' ? Q_ICON : OK_ICON;
      t.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
    }
    function state(text) { q('[data-state]').textContent = text; }
    function hint(text) { q('[data-hint]').textContent = text; }

    /* ---- the camera ----------------------------------------------------- */
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false
      });
    } catch (_) {
      close();
      alert('Could not open the camera. Check that the site is allowed to use it.');
      return;
    }
    if (closed) { try { stream.getTracks().forEach(t => t.stop()); } catch (_) {} return; }
    video.srcObject = stream;
    try { await video.play(); } catch (_) {}
    state('Camera on');

    /* Maps the guide box on screen back to pixels in the video, which is
       drawn object-fit: cover. Same arithmetic as collection.js's
       coverSourceRect; it lives there privately, so it is repeated here. */
    function guideRect() {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return null;
      const box = cam.getBoundingClientRect();
      const g = guide.getBoundingClientRect();
      const scale = Math.max(box.width / vw, box.height / vh);
      const offX = (box.width - vw * scale) / 2, offY = (box.height - vh * scale) / 2;
      return {
        sx: Math.max(0, (g.left - box.left - offX) / scale),
        sy: Math.max(0, (g.top - box.top - offY) / scale),
        sw: Math.min(vw, g.width / scale),
        sh: Math.min(vh, g.height / scale)
      };
    }

    /* A tiny greyscale copy of the guide, for comparing one moment to the
       next. 48x66 is enough to tell "the card moved" from "the card is
       still" and costs nothing. */
    const small = document.createElement('canvas');
    small.width = 48; small.height = 66;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    function grabSmall(src) {
      try {
        sctx.drawImage(video, src.sx, src.sy, src.sw, src.sh, 0, 0, 48, 66);
        const d = sctx.getImageData(0, 0, 48, 66).data;
        const g = new Float32Array(48 * 66);
        for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
        return g;
      } catch (_) { return null; }
    }
    function diff(a, b) {
      if (!a || !b) return 999;
      let s = 0;
      for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
      return s / a.length;
    }
    /* Is there even a card there? A flat table top has almost no edges. */
    function edges(g) {
      let s = 0;
      for (let y = 0; y < 66; y++) for (let x = 1; x < 48; x++) s += Math.abs(g[y * 48 + x] - g[y * 48 + x - 1]);
      return s / (66 * 47);
    }
    function sharpness(src) {
      try {
        const W = 120, H = 60;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, src.sx, src.sy + src.sh * .78, src.sw, src.sh * .22, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        let t = 0;
        for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) {
          const i = (y * W + x) * 4, j = i - 4;
          const df = (d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114) - (d[j] * .299 + d[j + 1] * .587 + d[j + 2] * .114);
          t += df * df;
        }
        return t;
      } catch (_) { return 0; }
    }

    const STILL = 4.5;      /* mean grey change per pixel: under this = holding still */
    const MOVED = 14;       /* over this = a different card (or the card left) */
    const HAS_CARD = 6;     /* edge energy: under this = nothing in the box */
    const STEADY_TICKS = 5; /* ~100ms each */

    function tick() {
      if (closed || root.querySelector('.inf-sheet') || root.querySelector('.inf-ask')) return;
      const src = guideRect();
      if (!src) return;
      const g = grabSmall(src);
      if (!g) return;
      const d = diff(g, lastSmall);
      lastSmall = g;

      if (needMove) {
        /* The last card is still sitting there. Wait for a real change. */
        if (d > MOVED) { needMove = false; steadyFor = 0; hint('Next card.'); }
        return;
      }
      const present = edges(g) > HAS_CARD;
      if (!present) { steadyFor = 0; root.classList.remove('is-steady'); return; }
      if (d < STILL) steadyFor++; else steadyFor = 0;
      root.classList.toggle('is-steady', steadyFor >= 2);
      if (armed && steadyFor >= STEADY_TICKS && reading < 2) shoot(src);
    }

    async function shoot(src) {
      src = src || guideRect();
      if (!src || closed) return;
      armed = false;
      needMove = true;
      steadyFor = 0;
      root.classList.remove('is-steady');

      /* Three frames, the sharpest bottom strip wins -- same as the one-card
         scanner, same reason: a hand is never completely still. */
      const grab = () => {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(src.sw)); c.height = Math.max(1, Math.round(src.sh));
        c.getContext('2d').drawImage(video, src.sx, src.sy, src.sw, src.sh, 0, 0, c.width, c.height);
        return { canvas: c, score: sharpness(src) };
      };
      const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
      let best = grab();
      for (let i = 0; i < 2; i++) { await nextFrame(); await nextFrame(); const n = grab(); if (n.score > best.score) best = n; }

      root.classList.add('is-flash');
      setTimeout(() => root.classList.remove('is-flash'), 300);
      try { navigator.vibrate && navigator.vibrate(30); } catch (_) {}

      const row = { key: 'r' + Date.now() + Math.random().toString(36).slice(2, 6), name: 'Reading…', busy: true, qty: 1, lang: mode, cands: [] };
      st.rows.push(row);
      paint();
      armed = true;             /* the next card can be shot while this one reads */
      read(row, best.canvas);
    }
    q('[data-shoot]').addEventListener('click', () => { if (reading < 2) shoot(); });

    /* ---- reading a frame and finding the card ---------------------------- */
    async function read(row, canvas) {
      reading++;
      root.classList.add('is-reading');
      state('Reading…');
      let dataUrl = null;
      try {
        const lim = 1600;
        const s = Math.min(1, lim / Math.max(canvas.width, canvas.height));
        let c = canvas;
        if (s < 1) {
          c = document.createElement('canvas');
          c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
          c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
        }
        dataUrl = c.toDataURL('image/jpeg', 0.82);
      } catch (_) {}
      row.photo = dataUrl;

      let data = null;
      try {
        const db = sb();
        if (db && dataUrl) {
          const res = await db.functions.invoke('scan-card', { body: { image: dataUrl, mode } });
          if (!res.error) data = res.data;
        }
      } catch (_) {}

      try {
        await identify(row, data);
      } catch (_) {
        row.pick = true; row.name = 'Could not read it';
      }
      row.busy = false;
      reading--;
      if (!reading) { root.classList.remove('is-reading'); state('Camera on'); }
      if (closed) return;

      /* THE SAME CARD, ON PURPOSE. A second copy scanned straight after the
         first stacks onto it rather than making a second line. The scanner
         only fires again after the card MOVED, so this is a deliberate
         second copy, not a double shot. */
      const idx = st.rows.indexOf(row);
      const prev = idx > 0 ? st.rows[idx - 1] : null;
      if (!row.pick && row.id && prev && !prev.pick && prev.id === row.id && typeof prev.price === 'number') {
        prev.qty = (prev.qty || 1) + 1;
        st.rows.splice(idx, 1);
        toast(prev.name + ' ×' + prev.qty, money(prev.price), 'ok');
      } else if (row.pick) {
        toast(row.name === 'Could not read it' ? 'Could not read it. Tap to find it.' : row.name + ': tap to pick', '', 'pick');
      } else {
        toast('Added: ' + row.name, money(row.price) || 'No price', 'ok');
      }
      paint();
    }

    /* Hands the row an identity, or marks it for a pick. All the finding is
       collection.js; this only decides what "sure enough" means for a
       stack, which is: one card, clearly ahead of whatever is second. */
    async function identify(row, data) {
      const C = col();
      const lines = (data && data.lines) || [];
      const number = data && data.available && data.matched && data.cardNumber ? String(data.cardNumber) : null;
      const name = data && data.available && data.matched && data.name ? String(data.name) : null;
      row.readName = name; row.readNumber = number;

      let hits = [];
      let sure = false;

      if (number) {
        let found = null;
        try { found = await C.lookupByNumber(number, mode); } catch (_) {}
        const results = (found && found.results || []).filter(h => h && h.card);
        if (results.length === 1 && !found.setTotalMissed) { hits = results; sure = true; }
        else if (results.length > 1) {
          /* More than one card carries that number. The rest of what the
             camera read (HP, attacks, the set total) picks between them. */
          let ranked = null;
          try { ranked = C.rankCandidates(results, lines); } catch (_) {}
          if (ranked && ranked.ranked.length) { hits = ranked.ranked; sure = !!ranked.sure; }
          else hits = results;
          /* A name that agrees with the top hit settles a tie the signals
             could not. */
          if (!sure && name && hits[0] && hits[0].card && String(hits[0].card.name || '').toLowerCase() === name.toLowerCase()
              && !(hits[1] && hits[1].card && String(hits[1].card.name || '').toLowerCase() === name.toLowerCase())) sure = true;
        }
      }
      if (!hits.length && name) {
        let r = null;
        try { r = await C.findCardFromScan(name, lines, mode); } catch (_) {}
        if (r && r.ranked && r.ranked.length) {
          hits = r.ranked; sure = !!r.sure;
          /* findCardFromScan does not price; price the ones that are shown. */
          hits.slice(0, 6).forEach(h => { if (typeof h.amount !== 'number' && h.card) { try { h.amount = C.bestUsdValue(h.card, fx).amount; } catch (_) {} } });
        } else {
          let byName = null;
          try { byName = await C.lookupByName(name, mode); } catch (_) {}
          hits = (byName && byName.results || []).filter(h => h && h.card);
          sure = false;
        }
      }

      if (!hits.length) {
        row.pick = true;
        row.name = name ? name : 'Could not read it';
        row.cands = [];
        return;
      }
      const top = briefOf(hits[0], mode);
      row.cands = hits.slice(0, 6).map(h => briefOf(h, mode));
      row.id = top.id; row.lang = top.lang; row.name = top.name; row.set = top.set; row.num = top.num; row.img = top.img;
      row.price = top.price; row.card = top.card;
      /* A sure read with no price is still a pick: a card on a stack with
         "No price" is a number Jeff cannot add up. */
      row.pick = !sure || typeof top.price !== 'number';
    }

    /* ---- fix a card ----------------------------------------------------- */
    let sheet = null;
    function closeSheet(fromBack) {
      if (!sheet) return false;
      sheet.remove(); sheet = null;
      return true;
    }
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-row]');
      if (!b) return;
      const row = st.rows.find(r => r.key === b.getAttribute('data-row'));
      if (row && !row.busy) openFix(row);
    });

    function choiceHtml(c, on) {
      const price = money(c.price);
      return `
        <button type="button" class="inf-choice${on ? ' on' : ''}" data-choice="${esc(c.id)}" data-lang="${esc(c.lang || mode)}">
          <span class="inf-art">${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy">` : ''}</span>
          <span class="inf-body"><strong>${esc(c.name)}</strong><small>${esc([c.set, c.num].filter(Boolean).join(' · '))}</small></span>
          <span class="inf-price${price ? '' : ' is-none'}">${price ? esc(price) : 'No price'}</span>
        </button>`;
    }

    function openFix(row) {
      closeSheet();
      sheet = document.createElement('div');
      sheet.className = 'inf-sheet';
      const cands = row.cands || [];
      sheet.innerHTML = `
        <div>
          <span class="inf-grip"></span>
          <div class="inf-head">
            <span class="inf-art" data-fix-art>${row.img ? `<img src="${esc(row.img)}" alt="">` : (row.photo ? `<img src="${esc(row.photo)}" alt="">` : '')}</span>
            <div>
              <h2 data-fix-name>${esc(row.name)}</h2>
              <div class="inf-sub${row.pick ? ' is-gold' : ''}" data-fix-sub>${row.pick ? (cands.length ? 'Not sure which one. Pick the match.' : 'Could not read it. Search for it below.') : esc([row.set, row.num].filter(Boolean).join(' · '))}</div>
            </div>
            <button type="button" class="inf-x" data-fix-close aria-label="Close">${X_ICON}</button>
          </div>
          <div>
            <div class="inf-lab">${cands.length ? 'Which one is it?' : 'Find it'}</div>
            <div class="inf-choices" data-choices style="margin-top:8px">${cands.map(c => choiceHtml(c, c.id === row.id)).join('')}</div>
            <form class="inf-search" data-search style="margin-top:8px">
              <input name="q" type="text" inputmode="text" autocomplete="off" autocapitalize="none" spellcheck="false"
                     placeholder="${cands.length ? 'None of these? Name or number' : 'Name or number, like Charizard or 4/102'}" aria-label="Search for the card">
              <button type="submit">Find</button>
            </form>
            <div class="inf-more" data-more></div>
          </div>
          <div>
            <label class="inf-lab" for="inf-price-${esc(row.key)}">Price for this card</label>
            <div class="inf-pricebox" style="margin-top:8px">
              <input id="inf-price-${esc(row.key)}" type="text" inputmode="decimal" data-price value="${typeof row.price === 'number' ? row.price.toFixed(2) : ''}" placeholder="0.00">
              <button type="button" data-market ${typeof row.marketPrice === 'number' || typeof row.price === 'number' ? '' : 'disabled'}>Use market</button>
            </div>
          </div>
          <div class="inf-qtyrow">
            <span>How many of this card</span>
            <button type="button" class="inf-pm" data-q="-1" aria-label="One less">−</button>
            <span class="inf-qtyn" data-qty>${row.qty || 1}</span>
            <button type="button" class="inf-pm" data-q="1" aria-label="One more">+</button>
          </div>
          <div class="inf-btns">
            <button type="button" class="is-bad" data-remove>Remove</button>
            <button type="button" class="is-ghost" data-retake>Retake</button>
            <button type="button" class="is-go" data-save>Save</button>
          </div>
        </div>`;
      root.appendChild(sheet);

      let chosen = row.id ? (cands.find(c => c.id === row.id) || null) : null;
      let market = typeof row.marketPrice === 'number' ? row.marketPrice : (chosen && typeof chosen.price === 'number' ? chosen.price : null);
      let qty = row.qty || 1;
      const priceBox = sheet.querySelector('[data-price]');
      const marketBtn = sheet.querySelector('[data-market]');
      const choices = sheet.querySelector('[data-choices]');
      const more = sheet.querySelector('[data-more]');

      function pickChoice(c) {
        chosen = c;
        market = typeof c.price === 'number' ? c.price : null;
        sheet.querySelector('[data-fix-name]').textContent = c.name;
        const sub = sheet.querySelector('[data-fix-sub]');
        sub.textContent = [c.set, c.num].filter(Boolean).join(' · ');
        sub.classList.remove('is-gold');
        const art = sheet.querySelector('[data-fix-art]');
        art.innerHTML = c.img ? `<img src="${esc(c.img)}" alt="">` : '';
        priceBox.value = typeof c.price === 'number' ? c.price.toFixed(2) : '';
        marketBtn.disabled = typeof c.price !== 'number';
        choices.querySelectorAll('[data-choice]').forEach(b => b.classList.toggle('on', b.getAttribute('data-choice') === c.id));
      }
      choices.addEventListener('click', (e) => {
        const b = e.target.closest('[data-choice]');
        if (!b) return;
        const c = (row.cands || []).concat(found).find(x => x.id === b.getAttribute('data-choice'));
        if (c) pickChoice(c);
      });
      let found = [];
      sheet.querySelector('[data-search]').addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = sheet.querySelector('[data-search] input').value.trim();
        if (!text) return;
        more.textContent = 'Looking…';
        const C = col();
        let results = [];
        try {
          const r = await C.lookupBySearch(text, mode);
          if (r && r.briefs && r.briefs.length) {
            const priced = await C.priceBriefs(r.briefs.slice(0, 8), mode);
            results = priced.filter(h => h && h.card);
          }
        } catch (_) {}
        if (!results.length) {
          try { const r = await C.lookupByNumber(text, mode); results = (r && r.results || []).filter(h => h && h.card); } catch (_) {}
        }
        if (!results.length && /[A-Za-z]{3,}/.test(text)) {
          try { const r = await C.lookupByName(text, mode); results = (r && r.results || []).filter(h => h && h.card); } catch (_) {}
        }
        found = results.slice(0, 8).map(h => briefOf(h, mode));
        if (!found.length) { more.textContent = 'Nothing found for "' + text + '". Try the number on the bottom of the card.'; return; }
        more.textContent = found.length + ' found. Tap the right one.';
        choices.innerHTML = found.map(c => choiceHtml(c, false)).join('');
      });

      marketBtn.addEventListener('click', () => { if (typeof market === 'number') priceBox.value = market.toFixed(2); });
      sheet.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
        qty = Math.max(1, Math.min(99, qty + Number(b.getAttribute('data-q'))));
        sheet.querySelector('[data-qty]').textContent = String(qty);
      }));
      sheet.querySelector('[data-fix-close]').addEventListener('click', () => closeSheet());
      sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
      sheet.querySelector('[data-remove]').addEventListener('click', () => {
        st.rows = st.rows.filter(r => r !== row);
        closeSheet(); paint();
      });
      sheet.querySelector('[data-retake]').addEventListener('click', () => {
        st.rows = st.rows.filter(r => r !== row);
        closeSheet(); paint();
        needMove = false; steadyFor = 0; armed = true;
        hint('Hold the card in the box again.');
      });
      sheet.querySelector('[data-save]').addEventListener('click', () => {
        const typed = parseFloat(String(priceBox.value).replace(/[^0-9.]/g, ''));
        if (chosen) {
          row.id = chosen.id; row.lang = chosen.lang; row.name = chosen.name; row.set = chosen.set; row.num = chosen.num; row.img = chosen.img;
          row.card = chosen.card || row.card; row.marketPrice = typeof chosen.price === 'number' ? chosen.price : row.marketPrice;
        }
        if (isFinite(typed) && typed >= 0) { row.price = typed; row.manual = typed !== row.marketPrice; }
        else if (chosen && typeof chosen.price === 'number') row.price = chosen.price;
        row.qty = qty;
        row.pick = !(row.id && typeof row.price === 'number');
        closeSheet(); paint();
      });
    }

    /* ---- done: the total -------------------------------------------------- */
    q('[data-done]').addEventListener('click', openOffer);
    function openOffer() {
      closeSheet();
      const t = totals();
      const unsure = st.rows.filter(r => r.pick).length;
      sheet = document.createElement('div');
      sheet.className = 'inf-sheet';
      sheet.innerHTML = `
        <div>
          <span class="inf-grip"></span>
          <div class="inf-head"><div><h2>The total</h2></div><button type="button" class="inf-x" data-fix-close aria-label="Back to scanning">${X_ICON}</button></div>
          <div class="inf-big">
            <small>Stack value</small>
            <b data-big-total>${esc(money(t.total) || '$0.00')}</b>
            <small>${t.count} card${t.count === 1 ? '' : 's'}${unsure ? ` · <span style="color:#ffc928">${unsure} still need a pick</span>` : ''}</small>
          </div>
          <div class="inf-payrow">
            <div><b>Offer at <span data-pay2>${pay}</span>%</b><small>What a shop paying ${pay}% of market offers · <span data-big-offer>${esc(money(t.offer) || '$0.00')}</span></small></div>
            <button type="button" class="inf-pm" data-p="-5" aria-label="Lower the percentage">−</button>
            <span class="inf-payn" data-payn>${pay}%</span>
            <button type="button" class="inf-pm" data-p="5" aria-label="Raise the percentage">+</button>
          </div>
          <div class="inf-mini">
            ${st.rows.slice().reverse().slice(0, 5).map(r => `<div><span>${esc(r.name)}${(r.qty || 1) > 1 ? ' ×' + r.qty : ''}</span><span>${r.pick ? 'Pick' : esc(money(typeof r.price === 'number' ? r.price * (r.qty || 1) : null) || 'No price')}</span></div>`).join('')}
            ${st.rows.length > 5 ? `<div><span style="color:#9eb0c8">and ${st.rows.length - 5} more above</span><span></span></div>` : ''}
          </div>
          <div class="inf-btns"><button type="button" class="is-gold" data-add-all>Add all to My Stuff</button></div>
          <div class="inf-said" data-said></div>
          <div class="inf-btns">
            <button type="button" class="is-ghost" data-keep>Keep scanning</button>
            <button type="button" class="is-ghost" data-fresh>Start a new stack</button>
          </div>
        </div>`;
      root.appendChild(sheet);
      const said = sheet.querySelector('[data-said]');
      function repaintPay() {
        const t2 = totals();
        sheet.querySelector('[data-payn]').textContent = pay + '%';
        sheet.querySelector('[data-pay2]').textContent = String(pay);
        sheet.querySelector('[data-big-offer]').textContent = money(t2.offer) || '$0.00';
        q('[data-pay]').textContent = String(pay);
        q('[data-offer]').textContent = money(t2.offer) || '$0.00';
        savePay(pay);
      }
      sheet.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => {
        pay = Math.max(10, Math.min(100, pay + Number(b.getAttribute('data-p'))));
        repaintPay();
      }));
      sheet.querySelector('[data-fix-close]').addEventListener('click', () => closeSheet());
      sheet.querySelector('[data-keep]').addEventListener('click', () => closeSheet());
      sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
      sheet.querySelector('[data-fresh]').addEventListener('click', () => {
        rememberStack();
        st = { at: Date.now(), mode, rows: [] };
        clearStack();
        closeSheet(); paint();
        hint('Fresh stack. Hold the first card in the box.');
      });
      sheet.querySelector('[data-add-all]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const C = col();
        const db = sb();
        let user = null;
        try { const s = await db.auth.getSession(); user = s && s.data && s.data.session && s.data.session.user; } catch (_) {}
        if (!user) {
          said.innerHTML = 'Log in to add these to My Stuff. The stack stays right here. <a href="/?page=account" style="color:#19bfff">Log in</a>';
          return;
        }
        const rows = st.rows.filter(r => r.id && !r.pick);
        if (!rows.length) { said.textContent = 'Nothing to add yet. Pick the cards that need a pick first.'; return; }
        btn.disabled = true;
        let n = 0, bad = 0;
        for (const r of rows) {
          said.textContent = 'Adding ' + (n + bad + 1) + ' of ' + rows.length + '…';
          let card = r.card;
          if (!card) { try { card = await C.fetchCardDetail(r.id, r.lang || mode); } catch (_) {} }
          if (!card) { bad++; continue; }
          for (let i = 0; i < (r.qty || 1); i++) {
            try { const res = await C.quickAdd(card, null, i === 0 && r.photo ? { card: r.photo } : null); if (res && res.ok) n++; else bad++; }
            catch (_) { bad++; }
          }
        }
        said.textContent = n + ' card' + (n === 1 ? '' : 's') + ' added to My Stuff' + (bad ? ', ' + bad + ' did not go through' : '') + '.';
        btn.disabled = false;
      });
    }

    /* The stacks before this one, on this phone -- a record of what was
       bought or traded. Small on purpose; the last 30. */
    function rememberStack() {
      if (!st.rows.length) return;
      try {
        const t = totals();
        const saved = JSON.parse(localStorage.getItem(KEY_SAVED) || '[]');
        saved.unshift({ at: Date.now(), count: t.count, total: t.total, pay, offer: t.offer,
          rows: st.rows.map(r => ({ name: r.name, set: r.set, num: r.num, price: r.price, qty: r.qty || 1 })) });
        localStorage.setItem(KEY_SAVED, JSON.stringify(saved.slice(0, 30)));
      } catch (_) {}
    }

    /* ---- leaving with cards on the list ----------------------------------- */
    function askLeave() {
      const ask = document.createElement('div');
      ask.className = 'inf-ask';
      ask.innerHTML = `<div>
        <h3>Leave the scanner?</h3>
        <p>Your ${st.rows.length} card${st.rows.length === 1 ? '' : 's'} stay saved on this phone. They will be here when you come back.</p>
        <div class="inf-btns"><button type="button" class="is-ghost" data-stay>Stay</button><button type="button" class="is-go" data-go>Leave</button></div>
      </div>`;
      root.appendChild(ask);
      ask.querySelector('[data-stay]').addEventListener('click', () => ask.remove());
      ask.querySelector('[data-go]').addEventListener('click', () => { ask.remove(); if (!(backReg && backReg.pop('infinite'))) close(); });
    }

    /* ---- a stack from before -------------------------------------------- */
    const old = loadStack();
    if (old && old.rows.length) {
      const ask = document.createElement('div');
      ask.className = 'inf-ask';
      const sum = old.rows.reduce((n, r) => n + (!r.pick && typeof r.price === 'number' ? r.price * (r.qty || 1) : 0), 0);
      const cnt = old.rows.reduce((n, r) => n + (r.qty || 1), 0);
      ask.innerHTML = `<div>
        <h3>You have a stack from before</h3>
        <p>${cnt} card${cnt === 1 ? '' : 's'}, ${esc(money(sum) || '$0.00')}. Keep going with it, or start fresh?</p>
        <div class="inf-btns"><button type="button" class="is-ghost" data-fresh>Start fresh</button><button type="button" class="is-go" data-keep>Keep going</button></div>
      </div>`;
      root.appendChild(ask);
      ask.querySelector('[data-keep]').addEventListener('click', () => { st = old; ask.remove(); paint(); });
      ask.querySelector('[data-fresh]').addEventListener('click', () => { st = old; rememberStack(); st = { at: Date.now(), mode, rows: [] }; clearStack(); ask.remove(); paint(); });
    } else {
      paint();
    }

    /* First time: one line, once. */
    try {
      if (!localStorage.getItem(KEY_TIP)) {
        hint('First time? Hold a card in the box and keep still for a second. Swap cards and it keeps going.');
        localStorage.setItem(KEY_TIP, '1');
      }
    } catch (_) {}

    loopTimer = setInterval(tick, 100);
  }

  /* The door styles have to be there before anybody opens the camera. */
  if (document.head) injectCss(); else document.addEventListener('DOMContentLoaded', injectCss);

  window.InfinitePullsInfiniteScanner = { open };
})();
