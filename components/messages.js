/* INFINITE MESSENGER -- the app half (28 Sep 2026, PRIVATE TEST).
 *
 * ONLY tacomike417 AND Jefleppard SEE ANY OF THIS. Everybody else gets no
 * icon and no button: the page asks the database dm_can() first, and the
 * database says no for anyone not on the dm_access list (supabase/messages.sql).
 *
 *   * A chat-bubble icon on the top bar, beside the bell, with an unread count.
 *   * Messages: your chats, newest first. Chat: texting-style bubbles,
 *     shared posts / Loops / cards (NO photos -- Jeff, 28 Sep),
 *     "Seen", and typing dots. New messages arrive live.
 *   * "Send in Messages" FIRST whenever one of our links is shared (28 Sep).
 *   * Links: ours open in the app; outside ones show a leaving-the-site screen.
 *   * Every message is sent through the 'messages' server function, which
 *     checks the words before it is saved and refuses any photo.
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
  /* who I can message right now (dm_people): drives the MESSAGE button on
     profiles. Later this is "people who follow each other"; today it's the
     private-test list. */
  const canSet = new Set();
  const api = { on: false, open: () => openInbox(), sendShare: (k) => pickAndShare(k), sendLink: (u) => pickAndShare(null, u), canMessage: (id) => on && canSet.has(id) };
  window.InfinitePullsMessages = api;

  /* ------------------------------------------------------------------ CSS */
  const CSS = `
.dm-btn{position:relative}
.dm-btn svg{width:28px!important;height:28px!important}
.dm-pbig{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;margin:10px 0 0;padding:13px 16px;border:0;border-radius:12px;background:#2f7bff;color:#fff;font:900 16px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(47,123,255,.35)}
.dm-pbig svg{width:28px;height:28px;flex:none;background:#fff;border-radius:50%;padding:3px;box-sizing:border-box}
.dm-btn .dm-n{position:absolute;top:2px;right:0;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#ff3d6e;color:#fff;font:900 11px/18px system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #0b1020}
.dm-btn .dm-n[hidden]{display:none}
.dm,.dm *{box-sizing:border-box}
.dm{position:fixed;inset:0;z-index:9580;background:#0a0c12;color:#fff;display:flex;flex-direction:column;font:500 15px/1.4 system-ui,-apple-system,sans-serif}
.dm-head{display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 16px 12px;border-bottom:1px solid #20263a;background:#10131b}
.dm-x{flex:none;display:grid;place-items:center;width:40px;height:40px;margin-left:-6px;border-radius:50%;border:0;background:#1d2233;color:#fff;cursor:pointer}
.dm-x svg{width:20px;height:20px;fill:none;stroke:#fff;stroke-width:2.6;stroke-linecap:round}
.dm-head h2{margin:0;font:900 20px/1.2 system-ui,sans-serif}
.dm-head .dm-who{display:flex;align-items:center;gap:10px;min-width:0}
.dm-head .dm-who>span{min-width:0}
.dm-head .dm-who b{display:block;font:900 17px/1.2 system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dm-head .dm-who small{display:block;color:#8ea0c4;font:600 12px/1.2 system-ui,sans-serif}
.dm-tradeb{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:50%;border:0;background:#1d2233;color:#ffd23f;font:900 19px/1 system-ui,sans-serif;cursor:pointer}
.dm-trade{white-space:normal;width:280px;max-width:100%;border-radius:16px;background:#0f1320;border:1px solid #2b3350;color:#f1f3f7;padding:12px;font:500 13px/1.35 system-ui,sans-serif}
.dm-b.dm-tb{padding:0;background:none}
.dm-trade h4{display:flex;align-items:center;gap:8px;margin:0 0 8px;font:900 15px/1.2 system-ui,sans-serif}
.dm-trade h4 i{font-style:normal;color:#ffd23f}
.dm-st{margin-left:auto;padding:4px 8px;border-radius:999px;font:900 11px/1 system-ui,sans-serif;background:#2f7bff;color:#fff}
.dm-st.accepted{background:#16a34a}.dm-st.declined,.dm-st.cancelled{background:#475569}.dm-st.countered{background:#a855f7}
.dm-side{margin:8px 0 0}
.dm-side b{display:flex;justify-content:space-between;font:800 12px/1.2 system-ui,sans-serif;color:#aab6d3}
.dm-side b span{color:#fff}
.dm-thumbs{display:flex;gap:4px;margin-top:4px;flex-wrap:wrap}
.dm-thumbs img,.dm-thumbs em{width:38px;height:53px;border-radius:4px;object-fit:cover;background:#1d2233;display:grid;place-items:center;font:800 11px/1 system-ui,sans-serif;font-style:normal;color:#cfd6ea}
.dm-verdict{margin:10px 0 0;padding:8px 10px;border-radius:10px;background:#171c2c;font:800 13px/1.3 system-ui,sans-serif}
.dm-tbtns{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:10px}
.dm-tbtns.one{grid-template-columns:1fr}
.dm-tbtns button{border:0;border-radius:10px;padding:10px 4px;font:900 13px/1 system-ui,sans-serif;cursor:pointer}
.dm-tbtns .acc{background:#16a34a;color:#fff}.dm-tbtns .ctr{background:#2f7bff;color:#fff}.dm-tbtns .dec{background:#2a3148;color:#fff}
.dm-fine{margin:8px 0 0;color:#8ea0c4;font:600 11px/1.35 system-ui,sans-serif}
.dm-tr-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:10px 12px 0}
.dm-tr-tabs button{border:0;border-radius:12px;padding:12px 6px;background:#1d2233;color:#cfd6ea;font:900 14px/1 system-ui,sans-serif;cursor:pointer}
.dm-tr-tabs button.on{background:#2f7bff;color:#fff}
.dm-tr-find{margin:10px 12px 0;box-sizing:border-box;width:calc(100% - 24px);padding:11px 12px;border-radius:12px;border:1px solid #2b3350;background:#0b0e16;color:#fff;font:600 16px/1.2 system-ui,sans-serif}
.dm-tg{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px 12px 12px;align-content:start}
.dm-tc{position:relative;border:2px solid transparent;border-radius:12px;background:#151a28;padding:6px;color:#fff;text-align:left;cursor:pointer;font:600 11px/1.25 system-ui,sans-serif}
.dm-tc img,.dm-tc .ph{display:block;width:100%;aspect-ratio:5/7;border-radius:6px;object-fit:cover;background:#1d2233}
.dm-tc b{display:block;margin-top:5px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dm-tc small{display:block;color:#8ea0c4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dm-tc .v{display:block;margin-top:2px;color:#7ee2a8;font-weight:900}
.dm-tc.on{border-color:#2f7bff;background:#16223f}
.dm-tc.on::after{content:"✓";position:absolute;top:10px;right:10px;width:24px;height:24px;border-radius:50%;background:#2f7bff;color:#fff;display:grid;place-items:center;font:900 14px/1 system-ui,sans-serif}
.dm-tr-foot{padding:10px 12px calc(12px + env(safe-area-inset-bottom));border-top:1px solid #20263a;background:#10131b}
.dm-sum{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.dm-sum div{padding:8px 10px;border-radius:10px;background:#171c2c;font:700 12px/1.2 system-ui,sans-serif;color:#aab6d3}
.dm-sum div b{display:block;margin-top:3px;color:#fff;font:900 18px/1 system-ui,sans-serif}
.dm-bal{height:8px;margin:8px 0 4px;border-radius:4px;background:#2a3148;overflow:hidden;display:flex}
.dm-bal i{display:block;height:100%}
.dm-say{margin:4px 0 0;font:800 13px/1.3 system-ui,sans-serif}
.dm-send-trade{display:block;width:100%;margin-top:10px;padding:15px;border:0;border-radius:14px;background:#2f7bff;color:#fff;font:900 16px/1 system-ui,sans-serif;cursor:pointer}
.dm-send-trade[disabled]{opacity:.45}
.dm-ask{background:linear-gradient(90deg,#3dd6ff,#8b5bff,#ff4f93) !important}
.dm-reqrow{flex-wrap:wrap}
.dm-req{display:flex;gap:8px;width:100%;padding-left:54px;box-sizing:border-box}
.dm-req button{flex:1}
.dm-req button{border:0;border-radius:999px;padding:9px 12px;font:900 12px/1 system-ui,sans-serif;cursor:pointer}
.dm-req .y{background:#2f7bff;color:#fff}.dm-req .n{background:#2a3148;color:#fff}
.dm-more{flex:none;display:grid;place-items:center;width:40px;height:40px;border-radius:50%;border:0;background:#1d2233;color:#fff;font:900 20px/1 system-ui,sans-serif;cursor:pointer;letter-spacing:1px}
.dm-leave-card .warn{border:0;background:#e5243b;color:#fff}
.dm-leave-card .opt{border:2px solid #d5dbe6;background:#fff;color:#0b1220;text-align:left;font-weight:800}
.dm-modrow{border-left:4px solid #e5243b}
.dm-modbar{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid #20263a;background:#10131b}
.dm-modbar button{border:0;border-radius:12px;padding:13px 8px;font:900 14px/1.1 system-ui,sans-serif;cursor:pointer}
.dm-modbar .clear{background:#e5e9f2;color:#0b1220}
.dm-modbar .off{background:#e5243b;color:#fff}
.dm-modnote{margin:0;padding:10px 14px;background:#2a1116;color:#ffc2cb;font:700 13px/1.35 system-ui,sans-serif}
.dm-name{display:block;font:800 11px/1.2 system-ui,sans-serif;opacity:.7;margin-bottom:2px}
.dm-test{margin-left:auto;padding:4px 9px;border-radius:999px;background:#1d2233;color:#cfd6ea;font:800 11px/1.3 system-ui,sans-serif;white-space:nowrap}
/* HOLO (Mike picked C, 28 Sep 2026): a holo-card shimmer on your bubbles and the ring round a face */
.dm-av{flex:none;width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid transparent;background:linear-gradient(#262b36,#262b36) padding-box,conic-gradient(#ff3d8b,#ffc13d,#3dd6ff,#8b5bff,#ff3d8b) border-box;color:#fff;display:grid;place-items:center;font:900 16px/1 system-ui}
.dm-list{flex:1;overflow:auto;padding:6px 0 calc(16px + env(safe-area-inset-bottom))}
.dm-row{display:flex;align-items:center;gap:12px;width:100%;padding:12px 16px;border:0;background:none;color:#fff;text-align:left;font:inherit;cursor:pointer}
.dm-row:active{background:#161a24}
.dm-row .dm-av{width:52px;height:52px}
.dm-row .dm-t{flex:1;min-width:0}
.dm-row .dm-t b{display:block;font:800 16px/1.25 system-ui,sans-serif}
.dm-row .dm-t span{display:block;color:#8ea0c4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dm-row.dm-unread .dm-t span{color:#fff;font-weight:700}
.dm-row .dm-dot{flex:none;width:10px;height:10px;border-radius:50%;background:conic-gradient(#ff3d8b,#ffc13d,#3dd6ff,#8b5bff,#ff3d8b)}
.dm-sec{margin:14px 16px 4px;color:#8ea0c4;font:800 12px/1.2 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase}
.dm-empty{margin:24px 16px;color:#8ea0c4;text-align:center}
.dm-safe{margin:18px 16px 0;padding:10px 12px;border-radius:12px;background:#141821;border:1px solid #20263a;color:#8ea0c4;font-size:12.5px;line-height:1.45}
.dm-safe b{color:#e2e8f0}
.dm-thread{flex:1;overflow:auto;padding:14px 12px 8px;display:flex;flex-direction:column;gap:4px}
.dm-day{align-self:center;margin:10px 0 4px;color:#6b7a9c;font:700 11.5px/1 system-ui,sans-serif}
.dm-b{max-width:78%;padding:9px 13px;border-radius:18px;word-break:break-word;white-space:pre-wrap;font-size:16px;line-height:1.35}
.dm-b.dm-them{align-self:flex-start;background:#252a35;color:#f1f3f7;border-bottom-left-radius:6px}
.dm-b.dm-me{align-self:flex-end;background:linear-gradient(115deg,#ffd6e8 0%,#fff1b8 22%,#c9f7ff 45%,#dcd0ff 68%,#ffd6e8 100%);color:#14121c;box-shadow:inset 0 0 0 1px rgba(255,255,255,.6);border-bottom-right-radius:6px}
.dm-b.dm-pending{opacity:.55}
.dm-b.dm-failed{background:#3b0d12;color:#ffd7d9}
.dm-b.dm-picb{padding:4px;background:none}
.dm-b.dm-me.dm-picb{background:none}
.dm-pic{position:relative;display:block;border:0;padding:0;background:#0f172a;border-radius:16px;overflow:hidden;cursor:pointer}
.dm-pic{width:220px;max-width:100%;min-height:180px}
.dm-pic img{display:block;width:100%;max-height:320px;min-height:180px;object-fit:cover}
.dm-pic.dm-blur img{filter:blur(24px) brightness(.7);transform:scale(1.08)}
.dm-pic .dm-cover{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font:800 14px/1.3 system-ui,sans-serif;text-align:center;padding:10px}
.dm-pic:not(.dm-blur) .dm-cover{display:none}
.dm-link{color:inherit;font-weight:800;text-decoration:underline;word-break:break-all;cursor:pointer}
.dm-link.dm-out::after{content:" ↗";text-decoration:none}
.dm-leave{position:fixed;inset:0;z-index:10050;background:rgba(3,7,13,.72);display:flex;align-items:flex-end;justify-content:center}
.dm-leave-card{width:100%;max-width:480px;background:#fff;color:#0b1220;border-radius:22px 22px 0 0;padding:22px 18px calc(18px + env(safe-area-inset-bottom));font:500 15px/1.45 system-ui,sans-serif}
.dm-leave-card h3{margin:0 0 6px;font:900 21px/1.2 system-ui,sans-serif}
.dm-leave-card .dom{margin:10px 0;padding:12px;border-radius:12px;background:#f1f4f9;font:800 16px/1.3 system-ui,sans-serif;word-break:break-all}
.dm-leave-card .full{display:block;margin-top:4px;font-weight:600;font-size:12px;color:#5b6477}
.dm-leave-card p{margin:0 0 12px;color:#3b4456}
.dm-leave-card button{display:block;width:100%;padding:15px;border-radius:14px;font:900 16px/1 system-ui,sans-serif;cursor:pointer;margin-top:10px}
.dm-leave-card .stay{border:0;background:#2f7bff;color:#fff}
.dm-leave-card .go{border:2px solid #d5dbe6;background:#fff;color:#0b1220}
.dm-leave-card .dm-big{border:0;background:#2f7bff;color:#fff;display:flex;align-items:center;justify-content:center;gap:10px}
.dm-leave-card .dm-big svg{width:24px;height:24px}
.dm-share{display:flex;align-items:center;gap:10px;padding:8px 12px 8px 8px;border-radius:14px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);color:inherit;text-decoration:none}
.dm-b.dm-me .dm-share{border-color:rgba(0,0,0,.12);background:rgba(255,255,255,.45)}
.dm-share img,.dm-share .dm-ph{flex:none;width:44px;height:60px;border-radius:6px;object-fit:cover;background:#0f172a;display:grid;place-items:center;font-size:20px}
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
.dm .dm-bar textarea:focus{background:#0a0c12;color:#fff;border-color:#2f7bff;outline:none;box-shadow:none}
.dm-ico{flex:none;width:42px;height:42px;border-radius:50%;border:0;display:grid;place-items:center;cursor:pointer}
.dm-ico svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.dm-ico.dm-camb{background:#252a35;color:#fff}
/* the send button: blue with a white up arrow (Mike, 28 Sep) */
.dm-ico.dm-sendb{background:#2f7bff;color:#fff;box-shadow:0 4px 14px rgba(47,123,255,.35)}
.dm-ico.dm-sendb svg{stroke-width:2.8}
.dm-ico.dm-sendb[disabled]{opacity:.45;box-shadow:none}
.dm-start{margin:auto 0;display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:20px 8px}
.dm-start .dm-av{width:76px;height:76px;font-size:28px}
.dm-start h3{margin:4px 0 0;font:900 20px/1.2 system-ui,sans-serif}
.dm-start p{margin:0;color:#8ea0c4;font-size:14px}
.dm-quick{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:8px}
.dm-quick button{padding:10px 14px;border-radius:999px;border:1.5px solid #2f7bff;background:rgba(47,123,255,.12);color:#fff;font:800 14px/1 system-ui,sans-serif;cursor:pointer}
.dm-pill{flex:none;margin-left:auto;padding:9px 14px;border-radius:999px;background:#2f7bff;color:#fff;font:800 13px/1 system-ui,sans-serif}
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
  const preview = (m) => m.trade_id ? '⇄ Trade offer' : m.photo_key ? '📷 Photo' : m.share_key ? '↗ Shared ' + shareWord(m.share_key) : (m.body || '');
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
  /* TRADES ARE PARKED for launch (Mike, 28 Sep): the ⇄ button is hidden
     and the server refuses them. Everything is still here -- set this (and
     TRADES in supabase/functions/messages) to true to bring them back. */
  const TRADES = false;
  /* "Private test" shows only until the launch switch is flipped
     (dm_settings.open in messenger_launch.sql). */
  let TEST_PILL = '<span class="dm-test">Private test</span>';
  /* OUR OWN MESSAGES MARK (Mike, 28 Sep): a filled holo bubble with the ∞
     in it, so it can't be mistaken for the outline search glass beside it.
     Colors ride in style="" so the top bar's icon rules can't repaint it. */
  let gradN = 0;
  const msgMark = () => {
    const g = 'dmg' + (++gradN);
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3dd6ff"/><stop offset=".5" stop-color="#8b5bff"/><stop offset="1" stop-color="#ff4f93"/></linearGradient></defs>
      <path d="M12 2.6c-5.2 0-9.4 3.8-9.4 8.6 0 2.6 1.3 4.9 3.3 6.5L5 21.4l4.2-2.1c.9.2 1.8.3 2.8.3 5.2 0 9.4-3.8 9.4-8.6S17.2 2.6 12 2.6z" style="fill:url(#${g});stroke:none"/>
      <path d="M7.6 11.2c0-1.1.9-1.9 1.9-1.9 1.7 0 2.6 3.8 4.9 3.8 1.1 0 1.9-.8 1.9-1.9s-.8-1.9-1.9-1.9c-2.3 0-3.2 3.8-4.9 3.8-1 0-1.9-.8-1.9-1.9z" style="fill:none;stroke:#fff;stroke-width:1.7;stroke-linecap:round"/></svg>`;
  };
  const MSG_ICON = msgMark();

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
      if (p) { startWith(p.getAttribute('data-dm-person')); return; }
      const ay = e.target.closest('[data-dm-askyes]');
      if (ay) { ay.disabled = true; answerAsk(ay.getAttribute('data-dm-askyes'), true); return; }
      const an = e.target.closest('[data-dm-askno]');
      if (an) { an.disabled = true; answerAsk(an.getAttribute('data-dm-askno'), false); return; }
      const rp = e.target.closest('[data-dm-report]');
      if (rp) openReported(rp.getAttribute('data-dm-report'));
    });
    fillInbox();
  }

  async function threadsWithLast() {
    /* only MY chats (a moderator can also read reported ones -- those
       show in their own section), and nobody I've blocked */
    const [{ data: threads }, blocks] = await Promise.all([
      sb().from('dm_threads').select('id, user_a, user_b, a_read_at, b_read_at, last_at')
        .or(`user_a.eq.${me},user_b.eq.${me}`).order('last_at', { ascending: false }).limit(50),
      myBlocks()
    ]);
    const list = (threads || []).filter((t) => !blocks.has(t.user_a === me ? t.user_b : t.user_a));
    await Promise.all(list.map(async (t) => {
      const { data } = await sb().from('dm_messages').select('id, sender_id, body, photo_key, share_key, trade_id, created_at')
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
    const [reported, asks] = await Promise.all([reportedChats(), myAsks()]);
    box.innerHTML = `
      ${asks.length ? `<p class="dm-sec">Chat requests</p>` + asks.map((q) => `<div class="dm-row dm-reqrow">
        ${avatar(q.from_id)}<span class="dm-t"><b>${esc(at(faceOf(q.from_id).name))}</b><span>wants to message you. Follow back?</span></span>
        <span class="dm-req"><button type="button" class="y" data-dm-askyes="${esc(q.from_id)}">Follow back</button><button type="button" class="n" data-dm-askno="${esc(q.from_id)}">No thanks</button></span></div>`).join('') : ''}
      ${reported.length ? `<p class="dm-sec">Reported chats · moderators only</p>` + reported.map((r) => `<button type="button" class="dm-row dm-modrow" data-dm-report="${esc(r.thread_id)}">
        <span class="dm-av">!</span><span class="dm-t"><b>${esc(at(faceOf(r.reporter_id).name))} reported ${esc(at(faceOf(r.reported_id).name))}</b><span>${esc(r.reason)} · ${esc(when(r.created_at))}</span></span><span class="dm-pill" style="background:#e5243b">Look</span></button>`).join('') + `<p class="dm-sec">Your chats</p>` : ''}
      ${list.filter((t) => t.last).map((t) => `<button type="button" class="dm-row${t.unread ? ' dm-unread' : ''}" data-dm-thread="${esc(t.id)}" data-dm-other="${esc(t.other)}">
        ${avatar(t.other)}<span class="dm-t"><b>${esc(at(faceOf(t.other).name))}</b><span>${t.last.sender_id === me ? 'You: ' : ''}${esc(preview(t.last))} · ${esc(when(t.last.created_at))}</span></span>
        ${t.unread ? '<i class="dm-dot" aria-label="Unread"></i>' : ''}</button>`).join('')}
      ${fresh.length || list.some((t) => !t.last) ? `<p class="dm-sec">Start a chat</p>` : ''}
      ${fresh.concat(list.filter((t) => !t.last).map((t) => ({ id: t.other }))).map((p) => `<button type="button" class="dm-row" data-dm-person="${esc(p.id)}">
        ${avatar(p.id)}<span class="dm-t"><b>${esc(at(faceOf(p.id).name))}</b><span>Tap to start a chat</span></span><span class="dm-pill">Message</span></button>`).join('')}
      ${!list.length && !fresh.length ? '<p class="dm-empty">Nobody else can message yet.</p>' : ''}
      <p class="dm-safe"><b>Kept clean on purpose.</b> No photos in messages. Cussing gets starred out, and sexual talk isn't sent at all.</p>`;
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
      <div class="dm-head"><button type="button" class="dm-x" data-dm-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button><span class="dm-who">${avatar(otherId)}<span><b>${esc(at(f.name))}</b><small>Private chat</small></span></span>${TEST_PILL}<button type="button" class="dm-more" data-dm-more aria-label="Block or report">⋯</button></div>
      <div class="dm-thread" aria-live="polite"><p class="dm-empty">Loading…</p></div>
      <p class="dm-busy" hidden></p>
      <div class="dm-bar">
        ${TRADES ? '<button type="button" class="dm-tradeb" data-dm-trade aria-label="Trade cards">⇄</button>' : ''}
        <textarea rows="1" placeholder="Message ${esc(at(f.name))}…" aria-label="Message" enterkeyhint="send"></textarea>
        <button type="button" class="dm-ico dm-sendb" data-dm-send aria-label="Send" disabled><svg viewBox="0 0 24 24"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg></button>
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
      sb().from('dm_messages').select('id, sender_id, body, photo_key, share_key, trade_id, created_at')
        .eq('thread_id', c.id).order('created_at', { ascending: false }).limit(80)
    ]);
    if (chat !== c) return;
    if (t) c.otherRead = t.user_a === me ? t.b_read_at : t.a_read_at;
    c.msgs = (msgs || []).reverse();
    await Promise.all([shareInfo(c.msgs), tradeInfo(c.msgs)]);
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
    const who = m.sender_id === me ? 'dm-me' : 'dm-them';
    const cls = 'dm-b ' + who + (m._pending ? ' dm-pending' : '') + (m._failed ? ' dm-failed' : '');
    let out = '';
    if (m.photo_key) {   /* no photos in messages (Jeff, 28 Sep) -- never show one */
      out += `<div class="${cls}"><i>Photo removed</i></div>`;
    }
    if (m.trade_id) out += `<div class="dm-b ${who} dm-tb">${tradeHTML(m.trade_id)}</div>`;
    if (m.share_key) {
      const s = shares.get(m.share_key) || { img: '', title: 'Shared', sub: 'Tap to open' };
      out += `<div class="${cls}"><a class="dm-share" href="/feed-next/?post=${esc(m.share_key)}">${s.img ? `<img src="${esc(s.img)}" alt="">` : '<span class="dm-ph">↗</span>'}<span><b>${esc(s.title)}</b><small>${esc(String(s.sub).slice(0, 60))}</small></span></a></div>`;
    }
    if (m.body) out += `<div class="${cls}">${linkHTML(m.body)}</div>`;
    if (m._failed) out += `<p class="dm-err">Not sent. ${esc(m._failed)}</p>`;
    return out;
  }

  function draw(c) {
    const box = c.el.querySelector('.dm-thread');
    if (!c.msgs.length) {
      const n = esc(at(faceOf(c.other).name));
      box.innerHTML = `<div class="dm-start">${avatar(c.other)}
        <h3>Start your chat with ${n}</h3>
        <p>Type below and tap the blue arrow, or tap one to send it now.</p>
        <div class="dm-quick">
          <button type="button" data-dm-quick="Hey! 👋">Hey! 👋</button>
          <button type="button" data-dm-quick="Check out my latest pull 🔥">Check out my latest pull 🔥</button>
          <button type="button" data-dm-quick="What's new at the shop?">What's new at the shop?</button>
        </div></div>`;
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
    const busy = el.querySelector('.dm-busy');
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
      if (e.target.closest('[data-dm-more]')) { chatMenu(c); return; }
      if (e.target.closest('[data-dm-trade]')) { openTrade(c); return; }
      const ta2 = e.target.closest('[data-dm-tans]');
      if (ta2) { answerTrade(c, ta2.getAttribute('data-dm-tid'), ta2.getAttribute('data-dm-tans')); return; }
      const q = e.target.closest('[data-dm-quick]');
      if (q) { sendMsg(c, { body: q.getAttribute('data-dm-quick') }); return; }
      const u = e.target.closest('[data-dm-unblur]');
      if (u) { u.classList.remove('dm-blur'); return; }
      const a = e.target.closest('.dm-share');
      if (a) {
        /* leave the chat screens, then open the post in the feed */
        e.preventDefault();
        const href = a.getAttribute('href');
        closeAll(); setTimeout(() => { location.href = href; }, 150);
      }
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




  /* ------------------------------------------------------- TRADES (28 Sep, Mike)
     ⇄ in the chat bar: pick your cards and theirs, the analyzer adds up
     both sides from the app's market prices, send it as a trade card.
     They can Accept, Counter or Decline; you can Cancel while it's open.
     Infinite Pulls isn't part of any trade -- nothing moves between
     collections; accepting just says "deal". */
  const FINE = "Infinite Pulls isn't part of any trade. Buying, selling and trading is between you. We don't hold, ship or guarantee anything.";
  const money = (n) => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const trades = new Map();
  async function tradeInfo(msgs, refresh) {
    const want = [...new Set(msgs.map((m) => m.trade_id).filter((id) => id && (!trades.has(id) || (refresh && trades.get(id).status === 'open'))))];
    if (!want.length) return;
    try {
      const { data } = await sb().rpc('dm_trade_details', { p_ids: want });
      (data || []).forEach((t) => trades.set(t.id, t));
    } catch (_) {}
  }

  const verdict = (give, get) => {
    const g = Number(give) || 0, r = Number(get) || 0;
    if (!g && !r) return 'No prices on these cards yet.';
    const d = Math.abs(g - r), big = Math.max(g, r);
    if (big && d / big <= 0.1) return '⚖️ About even';
    return g > r ? `You're giving ${money(d)} more` : `You're getting ${money(d)} more`;
  };
  const thumbs = (cards) => cards.slice(0, 5).map((c) => c.img ? `<img src="${esc(c.img)}" alt="${esc(c.name)}" loading="lazy">` : `<em>?</em>`).join('')
    + (cards.length > 5 ? `<em>+${cards.length - 5}</em>` : '');

  function tradeHTML(id) {
    const t = trades.get(id);
    if (!t) return `<div class="dm-trade"><h4><i>⇄</i> Trade offer</h4><p class="dm-fine">Loading…</p></div>`;
    const mineOut = t.from_id === me;
    const myCards = mineOut ? t.give : t.get, theirCards = mineOut ? t.get : t.give;
    const myVal = mineOut ? t.give_value : t.get_value, theirVal = mineOut ? t.get_value : t.give_value;
    const other = mineOut ? t.to_id : t.from_id;
    const label = { open: mineOut ? 'Waiting' : 'Your move', accepted: 'Accepted', declined: 'Declined', countered: 'Countered', cancelled: 'Cancelled' }[t.status] || t.status;
    let btns = '';
    if (t.status === 'open' && !mineOut) btns = `<div class="dm-tbtns">
        <button type="button" class="acc" data-dm-tans="accept" data-dm-tid="${esc(t.id)}">Accept</button>
        <button type="button" class="ctr" data-dm-tans="counter" data-dm-tid="${esc(t.id)}">Counter</button>
        <button type="button" class="dec" data-dm-tans="decline" data-dm-tid="${esc(t.id)}">Decline</button></div>`;
    else if (t.status === 'open') btns = `<div class="dm-tbtns one"><button type="button" class="dec" data-dm-tans="cancel" data-dm-tid="${esc(t.id)}">Cancel offer</button></div>`;
    return `<div class="dm-trade"><h4><i>⇄</i> Trade offer<span class="dm-st ${esc(t.status)}">${esc(label)}</span></h4>
      <div class="dm-side"><b>You give <span>${money(myVal)}</span></b><div class="dm-thumbs">${thumbs(myCards)}</div></div>
      <div class="dm-side"><b>You get from ${esc(at(faceOf(other).name))} <span>${money(theirVal)}</span></b><div class="dm-thumbs">${thumbs(theirCards)}</div></div>
      <p class="dm-verdict">${esc(verdict(myVal, theirVal))}</p>${btns}
      <p class="dm-fine">${esc(FINE)}</p></div>`;
  }

  async function answerTrade(c, id, ans) {
    const t = trades.get(id); if (!t) return;
    if (ans === 'counter') {
      openTrade(c, { give: (t.get || []).map((x) => x.id), get: (t.give || []).map((x) => x.id), replaces: t.id });
      return;
    }
    if (ans === 'accept') {
      const el = sheet(`<h3>Accept this trade?</h3><p>${esc(FINE)}</p><p>Nothing moves in the app. You two work out the swap, in person at the shop is safest.</p>
        <button type="button" class="stay" data-dm-yes style="background:#16a34a">Accept</button>
        <button type="button" class="go" data-dm-stay>Not yet</button>`);
      el.querySelector('[data-dm-yes]').addEventListener('click', () => { el._close(); doAnswer(c, id, ans); });
      return;
    }
    doAnswer(c, id, ans);
  }
  async function doAnswer(c, id, ans) {
    const r = await call({ action: 'trade_answer', trade_id: id, answer: ans });
    if (r.error) { say(r.error); return; }
    const t = trades.get(id); if (t) t.status = r.status;
    if (r.message && !c.msgs.some((m) => m.id === r.message.id)) c.msgs.push(r.message);
    draw(c);
  }

  async function openTrade(c, pre) {
    const other = c.other, n = at(faceOf(other).name);
    const pick = { give: new Set((pre && pre.give) || []), get: new Set((pre && pre.get) || []) };
    let side = 'give', find = '';
    const lists = { give: null, get: null };
    const el = layer('dm-trade', `
      <div class="dm-head"><button type="button" class="dm-x" data-dm-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button><h2>${pre && pre.replaces ? 'Counter' : 'Trade with'} ${esc(n)}</h2></div>
      <div class="dm-tr-tabs"><button type="button" class="on" data-side="give">You give</button><button type="button" data-side="get">You get</button></div>
      <input class="dm-tr-find" type="search" placeholder="Find a card…" aria-label="Find a card">
      <div class="dm-tg"><p class="dm-empty" style="grid-column:1/-1">Loading…</p></div>
      <div class="dm-tr-foot">
        <div class="dm-sum"><div>You give<b data-sum="give">$0.00</b></div><div>You get<b data-sum="get">$0.00</b></div></div>
        <div class="dm-bal"><i data-bal="give" style="background:#ff8a5b;width:50%"></i><i data-bal="get" style="background:#2fd27a;width:50%"></i></div>
        <p class="dm-say"></p>
        <button type="button" class="dm-send-trade" disabled>Send offer</button>
        <p class="dm-fine">${esc(FINE)}</p>
      </div>`);
    const grid = el.querySelector('.dm-tg'), tabs = el.querySelectorAll('[data-side]'), sendB = el.querySelector('.dm-send-trade');
    const byId = new Map();
    const paint = () => {
      tabs.forEach((b) => {
        const k = b.getAttribute('data-side');
        b.classList.toggle('on', k === side);
        b.textContent = (k === 'give' ? 'You give' : 'You get') + (pick[k].size ? ` (${pick[k].size})` : '');
      });
      const list = lists[side];
      if (!list) { grid.innerHTML = '<p class="dm-empty" style="grid-column:1/-1">Loading…</p>'; }
      else {
        const q = find.trim().toLowerCase();
        const rows = list.filter((x) => !q || (x.card_name + ' ' + (x.set_name || '')).toLowerCase().includes(q));
        grid.innerHTML = rows.length ? rows.map((x) => `<button type="button" class="dm-tc${pick[side].has(x.id) ? ' on' : ''}" data-tc="${esc(x.id)}">
            ${x.image_url ? `<img src="${esc(x.image_url)}" alt="" loading="lazy">` : '<span class="ph"></span>'}
            <b>${esc(x.card_name)}</b><small>${esc([x.set_name, x.condition && x.condition !== 'Near Mint' ? x.condition : ''].filter(Boolean).join(' · '))}</small>
            <span class="v">${money(x.value)}</span></button>`).join('')
          : `<p class="dm-empty" style="grid-column:1/-1">${list.length ? 'No cards match.' : side === 'give' ? 'No cards in your collection yet.' : esc(n) + ' has no cards yet.'}</p>`;
      }
      const sum = (k) => [...pick[k]].reduce((a, id) => a + (Number((byId.get(id) || {}).value) || 0), 0);
      const g = sum('give'), r = sum('get'), tot = g + r;
      el.querySelector('[data-sum="give"]').textContent = money(g);
      el.querySelector('[data-sum="get"]').textContent = money(r);
      el.querySelector('[data-bal="give"]').style.width = (tot ? g / tot * 100 : 50) + '%';
      el.querySelector('[data-bal="get"]').style.width = (tot ? r / tot * 100 : 50) + '%';
      el.querySelector('.dm-say').textContent = pick.give.size && pick.get.size ? verdict(g, r) : 'Pick at least one card on each side.';
      sendB.disabled = !(pick.give.size && pick.get.size);
    };
    el.addEventListener('click', async (e) => {
      const tb = e.target.closest('[data-side]');
      if (tb) { side = tb.getAttribute('data-side'); grid.scrollTop = 0; paint(); return; }
      const card = e.target.closest('[data-tc]');
      if (card) {
        const id = card.getAttribute('data-tc');
        if (pick[side].has(id)) pick[side].delete(id);
        else if (pick[side].size >= 12) { say('Up to 12 cards on each side.'); return; }
        else pick[side].add(id);
        paint(); return;
      }
      if (e.target.closest('.dm-send-trade')) {
        sendB.disabled = true; sendB.textContent = 'Sending…';
        const r = await call({ action: 'trade', thread_id: c.id, give: [...pick.give], get: [...pick.get], replaces: (pre && pre.replaces) || null });
        if (r.error || !r.message) { say(r.error || 'Could not send that offer.'); sendB.disabled = false; sendB.textContent = 'Send offer'; return; }
        el._close();
        if (pre && pre.replaces && trades.get(pre.replaces)) trades.get(pre.replaces).status = 'countered';
        if (!c.msgs.some((m) => m.id === r.message.id)) c.msgs.push(r.message);
        await tradeInfo([r.message]); draw(c);
      }
    });
    el.querySelector('.dm-tr-find').addEventListener('input', (e) => { find = e.target.value; paint(); });
    paint();
    /* your cards (with prices) and theirs, side by side */
    try {
      const [mine, theirs] = await Promise.all([
        sb().from('user_cards').select('id, card_name, set_name, image_url, variant, condition').eq('user_id', me).order('added_at', { ascending: false }).limit(1000),
        sb().rpc('dm_their_cards', { p_other: other })
      ]);
      const myRows = mine.data || [];
      if (myRows.length) {
        const { data: pr } = await sb().rpc('trade_prices', { p_ids: myRows.map((x) => x.id) });
        const pm = new Map((pr || []).map((x) => [x.id, x.value]));
        myRows.forEach((x) => { x.value = pm.has(x.id) ? pm.get(x.id) : null; });
      }
      const sortV = (a, b) => (Number(b.value) || 0) - (Number(a.value) || 0);
      lists.give = myRows.sort(sortV); lists.get = (theirs.data || []).sort(sortV);
      lists.give.concat(lists.get).forEach((x) => byId.set(x.id, x));
    } catch (_) { lists.give = lists.give || []; lists.get = lists.get || []; say('Could not load the cards. Try again.'); }
    paint();
  }

  /* ------------------------------------------------------- ASK TO CHAT (28 Sep, Mike)
     People who could message each other except they don't follow each
     other get "Ask to chat": a knock with no words or pictures, once a
     week. They see it in Messages with Follow back / No thanks. */
  const askSet = new Set();
  async function askTo(id) {
    let r = 'no';
    try { const { data } = await sb().rpc('dm_ask', { p_to: id }); r = data; } catch (_) {}
    if (r === 'ok') call({ action: 'ask_ping', to: id });
    say(r === 'ok' ? `Asked ${at(faceOf(id).name)}. If they follow you back, you can chat.`
      : r === 'wait' ? 'You already asked this week.' : 'That didn’t go through.');
  }
  async function myAsks() {
    try { const { data } = await sb().rpc('dm_my_asks'); (data || []).forEach((q) => faces.set(q.from_id, { name: q.username || 'someone', face: q.avatar_url || '' })); return data || []; }
    catch (_) { return []; }
  }
  async function answerAsk(from, yes) {
    let ok = false;
    try { const { data } = await sb().rpc('dm_answer_ask', { p_from: from, p_yes: yes }); ok = data === 'ok'; } catch (_) {}
    if (!ok) { say('That didn’t go through.'); return; }
    if (yes) {
      await refreshPeople();
      say(canSet.has(from) ? `You follow ${at(faceOf(from).name)} now. Say hi!` : `You follow ${at(faceOf(from).name)} now.`);
    }
    if (inboxEl) fillInbox();
    paintBadge();
  }

  /* ------------------------------------------------------- BLOCK + REPORT (28 Sep, Mike)
     The ⋯ on every chat: Block (same blocks as the rest of the app) or
     Report (goes to the moderators, who can then read THAT chat only). */
  let isMod = false;
  async function myBlocks() {
    try {
      const { data } = await sb().from('user_blocks').select('blocked_id').eq('blocker_id', me);
      return new Set((data || []).map((b) => b.blocked_id));
    } catch (_) { return new Set(); }
  }

  function chatMenu(c) {
    const n = esc(at(faceOf(c.other).name));
    const el = sheet(`<h3>${n}</h3>
      <button type="button" class="warn" data-dm-rep>Report this chat</button>
      <button type="button" class="go" data-dm-blk>Block ${n}</button>
      <button type="button" class="go" data-dm-stay style="border:0;color:#5b6477">Cancel</button>`);
    el.querySelector('[data-dm-rep]').addEventListener('click', () => { el._close(); setTimeout(() => reportChat(c), 150); });
    el.querySelector('[data-dm-blk]').addEventListener('click', () => { el._close(); setTimeout(() => blockPerson(c), 150); });
  }

  function reportChat(c) {
    const n = esc(at(faceOf(c.other).name));
    const why = ['Bothering or bullying me', 'Scam or bad trade', 'Sexual or not OK for kids', 'Spam', 'Something else'];
    const el = sheet(`<h3>Report ${n}</h3>
      <p>What's going on? The shop's moderators will read this chat. Nobody else will, and ${n} won't be told who reported.</p>
      ${why.map((w) => `<button type="button" class="opt" data-dm-why="${esc(w)}">${esc(w)}</button>`).join('')}
      <button type="button" class="go" data-dm-stay style="border:0;color:#5b6477">Cancel</button>`);
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-dm-why]'); if (!b) return;
      b.disabled = true;
      let ok = false;
      try { const { data } = await sb().rpc('dm_report', { p_thread: c.id, p_reason: b.getAttribute('data-dm-why') }); ok = data === 'ok'; } catch (_) {}
      if (ok) call({ action: 'report_ping', thread_id: c.id });
      el._close();
      if (!ok) { say('That didn’t go through. Try again.'); return; }
      setTimeout(() => {
        const done = sheet(`<h3>Thanks, it's reported</h3>
          <p>The moderators will take a look. Want to block ${n} too?</p>
          <button type="button" class="warn" data-dm-blk>Block ${n}</button>
          <button type="button" class="go" data-dm-stay>Not now</button>`);
        done.querySelector('[data-dm-blk]').addEventListener('click', () => { done._close(); setTimeout(() => blockPerson(c, true), 150); });
      }, 150);
    });
  }

  function blockPerson(c, sure) {
    const n = esc(at(faceOf(c.other).name));
    const doIt = async () => {
      try {
        const { error } = await sb().from('user_blocks').upsert({ blocker_id: me, blocked_id: c.other }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true });
        if (error) throw error;
      } catch (_) { say('That didn’t go through. Try again.'); return; }
      canSet.delete(c.other);
      closeAll();
      say(`${at(faceOf(c.other).name)} is blocked.`);
      document.querySelectorAll(`[data-dm-with="${c.other}"]`).forEach((b) => b.remove());
    };
    if (sure) { doIt(); return; }
    const el = sheet(`<h3>Block ${n}?</h3>
      <p>They can't message you, and you won't see each other's chats. They aren't told. You can unblock them later from their profile.</p>
      <button type="button" class="warn" data-dm-yes>Block</button>
      <button type="button" class="go" data-dm-stay>Cancel</button>`);
    el.querySelector('[data-dm-yes]').addEventListener('click', () => { el._close(); doIt(); });
  }

  /* MODERATORS: reported chats, read-only, only while the report is open */
  async function reportedChats() {
    if (!isMod) return [];
    try {
      const { data } = await sb().from('dm_reports').select('id, thread_id, reporter_id, reported_id, reason, created_at')
        .is('handled_at', null).order('created_at', { ascending: false }).limit(30);
      const rows = data || [];
      await loadFaces(rows.flatMap((r) => [r.reporter_id, r.reported_id]));
      return rows;
    } catch (_) { return []; }
  }

  async function openReported(threadId) {
    let t = null, msgs = [], reps = [];
    try {
      const [a, b, r] = await Promise.all([
        sb().from('dm_threads').select('id, user_a, user_b').eq('id', threadId).maybeSingle(),
        sb().from('dm_messages').select('id, sender_id, body, photo_key, share_key, trade_id, created_at').eq('thread_id', threadId).order('created_at', { ascending: true }).limit(500),
        sb().from('dm_reports').select('id, reporter_id, reported_id, reason').eq('thread_id', threadId).is('handled_at', null)
      ]);
      t = a.data; msgs = b.data || []; reps = r.data || [];
    } catch (_) {}
    if (!t) { say('That report was already cleared.'); if (inboxEl) fillInbox(); return; }
    await loadFaces([t.user_a, t.user_b]);
    await Promise.all([shareInfo(msgs), tradeInfo(msgs)]);
    const reported = (reps[0] && reps[0].reported_id) || t.user_b;
    let paused = null;
    try { const { data } = await sb().from('dm_banned').select('why').eq('user_id', reported).maybeSingle(); paused = data; } catch (_) {}
    let frozen = false;
    try { const { data } = await sb().from('member_freeze').select('user_id').eq('user_id', reported).maybeSingle(); frozen = !!data; } catch (_) {}
    const html = msgs.map((m) => bubble(Object.assign({}, m, { sender_id: m.sender_id === reported ? '__them' : me }))
      .replace('>', `><span class="dm-name">${esc(at(faceOf(m.sender_id).name))}</span>`)).join('');
    const el = layer('dm-mod', `
      <div class="dm-head"><button type="button" class="dm-x" data-dm-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button><h2>Reported chat</h2></div>
      <p class="dm-modnote">${reps.map((r) => `${esc(at(faceOf(r.reporter_id).name))}: ${esc(r.reason)}`).join('<br>')}<br>${paused ? (String(paused.why).startsWith('auto') ? `⏸ ${esc(at(faceOf(reported).name))}'s messages were paused automatically (${esc(String(paused.why).replace(/^auto: /, ''))}). Clearing lifts the pause.<br>` : `⛔ ${esc(at(faceOf(reported).name))}'s messages are already turned off.<br>`) : ''}${frozen ? `🧊 ${esc(at(faceOf(reported).name))} is frozen: no messages, comments or posts until every report about them is handled.<br>` : ''}Read-only. Clearing the report locks this chat again.</p>
      <div class="dm-thread">${html || '<p class="dm-empty">No messages.</p>'}</div>
      <div class="dm-modbar"><button type="button" class="clear" data-dm-clear>It's fine · clear</button><button type="button" class="off" data-dm-off>Turn off ${esc(at(faceOf(reported).name))}'s messages</button></div>`);
    const th = el.querySelector('.dm-thread'); th.scrollTop = th.scrollHeight;
    el.addEventListener('click', async (e) => {
      const clear = e.target.closest('[data-dm-clear]'), off = e.target.closest('[data-dm-off]');
      if (!clear && !off) return;
      e.target.closest('button').disabled = true;
      try {
        if (off) { const { data } = await sb().rpc('dm_revoke', { p_user: reported }); if (data !== 'ok') throw new Error('no'); }
        const { data: cl, error } = await sb().rpc('dm_clear_report', { p_thread: threadId });
        if (error || cl !== 'ok') throw error || new Error('no');
      } catch (_) { say('That didn’t go through. Try again.'); e.target.closest('button').disabled = false; return; }
      el._close();
      say(off ? `${at(faceOf(reported).name)} can't message anymore.` : 'Report cleared.');
      if (inboxEl) fillInbox();
      paintBadge();
    });
  }

  /* ------------------------------------------------------- LINKS (28 Sep, Mike)
     Any link can be sent; the server checks outside ones against Google's
     list of scam and malware sites first. In the bubble, OUR links open
     right here in the app. OUTSIDE links open a "You're leaving Infinite
     Pulls" screen first, showing where it really goes. Only http(s) and
     www. text becomes tappable -- the same things the server checks. */
  const OUR_HOSTS = ['infinitepulls.com', 'www.infinitepulls.com'];
  const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
  const trimUrl = (u) => u.replace(/[.,!?;:)\]}'"]+$/, '');
  const parseUrl = (raw) => {
    try { const u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); return /^https?:$/.test(u.protocol) ? u : null; } catch (_) { return null; }
  };
  const isOurs = (u) => !!u && (OUR_HOSTS.includes(u.hostname.toLowerCase()) || u.host === location.host);
  function linkHTML(text) {
    const src = String(text || '');
    let out = '', last = 0;
    src.replace(URL_RE, (m, _g, idx) => {
      const clean = trimUrl(m), u = parseUrl(clean);
      out += esc(src.slice(last, idx));
      if (!u) out += esc(clean);
      else if (isOurs(u)) out += `<a class="dm-link dm-ours" href="${esc(u.pathname + u.search + u.hash)}">${esc(clean)}</a>`;
      else out += `<a class="dm-link dm-out" href="${esc(u.href)}" data-dm-out="${esc(u.href)}" rel="noopener noreferrer nofollow">${esc(clean)}</a>`;
      last = idx + clean.length;
      return m;
    });
    return out + esc(src.slice(last));
  }

  function sheet(html) {
    const el = document.createElement('div');
    el.className = 'dm-leave'; el.setAttribute('role', 'dialog');
    el.innerHTML = `<div class="dm-leave-card">${html}</div>`;
    document.body.appendChild(el);
    const close = () => el.remove();
    const b = back(); if (b) b.push('dm-sheet', close);
    el._close = () => { const bb = back(); if (!bb || !bb.pop('dm-sheet')) close(); };
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-dm-stay]')) el._close(); });
    return el;
  }

  function leaving(href) {
    const u = parseUrl(href); if (!u) return;
    const el = sheet(`<h3>You're leaving Infinite Pulls</h3>
      <p>This link goes to another website:</p>
      <div class="dom">${esc(u.hostname.replace(/^www\./, ''))}<span class="full">${esc(u.href.slice(0, 160))}</span></div>
      <p>Only open links from people you trust. Never type a password or card number on a site you got from a chat.</p>
      <button type="button" class="stay" data-dm-stay>Stay here</button>
      <button type="button" class="go" data-dm-go>Open the link</button>`);
    el.querySelector('[data-dm-go]').addEventListener('click', () => {
      el._close();
      try { window.open(u.href, '_blank', 'noopener,noreferrer'); } catch (_) {}
    });
  }

  document.addEventListener('click', (e) => {
    const out = e.target.closest('[data-dm-out]');
    if (out) { e.preventDefault(); e.stopPropagation(); leaving(out.getAttribute('data-dm-out')); return; }
    const ours = e.target.closest('a.dm-ours');
    if (ours) { e.preventDefault(); e.stopPropagation(); const h = ours.getAttribute('href'); closeAll(); setTimeout(() => { location.href = h; }, 150); }
  }, true);

  /* ------------------------------------------------------- MESSAGES FIRST (28 Sep, Mike)
     Anywhere the app shares one of OUR links (profiles, cards, posts,
     Loops, anything added later), Messages comes first: a sheet with a big
     blue "Send in Messages", then "More ways to share" for text, Facebook,
     Instagram, TikTok and the rest. Sheets that already offer Messages,
     picture-only shares and invites to join go straight through. */
  const KEY_RE = /^[cprl]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  function wrapShare() {
    if (!navigator.share || navigator.share._ip) return;
    const orig = navigator.share.bind(navigator);
    const wrapped = function (data) {
      try {
        const d = data || {};
        const raw = d.url || ((String(d.text || '').match(URL_RE) || [])[0]) || '';
        const u = raw ? parseUrl(trimUrl(raw)) : null;
        const skip = !on || !canSet.size || !u || !isOurs(u) || (d.files && d.files.length)
          || /^join me/i.test(String(d.title || ''))
          || document.querySelector('[data-sh-dm],[data-sh="dm"]');
        if (skip) return orig(data);
        return new Promise((resolve) => {
          const el = sheet(`<h3>Share</h3>
            <button type="button" class="dm-big" data-dm-first>${MSG_ICON}<span>Send in Messages</span></button>
            <button type="button" class="go" data-dm-more>More ways to share</button>
            <button type="button" class="go" data-dm-stay style="border:0;color:#5b6477">Cancel</button>`);
          el.querySelector('[data-dm-first]').addEventListener('click', () => {
            el._close(); resolve();
            const k = u.searchParams.get('post');
            setTimeout(() => (k && KEY_RE.test(k)) ? pickAndShare(k) : pickAndShare(null, u.href), 150);
          });
          el.querySelector('[data-dm-more]').addEventListener('click', () => {
            el._close(); orig(data).then(resolve, resolve);
          });
          el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-dm-stay]')) resolve(); });
        });
      } catch (_) { return orig(data); }
    };
    wrapped._ip = true;
    try { navigator.share = wrapped; } catch (_) {}
  }

  /* ------------------------------------------------------- share into a chat */
  async function pickAndShare(key, link) {
    if (!on || (!key && !link)) return;
    let people = [];
    try { const { data } = await sb().rpc('dm_people'); people = data || []; } catch (_) {}
    if (!people.length) { say('Nobody to send it to yet.'); return; }
    people.forEach((p) => faces.set(p.id, { name: p.username || 'someone', face: p.avatar_url || '' }));
    const el = layer('dm-pick', `
      <div class="dm-head"><button type="button" class="dm-x" data-dm-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button><h2>Send to…</h2>${TEST_PILL}</div>
      <div class="dm-list">${people.map((p) => `<button type="button" class="dm-row" data-dm-to="${esc(p.id)}">${avatar(p.id)}<span class="dm-t"><b>${esc(at(p.username))}</b><span>Send ${esc(key ? shareWord(key) : 'this link')}</span></span></button>`).join('')}</div>`);
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-dm-to]'); if (!b) return;
      const to = b.getAttribute('data-dm-to');
      b.disabled = true;
      const r = await call({ action: 'open', to });
      if (r.error) { say(r.error); b.disabled = false; return; }
      el._close();
      setTimeout(async () => {
        await openChat(r.thread_id, to);
        if (chat) sendMsg(chat, key ? { share_key: key } : { body: link });
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
    b.innerHTML = msgMark() + '<span class="dm-n" hidden></span>';
    if (bell) tools.insertBefore(b, bell); else tools.appendChild(b);
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openInbox(); });
  }
  async function paintBadge() {
    const n = document.querySelector('[data-dm-open] .dm-n');
    if (!n) return;
    let count = 0;
    /* unread messages + chat requests (+ open reports for moderators) */
    try {
      let r = await sb().rpc('dm_badge');
      if (r.error) r = await sb().rpc('dm_unread');
      count = Number(r.data) || 0;
    } catch (_) {}
    n.hidden = !count; n.textContent = count > 9 ? '9+' : String(count);
    const b = n.parentElement; b.setAttribute('aria-label', count ? `Messages, ${count} new` : 'Messages');
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
              await Promise.all([shareInfo([m]), tradeInfo(chat.msgs, true)]); draw(chat);
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

  let addProfileBtn = () => {};
  async function refreshPeople() {
    try {
      const [{ data }, { data: ask }] = await Promise.all([sb().rpc('dm_people'), sb().rpc('dm_askable')]);
      canSet.clear(); askSet.clear();
      (data || []).forEach((p) => { canSet.add(p.id); faces.set(p.id, { name: p.username || 'someone', face: p.avatar_url || '' }); });
      (ask || []).forEach((p) => askSet.add(p.id));
      if (askSet.size) await loadFaces([...askSet]);
    } catch (_) {}
    addProfileBtn();
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
    on = true; api.on = true; wrapShare();
    try { const { data } = await sb().rpc('dm_is_open'); if (data === true) TEST_PILL = ''; } catch (_) {}
    try { const { data } = await sb().rpc('is_moderator'); isMod = data === true; } catch (_) {}
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    addIcon(); paintBadge(); listen();
    /* the MESSAGE (or ASK TO CHAT) button on profiles */
    await refreshPeople();
    /* A BIG BLUE "Message @name" ROW under the profile buttons, so it's
       obvious what to do (Mike, 28 Sep). Only on people you can message. */
    addProfileBtn = () => document.querySelectorAll('.prof.ph[data-owner]').forEach((box) => {
      const id = box.getAttribute('data-owner');
      const can = canSet.has(id), ask = !can && askSet.has(id);
      const have = box.querySelector('[data-dm-with],[data-dm-askbtn]');
      if (have && ((can && have.hasAttribute('data-dm-with')) || (ask && have.hasAttribute('data-dm-askbtn')))) return;
      if (have) have.remove();
      if (!can && !ask) return;
      const row = box.querySelector('.ph-btns'); if (!row) return;
      const b = document.createElement('button');
      b.className = 'dm-pbig' + (ask ? ' dm-ask' : ''); b.type = 'button';
      b.setAttribute(can ? 'data-dm-with' : 'data-dm-askbtn', id);
      b.innerHTML = MSG_ICON + '<span>' + (can ? 'Message ' : 'Ask to chat with ') + esc(at(faceOf(id).name)) + '</span>';
      row.after(b);
    });
    addProfileBtn();
    let queued = false;
    const soon = () => { if (queued || (!canSet.size && !askSet.size)) return; queued = true; setTimeout(() => { queued = false; addProfileBtn(); }, 300); };
    try { new MutationObserver(soon).observe(document.body, { childList: true, subtree: true }); } catch (_) {}
    document.addEventListener('click', (e) => {
      const k = e.target.closest('[data-dm-askbtn]');
      if (k) { e.preventDefault(); e.stopPropagation(); k.disabled = true; askTo(k.getAttribute('data-dm-askbtn')); return; }
      const b = e.target.closest('[data-dm-with]'); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      startWith(b.getAttribute('data-dm-with'));
    }, true);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) paintBadge(); });
    /* ?dm=1 opens Messages (for a link from a notification later) */
    /* ?reports=1 (a moderator's phone alert) opens the Reports screen */
    try {
      const u = new URL(location.href);
      if (u.searchParams.get('reports') === '1') {
        u.searchParams.delete('reports'); history.replaceState(history.state, '', u.pathname + u.search + u.hash);
        for (let k = 0; k < 30 && !(window.InfinitePullsReports && window.InfinitePullsReports.on); k++) await new Promise((r) => setTimeout(r, 200));
        if (window.InfinitePullsReports && window.InfinitePullsReports.open) window.InfinitePullsReports.open();
      }
    } catch (_) {}
    /* ?dm=1 opens Messages; ?dm=<chat id> (a phone alert) opens that chat */
    try {
      const u = new URL(location.href), d = u.searchParams.get('dm');
      if (d) {
        u.searchParams.delete('dm'); history.replaceState(history.state, '', u.pathname + u.search + u.hash);
        if (/^[0-9a-f-]{36}$/.test(d)) {
          const { data: t } = await sb().from('dm_threads').select('id, user_a, user_b').eq('id', d).maybeSingle();
          if (t && (t.user_a === me || t.user_b === me)) { await openInbox(); openChat(t.id, t.user_a === me ? t.user_b : t.user_a); }
          else openInbox();
        } else openInbox();
      }
    } catch (_) {}
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = [...document.querySelectorAll('.dm')].pop();
    if (top && top._close) top._close();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
