/* =============================================================================
   WHY DID IT SIGN ME OUT.

   The app has twice put somebody back on the sign-in screen without anybody
   asking it to, and there was no way to tell afterwards what had happened --
   Supabase reports every sign-in, sign-out and token refresh, and the app
   was throwing all of it away.

   This keeps the last forty of them, plus any refusal from the auth server,
   in this browser. It is a flight recorder and nothing else: it changes no
   behaviour, it never blocks anything, and if any part of it fails the app
   carries on exactly as before.

   WHAT IT DOES NOT RECORD. No tokens, no passwords, no request bodies. From
   a failed auth call it keeps the status code and the server's own one-line
   error message, which is the part that says WHY -- typically "Invalid
   Refresh Token: Already Used", which is a different diagnosis from a 500 or
   a dropped connection, and until now they all looked identical.

   TO READ IT: add ?authlog=1 to any page of the app.
   ========================================================================== */
(function () {
  'use strict';

  var KEY = 'ip-authlog';
  var MAX = 40;

  function load() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; }
    catch (_) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch (_) { /* nothing to be done */ }
  }

  function note(what, detail) {
    try {
      var list = load();
      list.push({
        t: new Date().toISOString(),
        w: String(what || ''),
        d: detail == null ? '' : String(detail).slice(0, 200),
        p: (location.pathname + location.search).slice(0, 120),
        /* Was the page even in front of them? A sign-out while the phone was
           in a pocket is a background token refresh; one while they were
           looking at it is something they did or something they saw. */
        v: document.visibilityState
      });
      save(list);
    } catch (_) { /* a recorder that breaks the flight is worse than none */ }
  }

  /* ---- ON PURPOSE, OR NOT -------------------------------------------------
     The single most useful fact about a sign-out is whether a person asked
     for it. Whatever calls signOut() says so first; anything else that
     arrives is the app doing it on its own. */
  var onPurposeUntil = 0;
  function onPurpose(where) {
    onPurposeUntil = Date.now() + 5000;
    note('sign-out requested', where || 'a button');
  }

  /* ---- what the auth server actually said ---------------------------------
     Wrapped rather than polled, because the interesting failures are the ones
     nothing in the app ever sees: a refresh that quietly 400s in the
     background, minutes before anybody notices they are signed out. */
  try {
    var realFetch = window.fetch;
    if (typeof realFetch === 'function') {
      window.fetch = function (input, init) {
        var url = '';
        try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (_) {}
        var isAuth = url.indexOf('/auth/v1/') !== -1;
        var p = realFetch.apply(this, arguments);
        if (!isAuth) return p;
        return p.then(function (res) {
          if (!res.ok) {
            var where = url.split('/auth/v1/')[1] || '';
            where = where.split('&')[0].slice(0, 60);
            /* Read a COPY. Consuming the real one would break the caller. */
            res.clone().json().then(function (body) {
              note('auth ' + res.status, where + ' — ' +
                ((body && (body.error_description || body.msg || body.error || body.message)) || 'no message'));
            }).catch(function () { note('auth ' + res.status, where); });
          }
          return res;
        }).catch(function (err) {
          note('auth request failed', (url.split('/auth/v1/')[1] || '').split('&')[0] +
            ' — ' + ((err && err.message) || 'network'));
          throw err;
        });
      };
    }
  } catch (_) { /* the app does not depend on this */ }

  /* ---- what Supabase says happened ---------------------------------------
     The client is built by app.js and by feed.js, either of which may not
     have run yet when this file loads -- it is deliberately loaded FIRST so
     the wrapper above is in place before the first auth call. So it waits,
     briefly, rather than assuming. */
  var attached = false;
  function attach() {
    if (attached) return true;
    var sb = (window.InfinitePullsSupabase && window.InfinitePullsSupabase.client) || null;
    if (!sb || !sb.auth || !sb.auth.onAuthStateChange) return false;
    attached = true;
    try {
      sb.auth.onAuthStateChange(function (event, session) {
        if (event === 'SIGNED_OUT') {
          var asked = Date.now() < onPurposeUntil;
          note('SIGNED OUT', asked ? 'they asked for it' : 'NOBODY ASKED — the app did this on its own');
          return;
        }
        note(event, session && session.user ? 'signed in' : 'no session');
      });
      note('recorder attached', navigator.userAgent.slice(0, 120));
    } catch (_) { attached = false; }
    return attached;
  }
  var tries = 0;
  var timer = setInterval(function () {
    if (attach() || ++tries > 40) clearInterval(timer);
  }, 250);
  attach();

  /* ---- reading it back ---------------------------------------------------- */
  function draw() {
    var list = load();
    var text = list.map(function (r) {
      return r.t.replace('T', ' ').slice(0, 19) + '  ' + r.w +
        (r.d ? '  — ' + r.d : '') + '   [' + r.p + (r.v === 'hidden' ? ', screen off' : '') + ']';
    }).join('\n') || 'Nothing recorded yet.';

    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#070b13;color:#e8eef7;' +
      'padding:16px;overflow:auto;font:400 12px/1.6 ui-monospace,Menlo,monospace';
    box.innerHTML =
      '<div style="font:800 15px/1.4 system-ui,sans-serif;margin-bottom:4px">Auth recorder</div>' +
      '<div style="font:400 13px/1.5 system-ui,sans-serif;color:#93a3b8;margin-bottom:12px">' +
        'Every sign-in, sign-out and token refresh this browser has seen. ' +
        'Look for <b>SIGNED OUT</b> and what sits just above it.</div>' +
      '<pre id="ip-authlog-text" style="white-space:pre-wrap;word-break:break-word;margin:0 0 14px">' +
        text.replace(/[<>&]/g, '') + '</pre>' +
      '<button id="ip-authlog-copy" style="font:800 13px/1 system-ui,sans-serif;padding:12px 16px;' +
        'border-radius:999px;background:none;border:1.5px solid #ffc13d;color:#ffc13d;margin-right:8px">Copy it</button>' +
      '<button id="ip-authlog-clear" style="font:800 13px/1 system-ui,sans-serif;padding:12px 16px;' +
        'border-radius:999px;background:none;border:1px solid #ffffff33;color:#93a3b8;margin-right:8px">Clear</button>' +
      '<button id="ip-authlog-close" style="font:800 13px/1 system-ui,sans-serif;padding:12px 16px;' +
        'border-radius:999px;background:none;border:1px solid #ffffff33;color:#93a3b8">Close</button>';
    document.body.appendChild(box);

    box.querySelector('#ip-authlog-copy').addEventListener('click', function () {
      var t = box.querySelector('#ip-authlog-text').textContent;
      try { navigator.clipboard.writeText(t); } catch (_) {}
      this.textContent = 'Copied';
    });
    box.querySelector('#ip-authlog-clear').addEventListener('click', function () {
      try { localStorage.removeItem(KEY); } catch (_) {}
      box.querySelector('#ip-authlog-text').textContent = 'Cleared.';
    });
    box.querySelector('#ip-authlog-close').addEventListener('click', function () { box.remove(); });
  }

  if (/[?&]authlog=1/.test(location.search)) {
    if (document.body) draw();
    else document.addEventListener('DOMContentLoaded', draw);
  }

  window.InfinitePullsAuthLog = { note: note, onPurpose: onPurpose, read: load, show: draw };
})();
