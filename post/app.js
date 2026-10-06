/* HYDE-BOT — post a picture to Infinite Pulls, then send it to Facebook.
   v3 (6 Oct 2026): a second tab, VIDEOS. The Loops the shop account posts
   come here one at a time for Jeff to put on TikTok and YouTube himself.
   It is the same share_desk table the Share Desk page ticks, so the two
   always agree. Needs supabase/share_desk_jeff.sql.

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
  var toInstagram = $('toInstagram'), igHint = $('igHint');
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
  var stepVideos = $('stepVideos'), tabs = $('tabs'), vidBody = $('vidBody'), vidDot = $('vidDot');
  function show(which) {
    stepPick.hidden = which !== 'pick';
    stepDone.hidden = which !== 'done';
    stepOut.hidden  = which !== 'out';
    if (stepVideos) stepVideos.hidden = which !== 'videos';
    if (tabs) {
      tabs.hidden = which === 'out';
      var on = which === 'videos' ? 'videos' : 'pick';
      tabs.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === on); });
    }
    window.scrollTo(0, 0);
  }
  if (tabs) tabs.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]'); if (!b) return;
    if (b.dataset.tab === 'videos') { show('videos'); loadVideos(); }
    else show(made ? 'done' : 'pick');
  });

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
    loadVideos();          /* quietly, so the red dot is right before he taps the tab */
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
        loadVideos();
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

  /* ---- the Instagram copy -------------------------------------------------
     INSTAGRAM WILL NOT TAKE JEFF'S POSTER AS IT IS. Two hard rules on their
     side: JPEG only, and nothing taller than 4:5 survives uncropped. On top
     of that the grid thumbnail is square whatever you post, so a tall poster
     loses its top and bottom in the one place people browse.

     So a SEPARATE square JPEG copy is made for Instagram and nothing else.
     The original file is never touched -- the feed and Facebook still get
     exactly what he made, which is the promise this app was built on.

     The bars are filled with a color read off the poster's own edge, so a
     poster with a solid background comes out looking like it was always
     square rather than like a photo sitting on a mat. */
  var IG_SIDE = 1440;    /* Instagram downsizes past this anyway */
  var IG_QUALITY = 0.92;

  function padColor(img) {
    try {
      var s = 32;
      var c = document.createElement('canvas');
      c.width = s; c.height = s;
      var x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, s, s);
      var d = x.getImageData(0, 0, s, s).data;
      var rs = [], gs = [], bs = [];
      for (var i = 0; i < s; i++) {
        var edge = [i, (s - 1) * s + i, i * s, i * s + (s - 1)];
        for (var e = 0; e < edge.length; e++) {
          var p = edge[e] * 4;
          rs.push(d[p]); gs.push(d[p + 1]); bs.push(d[p + 2]);
        }
      }
      /* the MIDDLE of the edge pixels, not the average -- one bright corner
         should not drag the whole border off the poster's actual color */
      var mid = function (a) {
        a.sort(function (m, n) { return m - n; });
        return a[Math.floor(a.length / 2)];
      };
      return 'rgb(' + mid(rs) + ',' + mid(gs) + ',' + mid(bs) + ')';
    } catch (e) { return '#000000'; }
  }

  function squareJpeg(f) {
    return new Promise(function (resolve) {
      var url = '';
      try {
        url = URL.createObjectURL(f);
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.naturalWidth, h = img.naturalHeight;
            var side = Math.min(IG_SIDE, Math.max(w, h));
            var k = side / Math.max(w, h);
            var dw = Math.max(1, Math.round(w * k));
            var dh = Math.max(1, Math.round(h * k));
            var c = document.createElement('canvas');
            c.width = side; c.height = side;
            var x = c.getContext('2d');
            x.fillStyle = padColor(img);
            x.fillRect(0, 0, side, side);
            x.drawImage(img, Math.round((side - dw) / 2), Math.round((side - dh) / 2), dw, dh);
            URL.revokeObjectURL(url);
            c.toBlob(function (b) { resolve(b && b.size ? b : null); }, 'image/jpeg', IG_QUALITY);
          } catch (e) { if (url) URL.revokeObjectURL(url); resolve(null); }
        };
        img.onerror = function () { if (url) URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      } catch (e) { if (url) URL.revokeObjectURL(url); resolve(null); }
    });
  }

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

      /* WHERE IT LANDED, not just that it landed. Facebook answering "ok"
         and the post showing up on the page Jeff is looking at are two
         different things -- a token can belong to a different page, and a
         photo can sit in an album without a story. So the id comes back and
         becomes a tappable link. One tap settles it. */
      var fbId = out && out.id ? String(out.id) : '';
      if (fbId) {
        fbHint.innerHTML = 'Posted. <a href="https://www.facebook.com/' + fbId +
          '" target="_blank" rel="noopener">Open it on Facebook</a>';
      } else {
        fbHint.textContent = 'Facebook took it but did not say where it put it.';
      }
    } catch (e) {
      toFacebook.innerHTML = was;
      toFacebook.disabled = false;
      toast((e && e.message) || 'Facebook did not take it.');
    } finally {
      toFacebook.classList.remove('busy');
    }
  });

  /* ---- 4. and on to Instagram --------------------------------------------- */
  toInstagram.addEventListener('click', async function () {
    if (!made || !picked) return;
    toInstagram.disabled = true;
    toInstagram.classList.add('busy');
    var was = toInstagram.innerHTML;

    try {
      /* Built on the first tap, not on every post -- a square copy nobody
         asks for is a second upload off a phone on shop wifi for nothing.
         Kept afterwards so a retry does not build it twice. */
      if (!made.igImageUrl) {
        toInstagram.textContent = 'Preparing…';
        var sq = await squareJpeg(picked);
        if (!sq) throw new Error('Could not make the square copy for Instagram.');
        var key = await CP.upload(sq, 'hyde-ig-' + Date.now());
        if (!key) throw new Error('The square copy would not upload. Check your signal.');
        made.igImageUrl = CP.urlFor(key);
      }

      toInstagram.textContent = 'Sending…';
      var s = await sb.auth.getSession();
      var token = s && s.data && s.data.session && s.data.session.access_token;
      if (!token) throw new Error('Signed out. Open Infinite Pulls and sign in again.');

      var r = await fetch(cfg.SUPABASE_URL + '/functions/v1/post-to-instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ imageUrl: made.igImageUrl, caption: made.caption })
      });
      var out = null;
      try { out = await r.json(); } catch (e) {}
      if (!r.ok) throw new Error((out && out.error) || ('Instagram said no (' + r.status + ').'));

      toInstagram.textContent = '✓ On Instagram';
      var link = out && out.permalink ? String(out.permalink) : '';
      if (link) {
        igHint.innerHTML = 'Posted. <a href="' + link +
          '" target="_blank" rel="noopener">Open it on Instagram</a>';
      } else {
        igHint.textContent = 'Posted to the shop’s Instagram.';
      }
    } catch (e) {
      toInstagram.innerHTML = was;
      toInstagram.disabled = false;
      toast((e && e.message) || 'Instagram did not take it.');
    } finally {
      toInstagram.classList.remove('busy');
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

    toInstagram.disabled = false;
    toInstagram.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">' +
      '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/>' +
      '<circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" stroke="none"/></svg> Share to Instagram';
    igHint.textContent = 'A square copy goes to the shop’s Instagram. The original is not changed.';

    show('pick');
  });

  /* ---- VIDEOS FOR TIKTOK AND YOUTUBE ---------------------------------------
     THE SCHEDULE: one video at noon and one at 7 PM, his clock. A slot he
     misses does not pile up -- there is only ever one on the screen, and the
     next one shows at the next noon or 7 after he finishes this one. The
     screen always says when to come back, so nobody has to remember it.

     A video is FINISHED when it is ticked for TikTok and for YouTube (or he
     skipped it). Ticks live in share_desk, the same rows the Share Desk page
     shows as its two extras. */
  var CDN = 'https://vz-bf34e88b-2d7.b-cdn.net';       /* same one components/loops.js uses */
  var SLOTS = [12, 19];                                  /* noon and 7 PM */
  var SITE_LINE = 'Show off your pulls free at infinitepulls.com';
  var vid = { loops: [], marks: {}, cur: null, blob: null, blobFor: '', saved: false, loading: false };
  var escH = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  function loopFile(l) {
    var have = String(l.resolutions || '').match(/\d+/g), r = 480;
    if (have && have.length) {
      var ok = have.map(Number).filter(function (n) { return n <= 720; }).sort(function (x, y) { return y - x; });
      if (ok.length) r = ok[0];
    }
    return CDN + '/' + l.video_guid + '/play_' + r + 'p.mp4';
  }
  function lastSlot(now) {              /* the most recent noon or 7 PM */
    var d = new Date(now), h = d.getHours() + d.getMinutes() / 60, pick = null;
    for (var i = SLOTS.length - 1; i >= 0; i--) if (h >= SLOTS[i]) { pick = SLOTS[i]; break; }
    if (pick === null) { d.setDate(d.getDate() - 1); pick = SLOTS[SLOTS.length - 1]; }
    d.setHours(pick, 0, 0, 0); return d;
  }
  function nextSlot(now) {
    var d = new Date(now), h = d.getHours() + d.getMinutes() / 60, pick = null;
    for (var i = 0; i < SLOTS.length; i++) if (h < SLOTS[i]) { pick = SLOTS[i]; break; }
    if (pick === null) { d.setDate(d.getDate() + 1); pick = SLOTS[0]; }
    d.setHours(pick, 0, 0, 0); return d;
  }
  function sayWhen(d) {
    var now = new Date(), t = d.getHours() === 12 ? '12:00 noon' : (d.getHours() % 12 || 12) + ':00 ' + (d.getHours() < 12 ? 'AM' : 'PM');
    return (d.toDateString() === now.toDateString() ? (d.getHours() >= 17 ? 'Tonight' : 'Today') : 'Tomorrow') + ' at ' + t;
  }
  var marksOf = function (l) { return vid.marks['loop:' + l.id] || {}; };
  var finished = function (l) { var m = marksOf(l); return !!m.jeff_skip || (!!m.tiktok && !!m.youtube); };
  function finishedAt(l) {
    var m = marksOf(l);
    if (m.jeff_skip) return m.jeff_skip;
    return m.tiktok && m.youtube ? (m.tiktok > m.youtube ? m.tiktok : m.youtube) : '';
  }
  function tiktokText(l) { return ((l.caption || '').trim() + ' ' + SITE_LINE + ' #pokemon #pokemontcg #pokemoncards').trim(); }
  function youtubeText(l) {
    var t = (l.caption || 'Infinite Pulls TV').trim();
    if (t.length > 88) t = t.slice(0, 85).replace(/\s+\S*$/, '') + '...';
    return t + ' #shorts';
  }

  async function loadVideos() {
    if (!sb || !me || !vidBody || vid.loading) return;
    vid.loading = true;
    try {
      var got = await Promise.all([
        sb.from('user_loops').select('id, video_guid, caption, resolutions, created_at').eq('user_id', me.id).eq('status', 'ready').order('created_at', { ascending: true }).limit(500),
        sb.from('share_desk').select('item, place, done_at').limit(10000)
      ]);
      if (got[0].error || got[1].error) throw new Error('load');
      vid.marks = {};
      (got[1].data || []).forEach(function (m) { (vid.marks[m.item] = vid.marks[m.item] || {})[m.place] = m.done_at; });
      vid.loops = (got[0].data || []).filter(function (l) { return !marksOf(l).skip; });
      drawVideos();
    } catch (e) {
      vidBody.innerHTML = '<p class="lead">Could not load the videos. Check your signal, then tap Videos again.</p>';
    }
    vid.loading = false;
  }

  /* FEW WORDS, BIG PICTURES (Mike, 6 Oct: "he is never going to read all that
     stuff, graphics, icons, arrows are the way to go"). Every step is an
     icon, a name and a button. The four little pictures with arrows are the
     whole how-to: plus, pick, paste, post. */
  var IC = {
    get:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>',
    plus:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M12 8v8M8 12h8"/></svg>',
    pick:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/></svg>',
    paste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="16" rx="2.5"/><rect x="9" y="3" width="6" height="4" rx="1.2"/><path d="M9 12h6M9 16h4"/></svg>',
    post:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l16-7-6 16-3-6z"/></svg>',
    arrow: '<svg class="v-arr" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
    note:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17V6l10-2v11"/><circle cx="6.500" cy="17" r="2.500" fill="currentColor"/><circle cx="16.500" cy="15" r="2.500" fill="currentColor"/></svg>',
    play:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 7.200v9.600L17 12z"/></svg>'
  };
  function strip() {
    var s = [[IC.plus, '+'], [IC.pick, 'Pick'], [IC.paste, 'Paste'], [IC.post, 'Post']];
    return '<div class="v-flow">' + s.map(function (x) { return '<span>' + x[0] + '<em>' + x[1] + '</em></span>'; }).join(IC.arrow) + '</div>';
  }
  function place(n, key, name, icon, extra, on) {
    return '<div class="v-step v-' + key + (on ? ' done' : '') + '">' +
      '<h2><b>' + (on ? IC.check : n) + '</b><i class="v-logo">' + icon + '</i>' + name + (extra || '') + '</h2>' +
      (on ? '<button class="v-btn alt" type="button" data-v="undo-' + key + '">Undo</button>'
          : strip() +
            '<div class="v-two"><button class="v-btn alt" type="button" data-v="copy-' + key + '">' + IC.paste + 'Copy words</button>' +
            '<button class="v-btn ok" type="button" data-v="did-' + key + '">' + IC.check + 'Posted</button></div>') +
      '</div>';
  }

  function drawVideos() {
    var left = vid.loops.filter(function (l) { return !finished(l); });
    var doneCount = vid.loops.length - left.length;
    var started = left.filter(function (l) { var m = marksOf(l); return m.tiktok || m.youtube; })[0];
    var last = vid.loops.map(finishedAt).filter(Boolean).sort().pop() || '';
    var open = !last || new Date(last) < lastSlot(Date.now());
    var cur = started || (open ? left[0] : null);
    vid.cur = cur || null;
    if (vidDot) vidDot.hidden = !cur;
    var rule = '<p class="v-rule">' + IC.clock + '<b>12 PM</b> and <b>7 PM</b><span>1 video each time</span></p>';

    if (!cur) {
      vidBody.innerHTML = '<div class="v-wait">' +
        (left.length
          ? '<div class="tick">' + IC.check + '</div><h1>Done!</h1>' +
            '<p class="lead">Next video</p><p class="v-when">' + IC.clock + sayWhen(nextSlot(Date.now())) + '</p>' +
            '<p class="lead">' + left.length + ' more to go</p>'
          : '<div class="tick">' + IC.check + '</div><h1>All caught up</h1><p class="lead">No videos waiting.</p>') +
        '</div>' + rule;
      return;
    }

    var m = marksOf(cur), src = loopFile(cur);
    if (vid.blobFor !== cur.id) { vid.blob = null; vid.blobFor = cur.id; vid.saved = false; fetchVideo(cur, src); }
    vidBody.innerHTML =
      '<p class="v-count">Video ' + (doneCount + 1) + ' of ' + vid.loops.length + '</p>' +
      '<video class="v-vid" controls playsinline preload="metadata" poster="' + CDN + '/' + cur.video_guid + '/thumbnail.jpg" src="' + src + '"></video>' +
      '<div class="v-step' + (vid.saved ? ' done' : '') + '"><h2><b>' + (vid.saved ? IC.check : 1) + '</b>Get the video</h2>' +
        '<button class="v-btn big" type="button" data-v="save"' + (vid.blob ? '' : ' disabled') + '>' + IC.get + '<span>' + (vid.blob ? 'Get video' : 'Loading…') + '</span></button>' +
        '<p class="v-tip">Tap <b>TikTok</b> or <b>Save Video</b></p></div>' +
      place(2, 'tiktok', 'TikTok', IC.note, '', !!m.tiktok) +
      place(3, 'youtube', 'YouTube', IC.play, '<small>@infinitepullstcg</small>', !!m.youtube) +
      '<button class="v-skip" type="button" data-v="skip">Skip</button>' + rule;
  }

  /* FETCHED AHEAD OF THE TAP. An iPhone only opens the share menu straight
     off a tap; a download sitting between the tap and the menu makes it
     refuse. So the file is already in hand when he taps Save. */
  async function fetchVideo(l, src) {
    try {
      var r = await fetch(src); if (!r.ok) throw new Error('get');
      var b = await r.blob();
      if (vid.blobFor !== l.id) return;
      vid.blob = b;
    } catch (e) { if (vid.blobFor === l.id) vid.blob = null; }
    if (vid.cur && vid.cur.id === l.id) {
      var btn = vidBody.querySelector('[data-v="save"]');
      if (btn) { btn.disabled = !vid.blob; var sp = btn.querySelector('span'); if (sp) sp.textContent = vid.blob ? 'Get video' : 'Tap Videos again'; }
    }
  }

  async function saveVideo() {
    if (!vid.blob || !vid.cur) return;
    var f = new File([vid.blob], 'infinite-pulls-tv.mp4', { type: 'video/mp4' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [f] })) {
        await navigator.share({ files: [f] });
      } else {
        var a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name;
        document.body.appendChild(a); a.click(); a.remove();
        toast('Saved to this device.');
      }
      vid.saved = true; drawVideos();
    } catch (e) { if (!e || e.name !== 'AbortError') toast('That did not save. Try again.'); }
  }

  async function copyWords(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); }
    catch (e) { toast('Could not copy. Press and hold the words to copy them.'); }
  }

  async function markVideo(place, on) {
    var l = vid.cur; if (!l) return;
    var key = 'loop:' + l.id, r;
    try {
      r = on ? await sb.from('share_desk').upsert({ item: key, place: place }, { onConflict: 'item,place' })
             : await sb.from('share_desk').delete().eq('item', key).eq('place', place);
    } catch (e) { r = { error: e }; }
    if (r && r.error) { toast('That did not save. Check your signal and try again.'); return; }
    vid.marks[key] = vid.marks[key] || {};
    if (on) vid.marks[key][place] = new Date().toISOString(); else delete vid.marks[key][place];
    var wasCur = l;
    drawVideos();
    if (on && finished(wasCur)) toast(place === 'jeff_skip' ? 'Skipped' : 'Done!');
    window.scrollTo(0, 0);
  }

  if (vidBody) vidBody.addEventListener('click', function (e) {
    var b = e.target.closest('[data-v]'); if (!b) return;
    var v = b.dataset.v;
    if (v === 'tab-pick') return show(made ? 'done' : 'pick');
    if (!vid.cur) return;
    if (v === 'save') return saveVideo();
    if (v === 'copy-tiktok') return copyWords(tiktokText(vid.cur));
    if (v === 'copy-youtube') return copyWords(youtubeText(vid.cur));
    if (v === 'did-tiktok') return markVideo('tiktok', true);
    if (v === 'did-youtube') return markVideo('youtube', true);
    if (v === 'undo-tiktok') return markVideo('tiktok', false);
    if (v === 'undo-youtube') return markVideo('youtube', false);
    if (v === 'skip') return markVideo('jeff_skip', true);
  });
  /* The clock moves while the app sits open on the counter. */
  setInterval(function () { if (stepVideos && !stepVideos.hidden && !vid.cur && vid.loops.length) drawVideos(); }, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && me) loadVideos(); });

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
