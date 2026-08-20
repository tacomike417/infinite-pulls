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

    const { data: profile, error } = await client()
      .from('profiles')
      .select('id, username, avatar_url, is_public, show_price')
      .eq('username', username)
      .maybeSingle();

    if(error || !profile){ notFound(); return; }

    const [{ data: rows }, { data: videos }] = await Promise.all([
      client().from('user_cards').select('id, card_id, card_name, set_name, image_url, variant, condition, quantity').eq('user_id', profile.id),
      client().from('profile_videos').select('id, url, caption').eq('user_id', profile.id).order('added_at', { ascending: false })
    ]);

    // A stale second request racing a navigation away from this page could
    // land after #profile-page is gone — bail rather than write into null.
    if(!root()) return;

    const cardRows = rows || [];
    const showPrice = profile.show_price !== false;
    let total = 0;
    let anyMissing = false;
    const cardById = {};

    if(showPrice && cardRows.length){
      const uniqueIds = [...new Set(cardRows.map(r => r.card_id))];
      await Promise.all(uniqueIds.map(async id => {
        const card = await fetchCardDetail(id);
        if(card) cardById[id] = card;
      }));
    }

    if(!root()) return;

    const cardsHtml = cardRows.length ? cardRows.map(row => {
      let priceHtml = '';
      if(showPrice){
        const card = cardById[row.card_id];
        const market = card ? priceForVariant(card, row.variant) : null;
        const lineValue = typeof market === 'number' ? market * row.quantity : null;
        if(lineValue !== null) total += lineValue; else anyMissing = true;
        priceHtml = `<strong>${lineValue !== null ? currency(lineValue) : 'price unavailable'}</strong>`;
      }
      return `
        <div class="info-row" style="align-items:center">
          <span style="display:flex; align-items:center; gap:10px; min-width:0;">
            ${row.image_url ? `<img src="${escapeHtml(row.image_url)}" alt="" style="width:34px;height:47px;object-fit:contain;flex:0 0 auto;">` : ''}
            <span style="min-width:0;">
              <strong style="display:block">${escapeHtml(row.card_name)} ${row.quantity > 1 ? `×${row.quantity}` : ''}</strong>
              <small>${escapeHtml(row.set_name || '')} · ${escapeHtml(VARIANT_LABELS[row.variant] || row.variant)} · ${escapeHtml(row.condition)}</small>
            </span>
          </span>
          ${priceHtml}
        </div>
      `;
    }).join('') : '<div class="empty-state">No cards added yet.</div>';

    el.innerHTML = `
      <section class="hero">
        <div style="display:flex; align-items:center; gap:16px;">
          <div style="width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,.06);border:1px solid var(--border);overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:1.8rem;flex:0 0 auto;">
            ${profile.avatar_url ? `<img src="${escapeHtml(profile.avatar_url)}" alt="" style="width:100%;height:100%;object-fit:cover">` : '🙂'}
          </div>
          <div>
            <div class="eyebrow">Collector Profile</div>
            <h1 style="margin:0">${escapeHtml(profile.username)}</h1>
          </div>
        </div>

        ${showPrice ? `
          <div class="notice" style="display:flex; justify-content:space-between; align-items:center;">
            <span>Estimated Collection Value *</span>
            <strong style="font-size:1.3rem">${currency(total)}</strong>
          </div>
          ${anyMissing ? '<p><small>Some cards don\'t have current pricing available and aren\'t included in the total.</small></p>' : ''}
          <p><small style="color:var(--muted)">* Estimated from <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a> (based on TCGplayer data), for reference only — not set or guaranteed by Infinite Pulls.</small></p>
        ` : ''}
      </section>

      <section class="hero section">
        <div class="eyebrow">Collection</div>
        <h1>Cards</h1>
        <div class="info-list">${cardsHtml}</div>
      </section>

      ${videos && videos.length ? `
        <section class="hero section">
          <div class="eyebrow">Pack Openings</div>
          <h1>Videos</h1>
          <div class="card-grid">${videos.map(videoCard).join('')}</div>
        </section>
      ` : ''}
    `;
  }

  window.InfinitePullsProfile = { init };
})();
