/* INFINITE MESSENGER -- the app half (28 Sep 2026, PRIVATE TEST).
 *
 * ONLY tacomike417 AND Jefleppard SEE ANY OF THIS. Everybody else gets no
 * icon and no button: the page asks the database dm_can() first, and the
 * database says no for anyone not on the dm_access list (supabase/messages.sql).
 *
 *   * A chat-bubble icon on the top bar, beside the bell, with an unread count.
 *   * Messages: your chats, newest first. Chat: texting-style bubbles,
 *     photos (blurred until you tap them), shared posts / Loops / cards,
 *     "Seen", and typing dots. New messages arrive live.
 *   * "Send in Messages" on the feed's Share sheet and the Loop Share sheet.
 *   * Every message is sent through the 'messages' server function, which
 *     checks the words and the photo before it is saved.
 *   * The phone's back button closes each screen, one step at a time.
 */
(function () {
  'use strict';

  const sb = () => window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
  const back = () => window.InfinitePullsFeedBack || null;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const at = (n) => '@' + String(n || '').replace(/^@/, '');
  const cfg = () => window.InfinitePullsConfig || {};
  const PHOTO_BASE = () => String((cfg().CARD_PHOTO_BASE) || 'https://infinite-pulls-cards.mnasvadi.workers.dev').replace(/\/+$/, '');
  const photoUrl = (key) => PHOTO_BASE() + '/p/' + String(key).split('/').map(encodeURIComponent).join('/');
  const LOOP_CDN = 'https://vz-bf34e88b-2d7.b-cdn.net';

  let me = null, on = false;
  const faces = new Map();
  const api = { on: false, open: () => openInbox(), sendShare: (k) => pickAndShare(k) };
  window.InfinitePullsMessages = api;

  /* ------------------------------------------------------------------ CSS */
  const CSS = `
.dm-btn{position:relative}
.dm-btn .dm-n{position:absolute;top:2px;right:0;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#ff3d6e;color:#fff;font:900 11px/18px system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #0b1020}
.dm-btn .dm-n[hidden]{display:none}
.dm{position:fixed;inset:0;z-index:9580;background:#0a0c12;color:#fff;display:flex;flex-direction:column;font:500 15px/1.4 system-ui,-apple-system,sans-serif}
.dm-head{display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 16px 12px;border-bottom:1px solid #20263a;background:#10131b}
.dm-x{flex:none;display:grid;place-items:center;width:40px;height:40px;margin-left:-6px;border-radius:50%;border:0;background:#1d2233;color:#fff;cursor:pointer}
.dm-x svg{width:20px;height:20px;fill:none;stroke:#fff;stroke-width:2.6;stroke-linecap:round}
.dm-head h2{margin:0;font:900 20px/1.2 system-ui,sans-serif}
.dm-head .who{display:flex;align-items:center;gap:10px;min-width:0}
.dm-head .who>span{min-width:0}
.dm-head .who b{display:block;font:900 17px/1.2 system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dm-head .who small{display:block;color:#8ea0c4;font:600 12px/1.2 system-ui,sans-serif}
.dm-test{margin-left:auto;padding:4px 9px;border-radius:999px;background:#1d2233;color:#cfd6ea;font:800 11px/1.3 system-ui,sans-serif;white-space:nowrap}
/* HOLO (Mike picked C, 28 Sep 2026): a holo-card shimmer on your bubbles and the ring round a face */
.dm-av{flex:none;width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid transparent;background:linear-gradient(#262b36,#262b36) padding-box,conic-gradient(#ff3d8b,#ffc13d,#3dd6ff,#8b5bff,#ff3d8b) border-box;color:#fff;display:grid;place-items:center;font:900 16px/1 system-ui}
.dm-list{flex:1;overflow:auto;padding:6px 0 calc(16px + env(safe-area-inset-bottom))}
.dm-row{display:flex;align-items:center;gap:12px;width:100%;padding:12px 16px;border:0;background:none;color:#fff;text-align:left;font:inherit;cursor:pointer}
.dm-row:active{background:#161a24}
.dm-row .dm-av{width:52px;height:52px}
.dm-row .t{flex:1;min-width:0}
.dm-row .t b{display:block;font:800 16px/1.25 system-ui,sans-serif}
.dm-row .t span{display:block;color:#8ea0c4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dm-row.unread .t span{color:#fff;font-weight:700}
.dm-row .dot{flex:none;width:10px;height:10px;border-radius:50%;background:conic-gradient(#ff3d8b,#ffc13d,#3dd6ff,#8b5bff,#ff3d8b)}
.dm-sec{margin:14px 16px 4px;color:#8ea0c4;font:800 12px/1.2 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase}
.dm-empty{margin:24px 16px;color:#8ea0c4;text-align:center}
.dm-safe{margin:18px 16px 0;padding:10px 12px;border-radius:12px;background:#141821;border:1px solid #20263a;color:#8ea0c4;font-size:12.5px;line-height:1.45}
.dm-safe b{color:#e2e8f0}
.dm-thread{flex:1;overflow:auto;padding:14px 12px 8px;display:flex;flex-direction:column;gap:4px}
.dm-day{align-self:center;margin:10px 0 4px;color:#6b7a9c;font:700 11.5px/1 system-ui,sans-serif}
.dm-b{max-width:78%;padding:9px 13px;border-radius:18px;word-break:break-word;white-space:pre-wrap;font-size:16px;line-height:1.35}
.dm-b.them{align-self:flex-start;background:#252a35;color:#f1f3f7;border-bottom-left-radius:6px}
.dm-b.me{align-self:flex-end;background:linear-gradient(115deg,#ffd6e8 0%,#fff1b8 22%,#c9f7ff 45%,#dcd0ff 68%,#ffd6e8 100%);color:#14121c;box-shadow:inset 0 0 0 1px rgba(255,255,255,.6);border-bottom-right-radius:6px}
.dm-b.pending{opacity:.55}
.dm-b.failed{background:#3b0d12;color:#ffd7d9}
.dm-b.pic{padding:4px;background:none}
.dm-b.me.pic{background:none}
.dm-pic{position:relative;display:block;border:0;padding:0;background:#0f172a;border-radius:16px;overflow:hidden;cursor:pointer}
.dm-pic{width:220px;max-width:100%;min-height:180px}
.dm-pic img{display:block;width:100%;max-height:320px;min-height:180px;object-fit:cover}
.dm-pic.blur img{filter:blur(24px) brightness(.7);transform:scale(1.08)}
.dm-pic .cover{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font:800 14px/1.3 system-ui,sans-serif;text-align:center;padding:10px}
.dm-pic:not(.blur) .cover{display:none}
.dm-share{display:flex;align-items:center;gap:10px;padding:8px 12px 8px 8px;border-radius:14px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:inherit;text-decoration:none}
.dm-b.me .dm-share{border-color:rgba(0,0,0,.12);background:rgba(255,255,255,.45)}
.dm-share img,.dm-share .ph{flex:none;width:44px;height:60px;border-radius:6px;object-fit:cover;background:#0f172a;display:grid;place-items:center;font-size:20px}
.dm-share b{display:block;font:800 14px/1.2 system-ui,sans-serif}
.dm-share small{display:block;opacity:.75;font:600 12px/1.2 system-ui,sans-serif}
.dm-seen{align-self:flex-end;margin:2px 4px 0;color:#8ea0c4;font:700 11.5px/1 system-ui,sans-serif}
.dm-err{align-self:flex-end;margin:2px 4px 0;color:#ff8a8a;font:700 12px/1.3 system-ui,sans-serif;max-width:78%;text-align:right}
.dm-typing{align-self:flex-start;display:flex;gap:4px;padding:12px 14px;border-radius:18px;background:#252a35}
.dm-typing i{width:7px;height:7px;border-radius:50%;background:#8ea0c4;animation:dmdot 1s infinite}
.dm-typing i:nth-child(2){animation-delay:.15s}.dm-typing i:nth-child(3){animation-delay:.3s}
@keyframes dmdot{0%,60%,100%{opacity:.3;transform:none}30%{opacity:1;transform:translateY(-3px)}}
.dm-bar{display:flex;align-items:flex-end;gap:8px;padding:8px 10px calc(10px + env(safe-area-inset-bottom));border-top:1px solid #20263a;background:#10131b}
.dm-bar textarea{flex:1;min-height:42px;max-height:40vh;padding:10px 14px;border-radius:21px;border:1px solid #2a3042;background:#0a0c12;color:#fff;font:500 16px/1.35 system-ui,sans-serif;resize:none}
.dm-ico{flex:none;width:42px;height:42px;border-radius:50%;border:0;display:grid;place-items:center;cursor:pointer}
.dm-ico svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.dm-ico.cam{background:#252a35;color:#fff}
.dm-ico.send{background:linear-gradient(115deg,#ff9ac6,#ffe27a,#8fe9ff,#b9a4ff);color:#14121c}
.dm-ico.send[disabled]{opacity:.4}
.dm-busy{padding:6px 12px 0;color:#8ea0c4;font:700 12.5px/1.3 system-ui,sans-serif}
.dm-busy[hidden]{display:none}
`;

  /* --------------------------------------------------------------- helpers */
  async function loadFaces(ids) {
    const want = [...new Set(ids)].filter((id) => id && !faces.has(id));
    if (!want.length) return;
    try {
      const { data } = await sb().from('profiles').select('id, username, avatar_url').in('id', want);
      (data || []).forEach((p) => faces.set(p.id, { name: p.username || 'someone', face: p.avatar_url || '' }));
    } catch (_) {}
  }
  const faceOf = (id) => faces.get(id) || { name: 'someone', face: '' };
  const avatar = (id) => {
    const f = faceOf(id);
    return f.face ? `<img class="dm-av" src="${esc(f.face)}" alt="">`
                  : `<span class="dm-av">${esc(f.name.slice(0, 1).toUpperCase())}</span>`;
  };
  const when = (iso) => {
    const d = new Date(iso), now = new Date();
    const same = d.toDateString() === now.toDateString();
    return same ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
  const preview = (m) => m.photo_key ? '📷 Photo' : m.share_key ? '↗ Shared ' + shareWord(m.share_key) : (m.body || '');
  const shareWord = (k) => ({ l: 'a Loop', c: 'a card', p: 'a post', r: 'a reward card' }[k[0]] || 'a post');
  function say(t) {
    try { if (window.InfinitePullsToast) { window.InfinitePullsToast(t); return; } } catch (_) {}
    let el = document.getElementById('dm-toast');
    if (!el) {
      el = document.createElement('div'); el.id = 'dm-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:calc(90px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:9600;background:#111827;color:#fff;padding:10px 16px;border-radius:999px;font:700 14px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.4)';
      document.body.appendChild(el);
    }
    el.textContent = t; el.hidden = false;
    clearTimeout(say.t); say.t = setTimeout(() => { el.hidden = true; }, 3200);
  }
  async function call(body) {
    try {
      const { data, error } = await sb().functions.invoke('messages', { body });
      if (error) return { error: 'Could not reach messages. Check your connection.' };
      return data || { error: 'No answer.' };
    } catch (_) { return { error: 'Could not reach messages. Check your connection.' }; }
  }

  /* ------------------------------------------------------- the layers */
  /* Each screen is one step on the feed's back stack, so the phone's back
     button (and the iPhone edge swipe) closes it and nothing else. */
  function layer(tag, html, onClose) {
    const el = document.createElement('div');
    el.className = 'dm'; el.setAttribute('role', 'dialog');
    el.innerHTML = html;
    document.body.appendChild(el);
    document.documentElement.style.overflow = 'hidden';
    const close = () => {
      el.remove();
      if (!document.querySelector('.dm')) document.documentElement.style.overflow = '';
      if (onClose) onClose();
    };
    const b = back();
    if (b) b.push(tag, close);
    el._close = () => { const bb = back(); if (!bb || !bb.pop(tag)) close(); };
    /* the way out: an installed iPhone app has no back button (Jeff, 28 Sep) */
    el.addEventListener('click', (e) => { if (e.target.closest('[data-dm-close]')) { e.preventDefault(); e.stopPropagation(); el._close(); } }, true);
    return el;
  }

  /* ------------------------------------------------------- inbox */
  let inboxEl = null;
  const TEST_PILL = '<span class="dm-test">Private test</span>';

  async function openInbox() {
    if (!on) return;
    if (inboxEl) { fillInbox(); return; }
    inboxEl = layer('dm-inbox', `
      <div class="dm-head"><button type="button" class="dm-x" data-dm-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button><h2>Messages</h2>${TEST_PILL}</div>
      <div class="dm-list"><p class="dm-empty">Loading…</p></div>`, () => { inboxEl = null; });
    inboxEl.addEventListener('click', (e) => {
      const r = e.target.closest('[data-dm-thread]');
      if (r) { openChat(r.getAttribute('data-dm-thread'), r.getAttribute('data-dm-other')); return; }
      const p = e.target.closest('[data-dm-person]');
      if (p) startWith(p.getAttribute('data-dm-person'));
    });
    fillInbox();
  }

  async function threadsWithLast() {
    const { data: threads } = await sb().from('dm_threads')
      .select('id, user_a, user_b, a_read_at, b_read_at, last_at').order('last_at', { ascending: false }).limit(50);
    const list = threads || [];
    await Promise.all(list.map(async (t) => {
      const { data } = await sb().from('dm_messages').select('id, sender_id, body, photo_key, share_key, created_at')
        .eq('thread_id', t.id).order('created_at', { ascending: false }).limit(1);
      t.last = (data || [])[0] || null;
      t.other = t.user_a === me ? t.user_b : t.user_a;
      const mine = t.user_a === me ? t.a_read_at : t.b_read_at;
      t.unread = !!(t.last && t.last.sender_id !== me && (!mine || new Date(t.last.created_at) > new Date(mine)));
    }));
    return list;
  }

  async function fillInbox() {
    if (!inboxEl) return;
    const box = inboxEl.querySelector('.dm-list');
    let list = [], people = [];
    try {
      list = await threadsWithLast();
      const { data } = await sb().rpc('dm_people');
      people = data || [];
    } catch (_) { box.innerHTML = '<p class="dm-empty">Could not load your messages. Try again.</p>'; return; }
    people.forEach((p) => faces.set(p.id, { name: p.username || 'someone', face: p.avatar_url || '' }));
    await loadFaces(list.map((t) => t.other));
    const started = new Set(list.map((t) => t.other));
    const fresh = people.filter((p) => !started.has(p.id));
    box.innerHTML = `
      ${list.filter((t) => t.last).map((t) => `<button type="button" class="dm-row${t.unread ? ' unread' : ''}" data-dm-thread="${esc(t.id)}" data-dm-other="${esc(t.other)}">
        ${avatar(t.other)}<span class="t"><b>${esc(at(faceOf(t.other).name))}</b><span>${t.last.sender_id === me ? 'You: ' : ''}${esc(preview(t.last))} · ${esc(when(t.last.created_at))}</span></span>
        ${t.unread ? '<i class="dot" aria-label="Unread"></i>' : ''}</button>`).join('')}
      ${fresh.length || list.some((t) => !t.last) ? `<p class="dm-sec">Start a chat</p>` : ''}
      ${fresh.concat(list.filter((t) => !t.last).map((t) => ({ id: t.other }))).map((p) => `<button type="button" class="dm-row" data-dm-person="${esc(p.id)}">
        ${avatar(p.id)}<span class="t"><b>${esc(at(faceOf(p.id).name))}</b><span>Say hi 👋</span></span></button>`).join('')}
      ${!list.length && !fresh.length ? '<p class="dm-empty">Nobody else can message yet.</p>' : ''}
      <p class="dm-safe"><b>Kept clean on purpose.</b> Every photo is checked before it's delivered, and photos stay blurred until you tap them. Cussing gets starred out, and sexual talk isn't sent at all.</p>`;
  }

  async function startWith(otherId) {
    const r = await call({ action: 'open', to: otherId });
    if (r.error) { say(r.error); return null; }
    openChat(r.thread_id, otherId);
    return r.thread_id;
  }

  /* ------------------------------------------------------- one chat */
  let chat = null;   /* { el, id, other, otherRead, msgs, typingCh, typingTimer } */

  async function openChat(threadId, otherId) {
    if (chat && chat.id === threadId) return;
    if (chat) { chat.el._close(); await new Promise((r) => setTimeout(r, 180)); }
    await loadFaces([otherId]);
    const f = faceOf(otherId);
    const el = layer('dm-chat', `
      <div class="dm-head"><button type="button" class="dm-x" data-dm-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button><span class="who">${avatar(otherId)}<span><b>${esc(at(f.name))}</b><small>Private chat</small></span></span>${TEST_PILL}</div>
      <div class="dm-thread" aria-live="polite"><p class="dm-empty">Loading…</p></div>
      <p class="dm-busy" hidden></p>
      <div class="dm-bar">
        <button type="button" class="dm-ico cam" data-dm-photo aria-label="Send a photo"><svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></button>
        <input type="file" accept="image/*" hidden data-dm-file>
        <textarea rows="1" placeholder="Message…" aria-label="Message" enterkeyhint="send"></textarea>
        <button type="button" class="dm-ico send" data-dm-send aria-label="Send" disabled><svg viewBox="0 0 24 24"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg></button>
      </div>`, () => {
      if (chat && chat.el === el) {
        try { if (chat.typingCh) sb().removeChannel(chat.typingCh); } catch (_) {}
        chat = null;
      }
      if (inboxEl) fillInbox();
    });
    chat = { el, id: threadId, other: otherId, otherRead: null, msgs: [], typingCh: null, typingTimer: 0 };
    wireChat(chat);
    await loadThread(chat);
  }

  async function loadThread(c) {
    const [{ data: t }, { data: msgs }] = await Promise.all([
      sb().from('dm_threads').select('id, user_a, user_b, a_read_at, b_read_at').eq('id', c.id).maybeSingle(),
      sb().from('dm_messages').select('id, sender_id, body, photo_key, share_key, created_at')
        .eq('thread_id', c.id).order('created_at', { ascending: false }).limit(80)
    ]);
    if (chat !== c) return;
    if (t) c.otherRead = t.user_a === me ? t.b_read_at : t.a_read_at;
    c.msgs = (msgs || []).reverse();
    await shareInfo(c.msgs);
    draw(c);
    markRead(c.id);
  }

  /* what a shared post / Loop / card looks like in a bubble */
  const shares = new Map();
  async function shareInfo(msgs) {
    const want = msgs.map((m) => m.share_key).filter((k) => k && !shares.has(k));
    const by = (p) => want.filter((k) => k[0] === p).map((k) => k.slice(2));
    const l = by('l'), c = by('c'), p = by('p');
    try {
      if (l.length) {
        const { data } = await sb().from('user_loops').select('id, video_guid, caption').in('id', l);
        (data || []).forEach((x) => shares.set('l-' + x.id, { img: `${LOOP_CDN}/${x.video_guid}/thumbnail.jpg`, title: 'Infinite Loop', sub: x.caption || 'Tap to watch' }));
      }
      if (c.length) {
        const { data } = await sb().from('user_cards').select('id, card_name, set_name, image_url').in('id', c);
        (data || []).forEach((x) => shares.set('c-' + x.id, { img: x.image_url || '', title: x.card_name, sub: x.set_name || 'Card' }));
      }
      if (p.length) {
        const { data } = await sb().from('user_photos').select('id, object_key, caption').in('id', p);
        (data || []).forEach((x) => shares.set('p-' + x.id, { img: photoUrl(x.object_key), title: 'Post', sub: x.caption || 'Tap to see it' }));
      }
    } catch (_) {}
    want.forEach((k) => { if (!shares.has(k)) shares.set(k, { img: '', title: 'Shared ' + shareWord(k).replace(/^a /, ''), sub: 'Tap to open' }); });
  }

  function bubble(m) {
    const who = m.sender_id === me ? 'me' : 'them';
    const cls = 'dm-b ' + who + (m._pending ? ' pending' : '') + (m._failed ? ' failed' : '');
    let out = '';
    if (m.photo_key) {
      out += `<div class="${cls} pic"><button type="button" class="dm-pic blur" data-dm-unblur><img src="${esc(photoUrl(m.photo_key))}" alt="Photo" loading="lazy"><span class="cover">Photo · tap to show</span></button></div>`;
    }
    if (m.share_key) {
      const s = shares.get(m.share_key) || { img: '', title: 'Shared', sub: 'Tap to open' };
      out += `<div class="${cls}"><a class="dm-share" href="/feed-next/?post=${esc(m.share_key)}">${s.img ? `<img src="${esc(s.img)}" alt="">` : '<span class="ph">↗</span>'}<span><b>${esc(s.title)}</b><small>${esc(String(s.sub).slice(0, 60))}</small></span></a></div>`;
    }
    if (m.body) out += `<div class="${cls}">${esc(m.body)}</div>`;
    if (m._failed) out += `<p class="dm-err">Not sent. ${esc(m._failed)}</p>`;
    return out;
  }

  function draw(c) {
    const box = c.el.querySelector('.dm-thread');
    if (!c.msgs.length) {
      box.innerHTML = `<p class="dm-empty">Say hi to ${esc(at(faceOf(c.other).name))} 👋</p>`;
      return;
    }
    let lastDay = '', html = '';
    c.msgs.forEach((m) => {
      const day = new Date(m.created_at).toDateString();
      if (day !== lastDay) {
        const d = new Date(m.created_at);
        html += `<p class="dm-day">${d.toDateString() === new Date().toDateString() ? 'Today' : esc(d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }))}</p>`;
        lastDay = day;
      }
      html += bubble(m);
    });
    const mineLast = [...c.msgs].reverse().find((m) => m.sender_id === me && !m._pending && !m._failed);
    const lastAll = c.msgs[c.msgs.length - 1];
    if (mineLast && lastAll === mineLast && c.otherRead && new Date(c.otherRead) >= new Date(mineLast.created_at)) {
      html += '<p class="dm-seen">Seen</p>';
    }
    if (c.typing) html += '<div class="dm-typing" aria-label="Typing"><i></i><i></i><i></i></div>';
    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
  }

  function wireChat(c) {
    const el = c.el, ta = el.querySelector('textarea'), send = el.querySelector('[data-dm-send]');
    const file = el.querySelector('[data-dm-file]'), busy = el.querySelector('.dm-busy');
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, window.innerHeight * 0.4) + 'px'; };
    ta.addEventListener('input', () => { grow(); send.disabled = !ta.value.trim(); typing(c); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer:fine)').matches) { e.preventDefault(); go(); }
    });
    const go = () => {
      const text = ta.value.trim(); if (!text) return;
      ta.value = ''; grow(); send.disabled = true;
      sendMsg(c, { body: text });
    };
    send.addEventListener('click', go);
    el.addEventListener('click', (e) => {
      const u = e.target.closest('[data-dm-unblur]');
      if (u) { u.classList.remove('blur'); return; }
      if (e.target.closest('[data-dm-photo]')) { file.click(); return; }
      const a = e.target.closest('.dm-share');
      if (a) {
        /* leave the chat screens, then open the post in the feed */
        e.preventDefault();
        const href = a.getAttribute('href');
        closeAll(); setTimeout(() => { location.href = href; }, 150);
      }
    });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0]; file.value = '';
      if (!f) return;
      const CP = window.InfinitePullsCardPhoto;
      if (!CP || !CP.keep) { say('Photos aren’t ready yet. Try again in a moment.'); return; }
      busy.hidden = false; busy.textContent = 'Checking your photo…';
      try {
        const dataUrl = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
        const key = await CP.keep(dataUrl, 'me');
        if (!key) throw new Error('The photo didn’t upload. Try again.');
        await sendMsg(c, { photo_key: key });
      } catch (err) { say((err && err.message) || 'The photo didn’t upload. Try again.'); }
      busy.hidden = true;
    });
    /* typing dots: a tiny live channel just for this chat */
    try {
      c.typingCh = sb().channel('dm-typing-' + c.id, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'typing' }, (p) => {
          if (!p || !p.payload || p.payload.user === me || chat !== c) return;
          c.typing = true; draw(c);
          clearTimeout(c.typingTimer);
          c.typingTimer = setTimeout(() => { c.typing = false; if (chat === c) draw(c); }, 3500);
        }).subscribe();
    } catch (_) {}
  }

  let lastTyping = 0;
  function typing(c) {
    const now = Date.now();
    if (now - lastTyping < 2000 || !c.typingCh) return;
    lastTyping = now;
    try { c.typingCh.send({ type: 'broadcast', event: 'typing', payload: { user: me } }); } catch (_) {}
  }

  async function sendMsg(c, parts) {
    const temp = Object.assign({ id: 'tmp-' + Date.now(), sender_id: me, created_at: new Date().toISOString(), body: null, photo_key: null, share_key: null, _pending: true }, parts);
    if (parts.share_key) await shareInfo([temp]);
    c.msgs.push(temp); draw(c);
    const r = await call(Object.assign({ action: 'send', thread_id: c.id }, parts));
    if (r.error || !r.message) {
      temp._pending = false; temp._failed = r.error || 'Try again.';
      if (temp.photo_key) { temp.photo_key = null; temp.body = temp.body || '📷 Photo'; }
      draw(c); return false;
    }
    const i = c.msgs.indexOf(temp);
    if (c.msgs.some((m) => m.id === r.message.id)) c.msgs.splice(i, 1);   /* live copy got here first */
    else c.msgs[i] = r.message;
    c.typing = false;
    draw(c);
    return true;
  }

  async function markRead(threadId) {
    try { await sb().rpc('dm_mark_read', { p_thread: threadId }); } catch (_) {}
    paintBadge();
  }

  function closeAll() {
    if (chat) chat.el._close();
    if (inboxEl) inboxEl._close();
  }

  /* ------------------------------------------------------- share into a chat */
  async function pickAndShare(key) {
    if (!on || !key) return;
    let people = [];
    try { const { data } = await sb().rpc('dm_people'); people = data || []; } catch (_) {}
    if (!people.length) { say('Nobody to send it to yet.'); return; }
    people.forEach((p) => faces.set(p.id, { name: p.username || 'someone', face: p.avatar_url || '' }));
    const el = layer('dm-pick', `
      <div class="dm-head"><button type="button" class="dm-x" data-dm-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button><h2>Send to…</h2>${TEST_PILL}</div>
      <div class="dm-list">${people.map((p) => `<button type="button" class="dm-row" data-dm-to="${esc(p.id)}">${avatar(p.id)}<span class="t"><b>${esc(at(p.username))}</b><span>Send ${esc(shareWord(key))}</span></span></button>`).join('')}</div>`);
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-dm-to]'); if (!b) return;
      const to = b.getAttribute('data-dm-to');
      b.disabled = true;
      const r = await call({ action: 'open', to });
      if (r.error) { say(r.error); b.disabled = false; return; }
      el._close();
      setTimeout(async () => {
        await openChat(r.thread_id, to);
        if (chat) sendMsg(chat, { share_key: key });
      }, 180);
    });
  }

  /* ------------------------------------------------------- icon + badge */
  function addIcon() {
    if (document.querySelector('[data-dm-open]')) return;
    const bell = document.getElementById('bell');
    const tools = bell ? bell.parentElement : document.querySelector('.tools');
    if (!tools) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'iconbtn dm-btn'; b.setAttribute('data-dm-open', '');
    b.setAttribute('aria-label', 'Messages');
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z"/></svg><span class="dm-n" hidden></span>';
    if (bell) tools.insertBefore(b, bell); else tools.appendChild(b);
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openInbox(); });
  }
  async function paintBadge() {
    const n = document.querySelector('[data-dm-open] .dm-n');
    if (!n) return;
    let count = 0;
    try { const { data } = await sb().rpc('dm_unread'); count = Number(data) || 0; } catch (_) {}
    n.hidden = !count; n.textContent = count > 9 ? '9+' : String(count);
    const b = n.parentElement; b.setAttribute('aria-label', count ? `Messages, ${count} unread` : 'Messages');
  }

  /* ------------------------------------------------------- live updates */
  function listen() {
    try {
      sb().channel('dm-live-' + me)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, async (p) => {
          const m = p && p.new; if (!m) return;
          if (chat && m.thread_id === chat.id) {
            if (!chat.msgs.some((x) => x.id === m.id)) {
              const tmp = chat.msgs.findIndex((x) => x._pending && x.sender_id === m.sender_id
                && (x.body || null) === (m.body || null) && (x.share_key || null) === (m.share_key || null));
              if (tmp >= 0 && m.sender_id === me) chat.msgs[tmp] = m; else chat.msgs.push(m);
              if (m.sender_id !== me) chat.typing = false;
              await shareInfo([m]); draw(chat);
            }
            if (m.sender_id !== me) markRead(chat.id);
          } else {
            paintBadge();
          }
          if (inboxEl) fillInbox();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dm_threads' }, (p) => {
          const t = p && p.new; if (!t || !chat || t.id !== chat.id) return;
          chat.otherRead = t.user_a === me ? t.b_read_at : t.a_read_at;
          draw(chat);
        })
        .subscribe();
    } catch (_) {}
  }

  /* ------------------------------------------------------- start */
  async function start() {
    for (let k = 0; k < 60 && !sb(); k++) await new Promise((r) => setTimeout(r, 150));
    if (!sb()) return;
    try {
      const { data } = await sb().auth.getSession();
      me = data && data.session && data.session.user && data.session.user.id;
    } catch (_) { me = null; }
    if (!me) return;
    try {
      const { data, error } = await sb().rpc('dm_can');
      if (error || data !== true) return;         /* not on the list: nothing at all */
    } catch (_) { return; }
    on = true; api.on = true;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    addIcon(); paintBadge(); listen();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) paintBadge(); });
    /* ?dm=1 opens Messages (for a link from a notification later) */
    try { if (new URL(location.href).searchParams.get('dm') === '1') openInbox(); } catch (_) {}
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = [...document.querySelectorAll('.dm')].pop();
    if (top && top._close) top._close();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
