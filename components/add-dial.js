/* =============================================================================
   THE ADD BUTTON -- a speed dial (27 Sep 2026, Mike).

   The gold + in the middle of the bottom bar used to go straight into the
   card camera, and then into a camera with three modes on top of it. One
   door leading to two different things is wrong half the time whichever
   one it opens on. So the + says ADD, and tapping it fans out the two
   things it can mean:

        [ Scan card ]            [ Make a post ]
                     \          /
                      (  ADD  )

     SCAN CARD    -> the card scanner, and only the card scanner.
     MAKE A POST  -> the phone's OWN picture chooser, straight away. Memes,
                     screenshots and saved pictures come first (Mike's gut:
                     people post memes more than selfies); "Take Photo" is
                     still one of the phone's own options. Then a preview,
                     a caption and SHARE. Nothing posts until SHARE.

   Works the same on the feed and on the older pages -- both load this file.
   The phone's back button closes whatever this put up (one entry for the
   dial and the post screen together), and backing out of the phone's
   chooser lands you right where you were.
   ========================================================================== */
(function () {
  'use strict';


  /* ---- its own look, so it is the same on every page that loads it ---- */
  const CSS = `
html.adddial-lock{overflow:hidden}
.adddial{position:fixed;inset:0;z-index:9000;pointer-events:none}
.adddial .ad-dim{position:absolute;inset:0;background:rgba(2,4,10,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);
  opacity:0;transition:opacity .2s ease;pointer-events:auto}
.adddial.open .ad-dim{opacity:1}
.adddial .ad-burst{position:absolute;left:var(--cx);top:var(--cy);width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;
  border:3px solid #ffc13d;opacity:0;transform:scale(.6)}
.adddial.open .ad-burst{animation:ad-burst .55s ease-out}
@keyframes ad-burst{0%{opacity:.9;transform:scale(.6)}100%{opacity:0;transform:scale(3.2)}}
.adddial .ad-opt{position:absolute;left:var(--cx);top:var(--cy);width:120px;margin-left:-60px;margin-top:-37px;padding:0;border:0;background:none;
  display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;pointer-events:auto;
  transform:translate(0,0) scale(.2);opacity:0;
  transition:transform .42s cubic-bezier(.2,1.6,.35,1),opacity .18s ease}
.adddial.open .ad-scan{transform:translate(-92px,-128px) scale(1);opacity:1;transition-delay:.02s}
.adddial.open .ad-post{transform:translate(92px,-128px) scale(1);opacity:1;transition-delay:.08s}
.adddial .ad-bubble{width:74px;height:74px;border-radius:50%;display:grid;place-items:center;
  box-shadow:0 10px 30px rgba(0,0,0,.45),0 0 0 4px rgba(255,255,255,.08);transition:transform .12s}
.adddial .ad-opt:active .ad-bubble{transform:scale(.9)}
.adddial .ad-scan .ad-bubble{background:linear-gradient(145deg,#2a6df4,#1947b3);color:#fff}
.adddial .ad-post .ad-bubble{background:linear-gradient(145deg,#ffd23f,#ff9a1f);color:#1b1400}
.adddial .ad-bubble svg{width:34px;height:34px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.adddial .ad-opt b{padding:5px 11px;border-radius:999px;background:#fff;color:#0d1725;white-space:nowrap;
  font:900 14px/1 system-ui,-apple-system,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.35);
  opacity:0;transform:translateY(-6px);transition:opacity .2s ease .18s,transform .2s ease .18s}
.adddial.open .ad-opt b{opacity:1;transform:none}
.adddial .ad-say{position:absolute;left:16px;right:16px;bottom:calc(100% - var(--cy) + 190px);margin:0;padding:12px 14px;border-radius:12px;
  background:#fff;color:#0d1725;text-align:center;font:700 14px/1.4 system-ui,sans-serif;pointer-events:auto}
.adddial .ad-say a{color:#8a5a06;font-weight:900}
.adddial .ad-say[hidden]{display:none}
/* THE + BECOMES AN X, drawn crisp on top of the dim right where the + is
   (the bar itself sits under the dim, so it is redrawn here). */
.adddial .ad-x{position:absolute;left:var(--cx);top:var(--cy);width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;
  border:3px solid #ffc13d;background:#04070f;color:#ffc13d;display:grid;place-items:center;cursor:pointer;pointer-events:auto;
  box-shadow:0 0 0 6px rgba(255,193,61,.15),0 8px 24px rgba(0,0,0,.5)}
.adddial .ad-x svg{width:28px;height:28px;fill:none;stroke:currentColor;stroke-width:2.8;stroke-linecap:round;
  transition:transform .35s cubic-bezier(.2,1.6,.35,1)}
.adddial.open .ad-x svg{transform:rotate(135deg)}
/* the post screen */
.addpost{position:fixed;inset:0;z-index:9002;background:#000;color:#fff;display:flex;flex-direction:column}
.addpost .ap-top{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:calc(10px + env(safe-area-inset-top)) 14px 10px;
  border-bottom:1px solid rgba(255,255,255,.12)}
.addpost .ap-top b{font:800 16px/1 system-ui,sans-serif}
.addpost .ap-cancel{justify-self:start;border:0;background:none;color:#fff;font:600 15px/1 system-ui,sans-serif;cursor:pointer;padding:8px 0}
.addpost .ap-share-top{justify-self:end;border:0;background:none;color:#ffc13d;font:900 15px/1 system-ui,sans-serif;cursor:pointer;padding:8px 0}
.addpost .ap-pic{flex:1;min-height:0;display:grid;place-items:center;background:#0a0a0a}
.addpost .ap-pic img{max-width:100%;max-height:100%;object-fit:contain;display:block}
.addpost .ap-body{flex:0 0 auto;padding:12px 14px calc(14px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:10px}
.addpost .ap-cap{width:100%;box-sizing:border-box;resize:none;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.2);
  background:#111;color:#fff;font:500 16px/1.4 system-ui,sans-serif}
.addpost .ap-change{align-self:flex-start;border:0;background:none;color:rgba(255,255,255,.75);text-decoration:underline;
  font:600 13px/1 system-ui,sans-serif;cursor:pointer;padding:2px 0}
.addpost .ap-say{margin:0;color:#fca5a5;font:700 13px/1.4 system-ui,sans-serif}
.addpost .ap-say[hidden]{display:none}
.addpost .ap-share{padding:16px;border:0;border-radius:14px;background:#ffc13d;color:#1b1400;cursor:pointer;
  font:900 18px/1 system-ui,sans-serif;letter-spacing:.06em;box-shadow:0 5px 0 #c98a00}
.addpost .ap-share:disabled,.addpost .ap-share-top:disabled{opacity:.6}
@media (prefers-reduced-motion:reduce){.adddial .ad-opt,.adddial .ad-opt b,a.scan i svg{transition:none}.adddial.open .ad-burst{animation:none}}
`;
  (function injectStyle() {
    if (document.getElementById('add-dial-css')) return;
    const st = document.createElement('style');
    st.id = 'add-dial-css';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  })();

  const sb = () => window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
  const CP = () => window.InfinitePullsCardPhoto;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* WHICH BACK STACK. The feed has its own (feed.js exposes it as
     InfinitePullsFeedBack); the older pages have app.js's. One of them is
     always here; with neither, the layer still opens and closes by its own
     controls. */
  const backReg = () => window.InfinitePullsFeedBack || window.InfinitePullsBack || null;

  let layer = null;          /* null | 'dial' | 'picking' | 'post' */
  let pushed = false;
  let dialEl = null, postEl = null, anchor = null;
  let signedIn = null;       /* asked when the dial opens, so the tap on
                                MAKE A POST can open the chooser at once --
                                a chooser has to open inside the tap itself */

  function whoIsIn() {
    const c = sb();
    if (!c) { signedIn = false; return Promise.resolve(false); }
    return c.auth.getSession()
      .then(({ data }) => (signedIn = !!(data && data.session && data.session.user)))
      .catch(() => (signedIn = false));
  }

  /* ---- the one closer ------------------------------------------------------ */
  function closeAll() {
    layer = null;
    if (dialEl) { const d = dialEl; dialEl = null; d.classList.remove('open'); setTimeout(() => d.remove(), 220); }
    if (postEl) { postEl.remove(); postEl = null; }
    if (anchor) anchor.classList.remove('dial-open');
    document.documentElement.classList.remove('adddial-lock');
  }

  function openLayer() {
    if (pushed) return;
    const r = backReg();
    if (r && typeof r.push === 'function') {
      pushed = true;
      r.push('adddial', () => { pushed = false; closeAll(); });
    }
  }

  /* Every deliberate way out goes through here, so the back entry comes off
     with it. */
  function leave() {
    const r = backReg();
    if (pushed && r && typeof r.pop === 'function') { r.pop('adddial'); return; }
    pushed = false;
    closeAll();
  }

  /* ---- the dial -------------------------------------------------------------- */
  const SCAN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M3 8V5a2 2 0 0 1 2-2M21 8V5a2 2 0 0 0-2-2M3 16v3a2 2 0 0 0 2 2M21 16v3a2 2 0 0 1-2 2"/><path d="M9 15h6"/></svg>';
  const POST_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>';

  function openDial(a) {
    if (layer) { leave(); return; }         /* a second tap on ADD closes it */
    anchor = a;
    layer = 'dial';
    whoIsIn();
    const r = a.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    /* the middle of the gold ring, not of the whole link with its label */
    const ring = a.querySelector('i') || a;
    const rr = ring.getBoundingClientRect();
    const cy = rr.top + rr.height / 2;

    dialEl = document.createElement('div');
    dialEl.className = 'adddial';
    dialEl.setAttribute('role', 'dialog');
    dialEl.setAttribute('aria-label', 'Add');
    dialEl.style.setProperty('--cx', cx + 'px');
    dialEl.style.setProperty('--cy', cy + 'px');
    dialEl.innerHTML = `
      <div class="ad-dim" data-ad-close></div>
      <span class="ad-burst" aria-hidden="true"></span>
      <button type="button" class="ad-x" data-ad-close aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
      <button type="button" class="ad-opt ad-scan" data-ad="scan">
        <span class="ad-bubble">${SCAN_ICON}</span><b>Scan card</b>
      </button>
      <button type="button" class="ad-opt ad-post" data-ad="post">
        <span class="ad-bubble">${POST_ICON}</span><b>Make a post</b>
      </button>
      <p class="ad-say" hidden></p>`;
    document.body.appendChild(dialEl);
    a.classList.add('dial-open');
    openLayer();
    /* next frame, so the fan-out actually animates from the button */
    requestAnimationFrame(() => requestAnimationFrame(() => dialEl && dialEl.classList.add('open')));

    dialEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-ad-close]')) { leave(); return; }
      const b = e.target.closest('[data-ad]');
      if (!b) return;
      if (b.getAttribute('data-ad') === 'scan') return goScan();
      return goPost();
    });
  }

  function goScan() {
    /* Leaving the page: the back entry is left as it is (same address,
       invisible) rather than popped, so the pop cannot race the trip. */
    closeAll();
    pushed = false;
    location.href = '/?page=lookup&scan=1';
  }

  /* ---- MAKE A POST -------------------------------------------------------- */
  let picker = null;

  function goPost() {
    if (signedIn === false) {
      if (typeof window.InfinitePullsJoin === 'function') {
        leave();
        setTimeout(() => window.InfinitePullsJoin('Sign up free to post your pulls, memes and pics.'), 60);
        return;
      }
      const say = dialEl && dialEl.querySelector('.ad-say');
      if (say) { say.hidden = false; say.innerHTML = 'Sign up free to post. <a href="/?page=account">Let&rsquo;s go</a>'; }
      return;
    }
    /* THE PHONE'S OWN CHOOSER, opened inside this very tap -- phones refuse
       to open it from anywhere else. No `capture` attribute on purpose: that
       would force the camera, and the whole point is that the pictures
       already on the phone come first. */
    if (!picker) {
      picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = 'image/*';
      picker.style.display = 'none';
      document.body.appendChild(picker);
      picker.addEventListener('change', () => {
        if (layer !== 'picking') return;        /* "pick a different picture" has its own */
        const f = picker.files && picker.files[0];
        picker.value = '';
        if (!f) { if (layer === 'picking') leave(); return; }
        const fr = new FileReader();
        fr.onload = () => openPost(String(fr.result || ''));
        fr.onerror = () => leave();
        fr.readAsDataURL(f);
      });
      /* Backed out of the chooser: back where they were. */
      picker.addEventListener('cancel', () => { if (layer === 'picking') leave(); });
    }
    layer = 'picking';
    if (dialEl) { const d = dialEl; dialEl = null; d.classList.remove('open'); setTimeout(() => d.remove(), 200); }
    if (anchor) anchor.classList.remove('dial-open');
    picker.click();
    /* Browsers without the cancel event: when the page gets focus back and
       nothing was picked, treat it as backing out. */
    const onFocus = () => {
      window.removeEventListener('focus', onFocus);
      setTimeout(() => { if (layer === 'picking' && !(picker.files && picker.files.length)) leave(); }, 900);
    };
    window.addEventListener('focus', onFocus);
  }

  function openPost(dataUrl) {
    if (!dataUrl) { leave(); return; }
    layer = 'post';
    document.documentElement.classList.add('adddial-lock');
    postEl = document.createElement('div');
    postEl.className = 'addpost';
    postEl.setAttribute('role', 'dialog');
    postEl.setAttribute('aria-label', 'New post');
    postEl.innerHTML = `
      <header class="ap-top">
        <button type="button" class="ap-cancel" data-ap-cancel>Cancel</button>
        <b>New post</b>
        <button type="button" class="ap-share-top" data-ap-share>Share</button>
      </header>
      <div class="ap-pic"><img alt="" src="${esc(dataUrl)}"></div>
      <div class="ap-body">
        <textarea class="ap-cap" maxlength="500" rows="3"
          placeholder="Say something about it… tag people with @"></textarea>
        <button type="button" class="ap-change" data-ap-change>Pick a different picture</button>
        <p class="ap-say" hidden></p>
        <button type="button" class="ap-share" data-ap-share>SHARE</button>
      </div>`;
    document.body.appendChild(postEl);
    let pending = dataUrl;

    postEl.addEventListener('click', async (e) => {
      if (e.target.closest('[data-ap-cancel]')) { leave(); return; }
      if (e.target.closest('[data-ap-change]')) {
        /* same chooser, same tap rule */
        const once = () => {
          picker.removeEventListener('change', once, true);
          const f = picker.files && picker.files[0];
          if (!f) return;
          const fr = new FileReader();
          fr.onload = () => {
            pending = String(fr.result || '');
            const img = postEl && postEl.querySelector('.ap-pic img');
            if (img) img.src = pending;
          };
          fr.readAsDataURL(f);
        };
        picker.addEventListener('change', once, true);
        picker.click();
        return;
      }
      const shareBtn = e.target.closest('[data-ap-share]');
      if (!shareBtn) return;
      const say = (m) => { const p = postEl && postEl.querySelector('.ap-say'); if (p) { p.hidden = !m; p.textContent = m || ''; } };
      const btns = [...postEl.querySelectorAll('[data-ap-share]')];
      if (btns.some(b => b.disabled)) return;
      const cp = CP(), c = sb();
      if (!cp || !cp.ready()) { say('Photo storage is not set up yet.'); return; }
      if (!c) { say('Not connected right now.'); return; }
      btns.forEach(b => { b.disabled = true; });
      postEl.querySelector('.ap-share').textContent = 'SHARING…';
      say('');
      try {
        const { data: { session } } = await c.auth.getSession();
        const user = session && session.user;
        if (!user) throw new Error('Sign in to post.');
        const key = await cp.keep(pending, 'me');
        if (!key) throw new Error('The upload was refused. Try again in a moment.');
        const caption = (postEl.querySelector('.ap-cap').value || '').trim() || null;
        const { data: made, error } = await c.from('user_photos')
          .insert({ user_id: user.id, object_key: key, caption })
          .select('id').single();
        if (error) throw new Error(error.message || 'Could not save it.');
        /* The payoff: land on the post they just made. The back entry is
           left alone -- this is a trip, and the pop would race it. */
        pushed = false;
        closeAll();
        location.href = '/feed-next/?post=p-' + encodeURIComponent(made.id);
      } catch (err) {
        say((err && err.message) || 'That did not work. Try again.');
        btns.forEach(b => { b.disabled = false; });
        const big = postEl && postEl.querySelector('.ap-share');
        if (big) big.textContent = 'SHARE';
      }
    });
  }

  /* ---- the ADD button, wherever it is -------------------------------------
     Caught in the capture phase, before the older pages' router sees the
     click and navigates. The link underneath still goes to the scanner if
     this file never loads. */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a.scan');
    if (!a || !a.closest('nav, #navbar, .nav')) return;
    e.preventDefault();
    e.stopPropagation();
    openDial(a);
  }, true);

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && layer) leave(); });

  window.InfinitePullsAddDial = { open: openDial, close: leave };
})();
