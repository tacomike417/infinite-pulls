/* HYDE-BOT — post a picture to Infinite Pulls, then send it to Facebook.

   Built for one person standing behind a counter with an iPhone. One screen,
   one thing at a time, and the picture is never touched: what Jeff made in
   ChatGPT is exactly what goes up, no crop, no resize, no watermark.

   IT POSTS AS THE SIGNED-IN ACCOUNT. Same Supabase session as the rest of
   infinitepulls.com, same origin, so being signed in on the feed means being
   signed in here. */
(function () {
  'use strict';

  var cfg = window.InfinitePullsConfig || {};
  var CP  = window.InfinitePullsCardPhoto || null;
  var AUTH_KEY = 'infinite-pulls-app-auth';   /* must match feed-next/feed.js */

  var sb = null;
  try {
    var shared = window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
    if (shared) sb = shared;
    else if (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { storageKey: AUTH_KEY, persistSession: true,
                autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
  } catch (e) { sb = null; }
  if (sb && !window.InfinitePullsSupabase) {
    window.InfinitePullsSupabase = { client: sb, ready: true };
  }

  var $ = function (id) { return document.getElementById(id); };
  var stepPick = $('stepPick'), stepDone = $('stepDone'), stepOut = $('stepOut');
  var file = $('file'), preview = $('preview'), repick = $('repick');
  var caption = $('caption'), post = $('post'), hint = $('hint');
  var donePic = $('donePic'), doneLead = $('doneLead');
  var toFacebook = $('toFacebook'), fbHint = $('fbHint');
  var seeIt = $('seeIt'), again = $('again'), toastEl = $('toast');

  var picked = null;     /* the File exactly as it came off the phone */
  var made = null;       /* { id, imageUrl, link, caption } once posted */
  var me = null;
  var myHandle = null;   /* the public username posts are filed under */

  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3200);
  }
  function show(which) {
    stepPick.hidden = which !== 'pick';
    stepDone.hidden = which !== 'done';
    stepOut.hidden  = which !== 'out';
    window.scrollTo(0, 0);
  }

  /* ---- who is this ------------------------------------------------------- */
  (async function start() {
    if (!sb) { show('out'); return; }
    try {
      var s = await sb.auth.getSession();
      me = s && s.data && s.data.session ? s.data.session.user : null;
    } catch (e) { me = null; }
    if (!me) { show('out'); return; }
    show('pick');
    await checkProfile();
  })();

  /* ---- CAN THIS ACCOUNT ACTUALLY BE SEEN --------------------------------
     A photo row is only readable by anybody else when its owner has a
     PUBLIC PROFILE -- that is the rule the whole site runs on. An account
     with no profile row, or a private one, can still post: the row saves,
     the picture uploads, Facebook takes it, and the link lands on a post
     nobody but the poster can open. It looks like it worked, and it did
     not. So it is checked once, up front, and posting is shut off with a
     reason rather than failing silently afterwards. */
  async function checkProfile() {
    if (!sb || !me) return;
    var row = null;
    try {
      var out = await sb.from('profiles').select('username, is_public').eq('id', me.id).maybeSingle();
      row = out && out.data;
    } catch (e) { return; }      /* a network hiccup is not a verdict */

    if (!row) { blockPosting('This account has no profile on Infinite Pulls yet, so nothing it posts would show up. Open infinitepulls.com, sign in as this account and pick a username first.'); return; }
    if (row.is_public === false) { blockPosting('This account is set to private, so its posts are hidden from everybody else. Turn the profile public on infinitepulls.com, then come back.'); return; }
    if (row.username && /^[A-Za-z0-9_-]{3,24}$/.test(row.username)) myHandle = row.username;
  }

  function blockPosting(why) {
    post.disabled = true;
    post.dataset.blocked = '1';
    hint.textContent = why;
    hint.classList.add('bad');
  }

  /* ---- signing in, in the app itself --------------------------------------
     An installed app on an iPhone has its own storage. Signing in on the
     website does not sign you in here, so the form lives here. */
  var signInForm = document.getElementById('signInForm');
  if (signInForm) {
    signInForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = document.getElementById('signIn');
      var email = (document.getElementById('email').value || '').trim();
      var pw = document.getElementById('pw').value || '';
      if (!email || !pw || !sb) return;
      btn.disabled = true; btn.classList.add('busy'); btn.textContent = 'Signing in\u2026';
      try {
        var out = await sb.auth.signInWithPassword({ email: email, password: pw });
        if (out.error) throw new Error(out.error.message || 'That did not work.');
        me = out.data && out.data.user;
        document.getElementById('pw').value = '';
        show('pick');
        await checkProfile();
      } catch (err) {
        toast((err && err.message) || 'Wrong email or password.');
      } finally {
        btn.disabled = false; btn.classList.remove('busy'); btn.textContent = 'Sign in';
      }
    });
  }

  /* ---- 1. pick ----------------------------------------------------------- */
  file.addEventListener('change', function () {
    var f = file.files && file.files[0];
    if (!f) return;
    /* A picture off the camera roll can be 10MB+. That is fine -- it goes up
       as it is on purpose -- but the worker has to be willing to take it, so
       anything enormous is worth saying out loud rather than failing later. */
    if (f.size > 20 * 1024 * 1024) {
      toast('That picture is over 20MB. Try a smaller one.');
      return;
    }
    picked = f;
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(f);
    preview.hidden = false;
    repick.hidden = false;
    $('dropLabel').hidden = true;
    post.disabled = post.dataset.blocked === '1';
  });

  repick.addEventListener('click', function () {
    picked = null;
    preview.hidden = true;
    repick.hidden = true;
    $('dropLabel').hidden = false;
    post.disabled = true;
    file.value = '';
  });

  /* ---- 2. post it -------------------------------------------------------- */
  post.addEventListener('click', async function () {
    if (!picked || !me) return;
    if (post.dataset.blocked === '1') { toast(hint.textContent); return; }
    post.disabled = true;
    post.classList.add('busy');
    post.textContent = 'Posting…';

    try {
      if (!CP || !CP.ready()) throw new Error('Photo storage is not switched on (CARD_PHOTO_BASE).');

      /* UPLOADED WHOLE. CP.shrink() is deliberately NOT called: this is his
         finished poster, and a resize is exactly the thing he asked nobody
         to do to it. */
      var key = await CP.upload(picked, 'hyde-' + Date.now());
      if (!key) throw new Error('The picture would not upload. Check your signal and try again.');

      var row = await sb.from('user_photos')
        .insert({ user_id: me.id, object_key: key, caption: (caption.value || '').trim() || null })
        .select('id, caption')
        .single();
      if (row.error) throw new Error(row.error.message || 'The post would not save.');

      /* The address of this exact post, the one that goes in the Facebook
         caption. Built the same way feed.js builds it. */
      /* checkProfile() already read it at sign-in, and posting is shut off
         when there is no public profile -- so by here there is a real
         username and no second round trip is needed. */
      var who = myHandle || 'collector';

      made = {
        id: row.data.id,
        caption: (caption.value || '').trim(),
        imageUrl: CP.urlFor(key),
        link: location.origin + '/' + who + '/post/p-' + row.data.id
      };

      donePic.src = preview.src;
      donePic.hidden = false;
      seeIt.href = made.link;
      show('done');
    } catch (e) {
      toast((e && e.message) || 'That did not go through.');
    } finally {
      post.classList.remove('busy');
      post.textContent = 'Post it';
      post.disabled = !picked || post.dataset.blocked === '1';
    }
  });

  /* ---- 3. and on to Facebook --------------------------------------------- */
  toFacebook.addEventListener('click', async function () {
    if (!made) return;
    toFacebook.disabled = true;
    toFacebook.classList.add('busy');
    var was = toFacebook.innerHTML;
    toFacebook.textContent = 'Sending…';

    try {
      var s = await sb.auth.getSession();
      var token = s && s.data && s.data.session && s.data.session.access_token;
      if (!token) throw new Error('Signed out. Open Infinite Pulls and sign in again.');

      var r = await fetch(cfg.SUPABASE_URL + '/functions/v1/post-to-facebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ imageUrl: made.imageUrl, caption: made.caption, link: made.link })
      });
      var out = null;
      try { out = await r.json(); } catch (e) {}
      if (!r.ok) throw new Error((out && out.error) || ('Facebook said no (' + r.status + ').'));

      toFacebook.textContent = '✓ On Facebook';
      fbHint.textContent = 'Posted to the page with the link underneath.';
    } catch (e) {
      toFacebook.innerHTML = was;
      toFacebook.disabled = false;
      toast((e && e.message) || 'Facebook did not take it.');
    } finally {
      toFacebook.classList.remove('busy');
    }
  });

  /* ---- and round again ---------------------------------------------------- */
  again.addEventListener('click', function () {
    made = null;
    picked = null;
    caption.value = '';
    file.value = '';
    preview.hidden = true;
    repick.hidden = true;
    donePic.hidden = true;
    $('dropLabel').hidden = false;
    post.disabled = true;
    toFacebook.disabled = false;
    toFacebook.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z"/></svg> Share to Facebook';
    fbHint.textContent = 'Goes up on the shop’s page with the link to this post.';
    show('pick');
  });

  /* ---- keep it on your home screen ---------------------------------------
     A week of quiet after a no, and never a word once it is installed. */
  (function installCard() {
    var modal = document.getElementById('installModal');
    if (!modal) return;
    var go = document.getElementById('installGo');
    var no = document.getElementById('installNo');
    var txt = document.getElementById('installText');
    var steps = document.getElementById('installSteps');
    var KEY = 'hyde-install-asked';
    var WEEK = 7 * 24 * 60 * 60 * 1000;
    var deferred = null;

    var standalone = window.matchMedia('(display-mode: standalone)').matches ||
                     window.navigator.standalone === true;
    var iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    function asked() {
      try {
        var v = localStorage.getItem(KEY);
        if (v === 'installed') return Infinity;
        return v ? Number(v) + WEEK : 0;
      } catch (e) { return 0; }
    }
    function remember(v) { try { localStorage.setItem(KEY, v || String(Date.now())); } catch (e) {} }

    function open() {
      if (!modal.hidden || standalone) return;
      if (!deferred && !iOS) {
        txt.textContent = 'Open your browser\u2019s menu and choose Install, or Add to Home Screen.';
        go.hidden = true;
      }
      modal.hidden = false;
      document.body.classList.add('asking');
    }
    function shut(remember_it) {
      modal.hidden = true;
      document.body.classList.remove('asking');
      if (remember_it) remember();
    }

    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-install-no]')) shut(true);
    });
    no.addEventListener('click', function () { shut(true); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) shut(true);
    });
    go.addEventListener('click', function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function (res) {
        deferred = null;
        shut(!res || res.outcome !== 'accepted');
      });
    });
    window.addEventListener('appinstalled', function () { shut(false); remember('installed'); });

    if (standalone || Date.now() < asked()) return;
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); deferred = e; setTimeout(open, 2200);
    });
    if (iOS) { steps.hidden = false; go.hidden = true; setTimeout(open, 2200); }
  })();

  /* Network first, so a deploy is live on the next open. */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () {});
    });
  }
})();
