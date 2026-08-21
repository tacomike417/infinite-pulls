(function(){
  // Public collector page — infinitepulls.com/username. No sign-in
  // required to view. Row Level Security (see supabase/schema.sql) is
  // what actually enforces privacy here: a private profile's rows never
  // come back from these queries at all, so this file never has to make
  // its own "is this allowed?" judgment call — if the query returns
  // nothing, it's either not public or doesn't exist, and both show the
  // same "not found" message on purpose (so a private page can't be
  // distinguished from one that was never claimed).
  const TCGDEX_BASE = 'https://api.tcgdex.net/v2/en';
  const VARIANT_LABELS = {
    normal: 'Normal',
    holofoil: 'Holofoil',
    'reverse-holofoil': 'Reverse Holofoil',
    '1st-edition': '1st Edition',
    '1st-edition-holofoil': '1st Edition Holofoil',
    unlimited: 'Unlimited',
    'unlimited-holofoil': 'Unlimited Holofoil'
  };

  function escapeHtml(value=''){
    return String(value).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[m]));
  }

  function client(){
    return window.InfinitePullsSupabase && window.InfinitePullsSupabase.client;
  }

  function root(){
    return document.getElementById('profile-page');
  }

  function currency(n){
    return typeof n === 'number' ? '$' + n.toFixed(2) : null;
  }

  function thumbUrl(image, size='low'){
    return image ? `${image}/${size}.webp` : '';
  }

  async function fetchCardDetail(id){
    try{
      const res = await fetch(`${TCGDEX_BASE}/cards/${encodeURIComponent(id)}`);
      if(!res.ok) return null;
      return await res.json();
    }catch{
      return null;
    }
  }

  function priceForVariant(card, variantKey){
    const entry = card?.pricing?.tcgplayer?.[variantKey];
    return typeof entry?.marketPrice === 'number' ? entry.marketPrice : null;
  }

  // Shared row renderer for both the owned-collection list and the wish
  // list — same look, same price math. Owned cards link to their own
  // detail page (see cardSlug() below); wish list rows don't, since a
  // wanted card doesn't have its own collection-row detail page yet.
  function buildRowsHtml(rows, cardById, showPrice, linkFor){
    let total = 0;
    let anyMissing = false;
    const html = rows.map(row => {
      let priceHtml = '';
      if(showPrice){
        const card = cardById[row.card_id];
        const market = card ? priceForVariant(card, row.variant) : null;
        const lineValue = typeof market === 'number' ? market * row.quantity : null;
        if(lineValue !== null) total += lineValue; else anyMissing = true;
        priceHtml = `<strong>${lineValue !== null ? currency(lineValue) : 'price unavailable'}</strong>`;
      }
      const inner = `
        <span style="display:flex; align-items:center; gap:10px; min-width:0;">
          ${row.image_url ? `<img src="${escapeHtml(row.image_url)}" alt="" style="width:34px;height:47px;object-fit:contain;flex:0 0 auto;">` : ''}
          <span style="min-width:0;">
            <strong style="display:block">${escapeHtml(row.card_name)} ${row.quantity > 1 ? `×${row.quantity}` : ''}</strong>
            <small>${escapeHtml(row.set_name || '')} · ${escapeHtml(VARIANT_LABELS[row.variant] || row.variant)} · ${escapeHtml(row.condition)}</small>
          </span>
        </span>
        ${priceHtml}
      `;
      const href = linkFor ? linkFor(row) : null;
      return href
        ? `<a class="info-row" href="${escapeHtml(href)}" data-path style="align-items:center; text-decoration:none; color:inherit; cursor:pointer;">${inner}</a>`
        : `<div class="info-row" style="align-items:center">${inner}</div>`;
    }).join('');
    return { html, total, anyMissing };
  }

  function totalBlockHtml(label, total, anyMissing){
    return `
      <div class="notice" style="display:flex; justify-content:space-between; align-items:center;">
        <span>${escapeHtml(label)}</span>
        <strong style="font-size:1.3rem">${currency(total)}</strong>
      </div>
      ${anyMissing ? '<p><small>Some cards don\'t have current pricing available and aren\'t included in the total.</small></p>' : ''}
    `;
  }

  const PRICE_DISCLAIMER = `<p><small style="color:var(--muted)">* Estimated from <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a> (based on TCGplayer data), for reference only — not set or guaranteed by Infinite Pulls.</small></p>`;

  // Every card in a collection gets its own shareable URL:
  // infinitepulls.com/username/collection/slug. The slug is the card's
  // name plus a short chunk of its collection-row id — readable, but also
  // guaranteed unique even if someone's added the same card twice (say,
  // two copies in different conditions).
  function slugify(text){
    return String(text).toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'card';
  }

  function cardSlug(row){
    return `${slugify(row.card_name)}-${String(row.id).replace(/-/g, '').slice(0, 8)}`;
  }

  // Shared by init() and initCard(): looks up a profile by username, only
  // ever returning it when it's actually public (or the query errors out,
  // which we treat the same as "not found" — see the file header comment).
  async function fetchPublicProfile(username){
    const { data, error } = await client()
      .from('profiles')
      .select('id, username, avatar_url, is_public, show_price, bio, tags, grail_card_id, grail_note, created_at')
      .eq('username', username)
      .maybeSingle();
    return error ? null : data;
  }

  function memberSince(createdAt){
    if(!createdAt) return null;
    try{
      return new Date(createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }catch{
      return null;
    }
  }

  function timeAgo(dateStr){
    const then = new Date(dateStr).getTime();
    if(Number.isNaN(then)) return '';
    const days = Math.floor((Date.now() - then) / 86400000);
    if(days <= 0) return 'today';
    if(days === 1) return 'yesterday';
    if(days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    if(months < 12) return `${months} month${months > 1 ? 's' : ''} ago`;
    const years = Math.floor(months / 12);
    return `${years} year${years > 1 ? 's' : ''} ago`;
  }

  // Total cards owned (counting quantity), how many different sets are
  // represented, and — when pricing is shown — the single most valuable
  // card, all computed from data already fetched for the Collection
  // section rather than a separate query.
  function computeStats(cardRows, cardById, showPrice){
    const totalCards = cardRows.reduce((sum, r) => sum + (r.quantity || 1), 0);
    const uniqueSets = new Set(cardRows.map(r => r.set_name).filter(Boolean)).size;
    let mostValuable = null;
    if(showPrice){
      cardRows.forEach(row => {
        const card = cardById[row.card_id];
        const market = card ? priceForVariant(card, row.variant) : null;
        const lineValue = typeof market === 'number' ? market * row.quantity : null;
        if(lineValue !== null && (!mostValuable || lineValue > mostValuable.value)){
          mostValuable = { row, value: lineValue };
        }
      });
    }
    return { totalCards, uniqueSets, mostValuable };
  }

  function latestRow(rows){
    return rows.reduce((latest, r) => {
      if(!r.added_at) return latest;
      return (!latest || new Date(r.added_at) > new Date(latest.added_at)) ? r : latest;
    }, null);
  }

  function youTubeId(url){
    try{
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '');
      if(host === 'youtu.be') return u.pathname.slice(1) || null;
      if(host === 'youtube.com' || host === 'm.youtube.com'){
        if(u.searchParams.get('v')) return u.searchParams.get('v');
        const embedMatch = u.pathname.match(/^\/embed\/([^/?]+)/);
        if(embedMatch) return embedMatch[1];
        const shortsMatch = u.pathname.match(/^\/shorts\/([^/?]+)/);
        if(shortsMatch) return shortsMatch[1];
      }
    }catch{ /* not a valid URL — falls through to the generic link card */ }
    return null;
  }

  function videoCard(v){
    const yid = youTubeId(v.url);
    if(yid){
      return `
        <div class="card section">
          <div style="position:relative;width:100%;aspect-ratio:16/9;border-radius:10px;overflow:hidden;">
            <iframe src="https://www.youtube.com/embed/${escapeHtml(yid)}" title="${escapeHtml(v.caption || 'Pack opening video')}"
              style="position:absolute;inset:0;width:100%;height:100%;border:0;"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
          </div>
          ${v.caption ? `<small style="display:block;margin-top:8px">${escapeHtml(v.caption)}</small>` : ''}
        </div>
      `;
    }
    // Not a recognized YouTube link — TikTok, Instagram, etc. Rather than
    // build (and maintain) a separate embed widget per platform, just link
    // out to it. Still gets the video on the page, just one tap away.
    let hostLabel = 'the video';
    try{ hostLabel = new URL(v.url).hostname.replace(/^www\./, ''); }catch{}
    return `
      <a class="card section" href="${escapeHtml(v.url)}" target="_blank" rel="noopener">
        <strong>▶ Watch on ${escapeHtml(hostLabel)}</strong>
        ${v.caption ? `<small style="display:block">${escapeHtml(v.caption)}</small>` : ''}
      </a>
    `;
  }

  // ---- Shareable "collector card" image ----
  // Renders a stylized summary image (avatar, grail/top card, stats) onto
  // a canvas so a visitor can save or share it — a social-friendly export
  // that no generic card-tracking app ties to this specific shop's page.
  // Every image load is best-effort: a failed/blocked load (CORS, a slow
  // network, whatever) just skips that visual instead of breaking the
  // whole thing, since this is a nice-to-have, not core functionality.
  function loadImageEl(url){
    return new Promise(resolve => {
      if(!url){ resolve(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function roundRectPath(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines){
    const words = String(text).split(/\s+/);
    let line = '';
    let lines = 0;
    for(let i = 0; i < words.length; i++){
      const test = line ? `${line} ${words[i]}` : words[i];
      if(ctx.measureText(test).width > maxWidth && line){
        ctx.fillText(line, x, y);
        line = words[i];
        y += lineHeight;
        lines++;
        if(lines >= maxLines - 1){
          let rest = words.slice(i).join(' ');
          while(ctx.measureText(rest + '…').width > maxWidth && rest.length) rest = rest.slice(0, -1);
          ctx.fillText(rest + (rest.length < String(text).length ? '…' : ''), x, y);
          return;
        }
      } else {
        line = test;
      }
    }
    if(line) ctx.fillText(line, x, y);
  }

  async function buildShareCanvas({ profile, stats, spotlightRow, spotlightImageUrl, spotlightIsGrail, showPrice, totalValue }){
    const W = 1000;

    // Images load first, before the canvas is even created — the final
    // canvas height depends on whether the spotlight card image actually
    // loaded (a fixed height assuming it always would leaves a big empty
    // gap on any profile without one, e.g. no grail set and a top card
    // with no image on file).
    const [logo, avatarImg, spotlightImg] = await Promise.all([
      loadImageEl('./assets/logo.png'),
      loadImageEl(profile.avatar_url),
      loadImageEl(spotlightImageUrl)
    ]);

    const cardW = 320, cardH = Math.round(cardW * (337 / 245));
    const spotlightBlockH = spotlightImg ? (cardH + 26 + (spotlightRow ? 46 : 0)) : 20;
    const H = 330 + spotlightBlockH + 90 + 90; // header+profile, spotlight, stats, footer

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0d1a2c');
    bg.addColorStop(1, '#07101f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#19bfff';
    ctx.beginPath(); ctx.ellipse(120, 60, 260, 200, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffc928';
    ctx.beginPath(); ctx.ellipse(W - 100, 120, 220, 180, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Header
    if(logo) ctx.drawImage(logo, 50, 46, 64, 64);
    ctx.fillStyle = '#f7f8fb';
    ctx.font = '800 26px Inter, sans-serif';
    ctx.fillText('INFINITE PULLS', 128, 78);
    ctx.fillStyle = '#9eb0c8';
    ctx.font = '400 16px Inter, sans-serif';
    ctx.fillText('TCG & Hobby Shop · Collector Card', 128, 100);

    // Avatar + username + bio
    const ax = 130, ay = 220, ar = 66;
    ctx.save();
    ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fill();
    ctx.clip();
    if(avatarImg) ctx.drawImage(avatarImg, ax - ar, ay - ar, ar * 2, ar * 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.2)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.stroke();

    ctx.fillStyle = '#f7f8fb';
    ctx.font = '800 40px Inter, sans-serif';
    ctx.fillText(profile.username, 224, 210);
    ctx.fillStyle = '#9eb0c8';
    ctx.font = '400 18px Inter, sans-serif';
    if(profile.bio){
      wrapCanvasText(ctx, profile.bio, 224, 240, 620, 24, 2);
    }

    let y = 330;

    // Spotlight card (grail if set, else the collection's most valuable)
    if(spotlightImg){
      const cardX = (W - cardW) / 2;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.5)';
      ctx.shadowBlur = 36;
      ctx.shadowOffsetY = 14;
      roundRectPath(ctx, cardX, y, cardW, cardH, 18);
      ctx.fillStyle = '#0d1a2c';
      ctx.fill();
      ctx.restore();
      ctx.save();
      roundRectPath(ctx, cardX, y, cardW, cardH, 18);
      ctx.clip();
      ctx.drawImage(spotlightImg, cardX, y, cardW, cardH);
      ctx.restore();
      y += cardH + 26;

      if(spotlightRow){
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffc928';
        ctx.font = '700 24px Inter, sans-serif';
        ctx.fillText(`${spotlightIsGrail ? '★ Grail Card' : 'Top Card'} · ${spotlightRow.card_name}`, W / 2, y);
        ctx.textAlign = 'left';
        y += 46;
      }
    } else {
      y += 20;
    }

    // Stats row
    const stats3 = [
      ['Total Cards', String(stats.totalCards)],
      ['Sets Repped', String(stats.uniqueSets)],
      showPrice ? ['Est. Value', currency(totalValue) || '$0.00'] : null
    ].filter(Boolean);

    const colW = (W - 100) / stats3.length;
    stats3.forEach(([label, value], i) => {
      const cx = 50 + colW * i + colW / 2;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f7f8fb';
      ctx.font = '800 30px Inter, sans-serif';
      ctx.fillText(value, cx, y + 34);
      ctx.fillStyle = '#9eb0c8';
      ctx.font = '600 15px Inter, sans-serif';
      ctx.fillText(label.toUpperCase(), cx, y + 58);
    });
    ctx.textAlign = 'left';

    // Footer
    ctx.textAlign = 'center';
    ctx.fillStyle = '#19bfff';
    ctx.font = '700 24px Inter, sans-serif';
    ctx.fillText(`infinitepulls.com/${profile.username}`, W / 2, H - 46);
    ctx.textAlign = 'left';

    return canvas;
  }

  async function shareCollectorCard(context, btn){
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Building image…';
    try{
      const canvas = await buildShareCanvas(context);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if(!blob) throw new Error('Could not generate image');
      const fileName = `infinite-pulls-${context.profile.username}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });

      if(navigator.canShare && navigator.canShare({ files: [file] })){
        await navigator.share({ files: [file], title: 'My Infinite Pulls Collector Card', text: `Check out my collection at infinitepulls.com/${context.profile.username}` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
    }catch(err){
      // A user cancelling the native share sheet also lands here (AbortError)
      // — not a real failure, so don't show an error for that case.
      if(err?.name !== 'AbortError') btn.textContent = 'Could not build image — try again';
      setTimeout(() => { btn.textContent = originalLabel; btn.disabled = false; }, 2000);
      return;
    }
    btn.disabled = false;
    btn.textContent = originalLabel;
  }

  function notFound(){
    const el = root();
    if(!el) return;
    el.innerHTML = `
      <section class="hero">
        <div class="eyebrow">Collector Profile</div>
        <h1>Page Not Found</h1>
        <p>There's no public collection at this address — it may not exist, or the owner has kept it private.</p>
      </section>
    `;
  }

  async function init(username){
    const el = root();
    if(!el) return;

    if(!window.InfinitePullsSupabase || !window.InfinitePullsSupabase.ready){
      el.innerHTML = `<section class="hero"><div class="eyebrow">Collector Profile</div><h1>Not available</h1></section>`;
      return;
    }

    const profile = await fetchPublicProfile(username);
    if(!profile){ notFound(); return; }

    const cardColumns = 'id, card_id, card_name, set_name, image_url, variant, condition, quantity, added_at';
    const [{ data: ownedRows }, { data: wantedRows }, { data: videos }] = await Promise.all([
      client().from('user_cards').select(cardColumns).eq('user_id', profile.id),
      client().from('wishlist_cards').select(cardColumns).eq('user_id', profile.id),
      client().from('profile_videos').select('id, url, caption').eq('user_id', profile.id).order('added_at', { ascending: false })
    ]);

    // A stale second request racing a navigation away from this page could
    // land after #profile-page is gone — bail rather than write into null.
    if(!root()) return;

    const cardRows = ownedRows || [];
    const wishRows = wantedRows || [];
    const showPrice = profile.show_price !== false;
    const cardById = {};

    if(showPrice && (cardRows.length || wishRows.length)){
      const uniqueIds = [...new Set([...cardRows, ...wishRows].map(r => r.card_id))];
      await Promise.all(uniqueIds.map(async id => {
        const card = await fetchCardDetail(id);
        if(card) cardById[id] = card;
      }));
    }

    if(!root()) return;

    const collectionListing = buildRowsHtml(cardRows, cardById, showPrice,
      row => `/${encodeURIComponent(profile.username)}/collection/${encodeURIComponent(cardSlug(row))}`);
    const wishlistListing = buildRowsHtml(wishRows, cardById, showPrice, null);

    const stats = computeStats(cardRows, cardById, showPrice);
    const latest = latestRow(cardRows);
    const grailRow = profile.grail_card_id ? cardRows.find(r => r.id === profile.grail_card_id) : null;
    const spotlightRow = grailRow || stats.mostValuable?.row || null;
    const spotlightIsGrail = !!grailRow;
    const spotlightCard = spotlightRow ? cardById[spotlightRow.card_id] : null;
    const spotlightImageUrl = spotlightCard?.image ? thumbUrl(spotlightCard.image, 'high') : (spotlightRow?.image_url || '');
    const joined = memberSince(profile.created_at);
    const tags = Array.isArray(profile.tags) ? profile.tags : [];

    el.innerHTML = `
      <section class="hero">
        <div style="display:flex; align-items:center; gap:16px;">
          <div style="width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,.06);border:1px solid var(--border);overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:1.8rem;flex:0 0 auto;">
            ${profile.avatar_url ? `<img src="${escapeHtml(profile.avatar_url)}" alt="" style="width:100%;height:100%;object-fit:cover">` : '🙂'}
          </div>
          <div style="min-width:0;">
            <div class="eyebrow">Collector Profile</div>
            <h1 style="margin:0">${escapeHtml(profile.username)}</h1>
            ${joined ? `<small style="color:var(--muted)">Collecting with Infinite Pulls since ${escapeHtml(joined)}</small>` : ''}
          </div>
        </div>
        ${profile.bio ? `<p style="margin-top:14px">${escapeHtml(profile.bio)}</p>` : ''}
        ${tags.length ? `<div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:${profile.bio ? '10px' : '14px'}">
          ${tags.map(t => `<span style="background:rgba(255,201,40,.1);border:1px solid rgba(255,201,40,.3);color:var(--gold);border-radius:999px;padding:5px 12px;font-size:.8rem;font-weight:700;">${escapeHtml(t)}</span>`).join('')}
        </div>` : ''}
        ${latest ? `<p style="margin-top:14px"><small style="color:var(--muted)">🆕 Latest pull: <strong style="color:var(--text)">${escapeHtml(latest.card_name)}</strong> · added ${escapeHtml(timeAgo(latest.added_at))}</small></p>` : ''}
        <div class="info-list" style="margin-top:14px">
          <div class="info-row"><span>Total Cards</span><strong>${stats.totalCards}</strong></div>
          <div class="info-row"><span>Sets Represented</span><strong>${stats.uniqueSets}</strong></div>
          ${showPrice && stats.mostValuable ? `<div class="info-row"><span>Most Valuable Card</span><strong>${escapeHtml(stats.mostValuable.row.card_name)} — ${currency(stats.mostValuable.value)}</strong></div>` : ''}
        </div>
        <div class="form-actions" style="margin-top:16px">
          <button type="button" id="share-card-btn" class="secondary-btn">📤 Share My Collector Card</button>
        </div>
      </section>

      ${grailRow ? `
        <section class="hero section">
          <div class="eyebrow">Grail Card</div>
          <h1>${escapeHtml(grailRow.card_name)}</h1>
          <div style="display:flex; gap:16px; margin-top:10px; flex-wrap:wrap;">
            ${grailRow.image_url ? `<img src="${escapeHtml(grailRow.image_url)}" alt="" style="width:120px;aspect-ratio:245/337;object-fit:contain;flex:0 0 auto;">` : ''}
            <div style="flex:1 1 200px; min-width:0;">
              <small style="color:var(--muted)">${escapeHtml(grailRow.set_name || '')} · ${escapeHtml(VARIANT_LABELS[grailRow.variant] || grailRow.variant)}</small>
              ${profile.grail_note ? `<p style="margin-top:8px">${escapeHtml(profile.grail_note)}</p>` : ''}
            </div>
          </div>
        </section>
      ` : ''}

      <section class="hero section">
        <div class="eyebrow">Collection</div>
        <h1>Cards</h1>
        ${showPrice ? totalBlockHtml('Estimated Collection Value *', collectionListing.total, collectionListing.anyMissing) : ''}
        <div class="info-list">${collectionListing.html || '<div class="empty-state">No cards added yet.</div>'}</div>
        ${showPrice ? PRICE_DISCLAIMER : ''}
      </section>

      <section class="hero section">
        <div class="eyebrow">Wish List</div>
        <h1>Cards They're Looking For</h1>
        ${showPrice ? totalBlockHtml('Estimated Wish List Value *', wishlistListing.total, wishlistListing.anyMissing) : ''}
        <div class="info-list">${wishlistListing.html || '<div class="empty-state">Nothing on the wish list yet.</div>'}</div>
        ${showPrice ? PRICE_DISCLAIMER : ''}
      </section>

      ${videos && videos.length ? `
        <section class="hero section">
          <div class="eyebrow">Pack Openings</div>
          <h1>Videos</h1>
          <div class="card-grid">${videos.map(videoCard).join('')}</div>
        </section>
      ` : ''}
    `;

    document.getElementById('share-card-btn')?.addEventListener('click', (e) => {
      shareCollectorCard({
        profile, stats, spotlightRow, spotlightImageUrl, spotlightIsGrail,
        showPrice, totalValue: collectionListing.total
      }, e.currentTarget);
    });
  }

  function cardNotFound(username){
    const el = root();
    if(!el) return;
    const backHref = `/${encodeURIComponent(username)}`;
    el.innerHTML = `
      <section class="hero">
        <div class="eyebrow">Collector Profile</div>
        <h1>Card Not Found</h1>
        <p>That card isn't in this collection anymore, or the link is wrong.</p>
        <p><a class="secondary-btn" href="${escapeHtml(backHref)}" data-path>Back to ${escapeHtml(username)}'s Collection</a></p>
      </section>
    `;
  }

  // The single-card page — infinitepulls.com/username/collection/slug.
  // Same public/private handling as init() above (see fetchPublicProfile),
  // plus a look-up against every field TCGdex's full-card endpoint offers,
  // since a shopper landing on one card via a shared link is probably
  // curious about more than just the price.
  async function initCard(username, slug){
    const el = root();
    if(!el) return;

    if(!window.InfinitePullsSupabase || !window.InfinitePullsSupabase.ready){
      el.innerHTML = `<section class="hero"><div class="eyebrow">Collector Profile</div><h1>Not available</h1></section>`;
      return;
    }

    const profile = await fetchPublicProfile(username);
    if(!profile){ notFound(); return; }

    const { data: rows } = await client()
      .from('user_cards')
      .select('id, card_id, card_name, set_name, image_url, variant, condition, quantity')
      .eq('user_id', profile.id);

    if(!root()) return;

    const row = (rows || []).find(r => cardSlug(r) === slug);
    if(!row){ cardNotFound(profile.username); return; }

    const card = await fetchCardDetail(row.card_id);
    if(!root()) return;

    const showPrice = profile.show_price !== false;
    const market = card ? priceForVariant(card, row.variant) : null;
    const lineValue = typeof market === 'number' ? market * row.quantity : null;
    const bigImage = card?.image ? thumbUrl(card.image, 'high') : (row.image_url || '');

    // Optional extras TCGdex sometimes includes on the full-card endpoint —
    // shown only when actually present, since coverage varies by card.
    const extraFields = [
      ['Rarity', card?.rarity],
      ['Category', card?.category],
      ['Illustrator', card?.illustrator],
      ['HP', card?.hp]
    ].filter(([, value]) => value);

    const backHref = `/${encodeURIComponent(profile.username)}`;

    el.innerHTML = `
      <section class="hero">
        <p><a href="${escapeHtml(backHref)}" data-path>&larr; Back to ${escapeHtml(profile.username)}'s Collection</a></p>
        <div style="display:flex; gap:18px; flex-wrap:wrap; margin-top:12px;">
          ${bigImage ? `<img src="${escapeHtml(bigImage)}" alt="" style="width:min(220px,45%);aspect-ratio:245/337;object-fit:contain;flex:0 0 auto;">` : ''}
          <div style="flex:1 1 220px; min-width:0;">
            <div class="eyebrow">Card</div>
            <h1 style="margin-top:2px">${escapeHtml(row.card_name)}</h1>
            <p>${escapeHtml(row.set_name || '')}</p>

            <div class="info-list">
              <div class="info-row"><span>Variant</span><strong>${escapeHtml(VARIANT_LABELS[row.variant] || row.variant)}</strong></div>
              <div class="info-row"><span>Condition</span><strong>${escapeHtml(row.condition)}</strong></div>
              <div class="info-row"><span>Quantity</span><strong>${escapeHtml(String(row.quantity))}</strong></div>
              ${extraFields.map(([label, value]) => `<div class="info-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join('')}
            </div>

            ${showPrice ? `
              <div class="notice" style="display:flex; justify-content:space-between; align-items:center;">
                <span>Estimated Value *</span>
                <strong style="font-size:1.3rem">${lineValue !== null ? currency(lineValue) : 'price unavailable'}</strong>
              </div>
              <p><small style="color:var(--muted)">* Estimated from <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a> (based on TCGplayer data), for reference only — not set or guaranteed by Infinite Pulls.</small></p>
            ` : ''}
          </div>
        </div>
      </section>
    `;
  }

  window.InfinitePullsProfile = { init, initCard };
})();
