
// ---- Supabase (auth + banner + push notifications) ----
const supabaseConfig = window.InfinitePullsConfig || {};
const supabaseReady = !!(
  supabaseConfig.SUPABASE_URL &&
  !supabaseConfig.SUPABASE_URL.includes('YOUR-PROJECT-REF') &&
  supabaseConfig.SUPABASE_ANON_KEY &&
  !supabaseConfig.SUPABASE_ANON_KEY.includes('YOUR-SUPABASE')
);

// storageKey: keeps the admin's login completely separate from a
// customer's login on the public app — both share this same origin and
// Supabase project, so without distinct keys the two sessions would
// silently clobber each other in the browser's shared storage.
const supabaseClient = (supabaseReady && window.supabase)
  ? window.supabase.createClient(supabaseConfig.SUPABASE_URL, supabaseConfig.SUPABASE_ANON_KEY, {
      auth: { storageKey: 'infinite-pulls-admin-auth' }
    })
  : null;

const loginScreen = document.getElementById('login-screen');
const adminContent = document.getElementById('admin-content');
const loginForm = document.getElementById('login-form');
const loginStatus = document.getElementById('login-status');
const signOutBtn = document.getElementById('sign-out-btn');

function showSignedOut(message){
  if(loginScreen) loginScreen.hidden = false;
  if(adminContent) adminContent.hidden = true;
  if(signOutBtn) signOutBtn.hidden = true;
  if(loginStatus) loginStatus.textContent = message || '';
}

async function showSignedIn(){
  if(loginScreen) loginScreen.hidden = true;
  if(adminContent) adminContent.hidden = false;
  if(signOutBtn) signOutBtn.hidden = false;
  await loadBanner();
  await loadShopPulse();
  await loadCloverStatus();
  await refreshInventoryScanCard();
  await populate();
}

async function initAuth(){
  if(!supabaseClient){
    // No Supabase project configured yet — let the developer keep working
    // on everything else without being locked out.
    if(loginScreen) loginScreen.hidden = true;
    if(adminContent) adminContent.hidden = false;
    if(loginStatus) loginStatus.textContent = '';
    const banner = document.querySelector('#banner-card');
    const push = document.querySelector('#push-card');
    const shopPulse = document.querySelector('#shop-pulse-card');
    const clover = document.querySelector('#clover-card');
    const inventoryScan = document.querySelector('#inventory-scan-card');
    [banner, push, shopPulse, clover, inventoryScan].forEach(card => {
      if(card) card.innerHTML = '<h2>' + card.querySelector('h2').textContent + '</h2><p>Connect Supabase in config.js to enable this.</p>';
    });
    await populate();
    return;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  if(session) await showSignedIn();
  else showSignedOut();

  supabaseClient.auth.onAuthStateChange((_event, newSession) => {
    if(newSession) showSignedIn();
    else showSignedOut();
  });
}

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if(!supabaseClient) return;
  loginStatus.textContent = 'Signing in…';
  const email = loginForm.elements.email.value.trim();
  const password = loginForm.elements.password.value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  loginStatus.textContent = error ? error.message : '';
});

signOutBtn?.addEventListener('click', async () => {
  if(supabaseClient) await supabaseClient.auth.signOut();
});

// ---- Banner ----
const bannerMessageEl = document.getElementById('banner-message');
const bannerActiveEl = document.getElementById('banner-active');
const bannerStatusEl = document.getElementById('banner-status');

async function loadBanner(){
  if(!supabaseClient || !bannerMessageEl) return;
  const { data, error } = await supabaseClient.from('banner').select('message, active').eq('id', 1).maybeSingle();
  if(error){ bannerStatusEl.textContent = 'Could not load banner: ' + error.message; return; }
  bannerMessageEl.value = data?.message || '';
  bannerActiveEl.checked = !!data?.active;
}

document.getElementById('banner-publish')?.addEventListener('click', async () => {
  if(!supabaseClient) return;
  bannerStatusEl.textContent = 'Publishing…';
  const { error } = await supabaseClient.from('banner').update({
    message: bannerMessageEl.value.trim(),
    active: bannerActiveEl.checked
  }).eq('id', 1);
  bannerStatusEl.textContent = error
    ? 'Could not publish: ' + error.message
    : 'Published. Anyone who already closed the old banner will see this one.';
});

// ---- Push notifications ----
document.getElementById('push-send')?.addEventListener('click', async () => {
  if(!supabaseClient) return;
  const pushStatusEl = document.getElementById('push-status');
  const title = document.getElementById('push-title').value.trim() || 'Infinite Pulls';
  const body = document.getElementById('push-body').value.trim();
  const url = document.getElementById('push-url').value.trim() || undefined;

  if(!body){
    pushStatusEl.textContent = 'Write a message first.';
    return;
  }

  if(!confirm('Send this notification to every subscribed device right now?')) return;

  pushStatusEl.textContent = 'Sending…';
  const { data, error } = await supabaseClient.functions.invoke('send-notification', {
    body: { title, body, url }
  });

  pushStatusEl.textContent = error
    ? 'Could not send: ' + error.message
    : `Sent to ${data.sent} device(s)` + (data.failed ? `, ${data.failed} failed` : '') + '.';
});

// ---- Shop Pulse (aggregated wish list demand) ----
function escapeAdminHtml(value=''){
  return String(value).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

async function loadShopPulse(){
  const listEl = document.getElementById('shop-pulse-list');
  const statusEl = document.getElementById('shop-pulse-status');
  if(!supabaseClient || !listEl) return;
  statusEl.textContent = 'Loading…';
  const { data, error } = await supabaseClient.rpc('shop_wishlist_demand', { p_limit: 20 });
  if(error){ statusEl.textContent = 'Could not load: ' + error.message; listEl.innerHTML = ''; return; }
  statusEl.textContent = '';
  if(!data || !data.length){
    listEl.innerHTML = '<p><small>No wish list activity yet — this fills in once customers start adding cards they\'re hunting for.</small></p>';
    return;
  }
  listEl.innerHTML = data.map((row, i) => {
    const setPart = row.set_name ? ` <small style="color:var(--muted)">(${escapeAdminHtml(row.set_name)})</small>` : '';
    const variantPart = row.variants ? escapeAdminHtml(row.variants) : 'Any version';
    const qty = row.total_quantity ?? row.wanter_count;
    return `
    <div class="info-row" style="flex-direction:column; align-items:stretch; gap:4px">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:12px">
        <span>${i + 1}. ${escapeAdminHtml(row.card_name)}${setPart}</span>
        <strong style="white-space:nowrap">${row.wanter_count} customer${row.wanter_count === 1 ? '' : 's'}</strong>
      </div>
      <small style="color:var(--muted)">${variantPart} &middot; ${qty} cop${qty === 1 ? 'y' : 'ies'} wanted total</small>
    </div>
  `;
  }).join('');
}

document.getElementById('shop-pulse-refresh')?.addEventListener('click', loadShopPulse);

// ---- Shop Inventory (Clover) ----
// The Redirect URI is whatever domain this admin panel is actually
// running on — computed instead of hardcoded so it's correct whether
// this is the live site or a local test copy.
const cloverRedirectInput = document.getElementById('clover-redirect-uri');
if(cloverRedirectInput) cloverRedirectInput.value = location.origin + '/admin/clover-callback.html';

document.getElementById('clover-copy-redirect')?.addEventListener('click', async () => {
  const btn = document.getElementById('clover-copy-redirect');
  try{
    await navigator.clipboard.writeText(cloverRedirectInput.value);
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  }catch{
    cloverRedirectInput.select();
  }
});

function timeAgo(dateStr){
  if(!dateStr) return null;
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.round(diffMs / 60000);
  if(mins < 1) return 'just now';
  if(mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if(hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

async function loadCloverStatus(){
  const statusEl = document.getElementById('clover-status');
  if(!supabaseClient || !statusEl) return;
  const { data, error } = await supabaseClient.rpc('clover_connection_status');
  const status = Array.isArray(data) ? data[0] : data;

  if(error){ statusEl.innerHTML = `<small>Could not check connection: ${error.message}</small>`; return; }

  if(status?.connected){
    const synced = status.last_synced_at ? `Last synced ${timeAgo(status.last_synced_at)}.` : 'Not synced yet — click "Sync Inventory Now" below.';
    statusEl.innerHTML = `<small>✅ Connected to Clover. ${synced}</small>`;
  } else if(status?.has_credentials){
    statusEl.innerHTML = '<small>Client ID/Secret saved — one step left to connect it to the store (see the technical details below).</small>';
  } else {
    statusEl.innerHTML = '<small>Not connected yet — setup in progress.</small>';
  }

  if(status?.last_sync_error){
    statusEl.innerHTML += `<br><small style="color:#ff6b6b">Last sync problem: ${status.last_sync_error}</small>`;
  }
}

document.getElementById('clover-save-credentials')?.addEventListener('click', async () => {
  if(!supabaseClient) return;
  const statusEl = document.getElementById('clover-credentials-status');
  const clientId = document.getElementById('clover-client-id').value.trim();
  const clientSecret = document.getElementById('clover-client-secret').value.trim();
  if(!clientId || !clientSecret){ statusEl.textContent = 'Paste in both the Client ID and Client Secret first.'; return; }

  statusEl.textContent = 'Saving…';
  const { error } = await supabaseClient.rpc('clover_save_credentials', {
    p_client_id: clientId,
    p_client_secret: clientSecret
  });
  statusEl.textContent = error ? 'Could not save: ' + error.message : 'Saved — now finish Step 4 above.';
  if(!error){
    document.getElementById('clover-client-id').value = '';
    document.getElementById('clover-client-secret').value = '';
    await loadCloverStatus();
  }
});

document.getElementById('clover-sync-now')?.addEventListener('click', async () => {
  if(!supabaseClient) return;
  const statusEl = document.getElementById('clover-sync-status');
  statusEl.textContent = 'Syncing…';
  const { data, error } = await supabaseClient.functions.invoke('sync-clover-inventory', { body: {} });
  statusEl.textContent = (error || data?.error)
    ? 'Could not sync: ' + (data?.error || error.message)
    : `Synced ${data.synced} item(s).`;
  await loadCloverStatus();
});

// ---- Bulk Add Inventory (Snap a Pic) ----
// Same idea as the customer-facing "Scan a Card" feature in
// components/collection.js: client-side OCR (Tesseract.js, loaded on
// demand) reads the printed name off a photo, that becomes a TCGdex
// search, and tapping the right match confirms it — except confirming
// here creates a real item directly in the shop's live Clover inventory
// (via the clover-add-item Edge Function) instead of adding to a
// personal collection. These helpers are deliberately separate copies
// rather than shared imports, since admin.js and collection.js are
// already two fully independent scripts with no shared module system.
const TCGDEX_BASE = 'https://api.tcgdex.net/v2/en';
// Same reasoning as the matching constant in components/collection.js:
// TCGdex doesn't cap a plain name search server-side, so a name like
// "Charizard" can genuinely return 100+ cards across every set it's ever
// been printed in — the old hardcoded 20-result cap here was hiding most
// of them compared to full card-database apps.
const SEARCH_RESULT_LIMIT = 120;
let inventoryAddedCount = 0;

function invThumbUrl(image){
  return image ? `${image}/low.webp` : '';
}

function invSleep(ms){
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function invFetchTcgdex(url, attempts = 3){
  let lastErr;
  for(let i = 0; i < attempts; i++){
    try{
      const res = await fetch(url);
      if(res.ok) return await res.json();
      lastErr = new Error('TCGdex returned ' + res.status);
    }catch(err){ lastErr = err; }
    if(i < attempts - 1) await invSleep(400 * (i + 1));
  }
  throw lastErr;
}

async function invSearchCards(term){
  const cleaned = term.trim();
  if(!cleaned) return [];
  try{
    const json = await invFetchTcgdex(`${TCGDEX_BASE}/cards?name=${encodeURIComponent(cleaned)}`);
    return Array.isArray(json) ? json.slice(0, SEARCH_RESULT_LIMIT) : [];
  }catch{
    throw new Error('Card search is having trouble right now — try again in a moment.');
  }
}

async function invFetchCardDetail(id){
  return await invFetchTcgdex(`${TCGDEX_BASE}/cards/${encodeURIComponent(id)}`);
}

let invTesseractLoadPromise = null;
function invLoadTesseract(){
  if(window.Tesseract) return Promise.resolve();
  if(invTesseractLoadPromise) return invTesseractLoadPromise;
  invTesseractLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = () => resolve();
    script.onerror = () => { invTesseractLoadPromise = null; reject(new Error('Scanning tool could not load — check your connection and try again')); };
    document.head.appendChild(script);
  });
  return invTesseractLoadPromise;
}

function invDownscaleImageToCanvas(file, maxDim){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open that photo')); };
    img.src = url;
  });
}

function invExtractNameCandidates(rawText){
  const skipWords = /^(HP|BASIC|STAGE ?1|STAGE ?2|EX|GX|V|VMAX|VSTAR|POK[EÉ]MON|TRAINER|ENERGY|ITEM|SUPPORTER|STADIUM|WEAKNESS|RESISTANCE|RETREAT|COST)$/i;
  return String(rawText || '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length >= 3 && l.length <= 28)
    .filter(l => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\- ]*$/.test(l))
    .filter(l => !skipWords.test(l))
    .slice(0, 5);
}

function invBestMarketPrice(card){
  const prices = card?.pricing?.tcgplayer || {};
  const keys = Object.keys(prices).filter(k => k !== 'updated' && k !== 'unit');
  for(const key of keys){
    if(typeof prices[key]?.marketPrice === 'number') return prices[key].marketPrice;
  }
  return null;
}

async function invHandleScanFile(file){
  const resultsEl = document.getElementById('inventory-search-results');
  if(!resultsEl || !file) return;
  resultsEl.innerHTML = '<div class="empty-state">📷 Reading the photo… this can take a few seconds.</div>';

  let text = '';
  try{
    await invLoadTesseract();
    const canvas = await invDownscaleImageToCanvas(file, 1200);
    const result = await window.Tesseract.recognize(canvas, 'eng');
    text = result?.data?.text || '';
  }catch(err){
    invRenderSearchResults([], err.message || 'Could not read that photo — try a clearer, well-lit shot, or search by name above.');
    return;
  }

  const candidates = invExtractNameCandidates(text);
  for(const guess of candidates){
    try{
      const cards = await invSearchCards(guess);
      if(cards.length){
        invRenderSearchResults(cards, `Matched from the photo as "${guess}" — tap the right card below.`);
        return;
      }
    }catch{ /* try the next candidate line */ }
  }

  invRenderSearchResults([], "Couldn't match that photo to a card — try a clearer, well-lit photo, or search by name above.");
}

function invRenderSearchResults(cards, note){
  const resultsEl = document.getElementById('inventory-search-results');
  if(!resultsEl) return;

  if(!cards.length){
    resultsEl.innerHTML = `<div class="empty-state">${escapeAdminHtml(note || 'No cards found — try a different spelling.')}</div>`;
    return;
  }

  const cappedNote = cards.length >= SEARCH_RESULT_LIMIT
    ? `Showing the first ${SEARCH_RESULT_LIMIT} matches — search a more specific name (like "Charizard ex") to narrow it down.`
    : null;
  const defaultNote = cards.length === 1 ? 'Tap the card to set its price and stock count.' : `${cards.length} cards found — tap the right one below.`;

  resultsEl.innerHTML = `
    <p><small>${escapeAdminHtml(note || cappedNote || defaultNote)}</small></p>
    <div class="card-grid">
      ${cards.map(c => `
        <button type="button" class="card inv-search-result-btn" data-card-id="${escapeAdminHtml(c.id)}" style="text-align:left; cursor:pointer;">
          ${c.image
            ? `<img src="${escapeAdminHtml(invThumbUrl(c.image))}" alt="" loading="lazy" style="width:100%;aspect-ratio:245/337;object-fit:contain;margin-bottom:8px;">`
            : `<div style="width:100%;aspect-ratio:245/337;margin-bottom:8px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;"><small style="color:var(--muted)">No preview</small></div>`}
          <strong style="display:block">${escapeAdminHtml(c.name)}</strong>
        </button>
      `).join('')}
    </div>
    <div id="inventory-picker-detail" style="margin-top:14px"></div>
  `;

  resultsEl.querySelectorAll('.inv-search-result-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const detailEl = document.getElementById('inventory-picker-detail');
      detailEl.innerHTML = '<div class="empty-state">Loading card details…</div>';
      detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      try{
        const card = await invFetchCardDetail(btn.dataset.cardId);
        invShowAddForm(card);
      }catch(err){
        detailEl.innerHTML = `<div class="empty-state">${escapeAdminHtml(err.message || 'Could not load that card — try again.')}</div>`;
      }
    });
  });
}

function invShowAddForm(card){
  const detailEl = document.getElementById('inventory-picker-detail');
  if(!detailEl) return;
  const suggestedPrice = invBestMarketPrice(card);

  detailEl.innerHTML = `
    <div class="card section">
      <div style="display:flex; gap:12px;">
        ${card.image ? `<img src="${escapeAdminHtml(invThumbUrl(card.image))}" alt="" style="width:56px;height:78px;object-fit:contain;flex:0 0 auto;">` : ''}
        <div style="flex:1 1 auto; min-width:0;">
          <strong>${escapeAdminHtml(card.name)}</strong>
          <small style="display:block">${escapeAdminHtml(card.set?.name || '')}</small>
        </div>
      </div>
      <form id="inventory-add-form" class="form-grid" style="margin-top:10px">
        <label>Selling Price ($)<input type="number" name="price" step="0.01" min="0" value="${suggestedPrice !== null ? suggestedPrice.toFixed(2) : ''}" placeholder="e.g. 4.99" required></label>
        <label>Stock Count<input type="number" name="stock" min="0" value="1" required></label>
        <div class="form-actions"><button class="primary-btn" type="submit">Add to Clover Inventory</button></div>
      </form>
      ${suggestedPrice !== null ? `<p><small>Price pre-filled from today's estimated market value — change it to whatever the shop actually charges.</small></p>` : ''}
      <div id="inventory-add-status" class="save-status"></div>
    </div>
  `;

  document.getElementById('inventory-add-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const price = parseFloat(e.target.elements.price.value);
    const stock = parseInt(e.target.elements.stock.value, 10);
    const statusEl = document.getElementById('inventory-add-status');
    const button = e.target.querySelector('button');
    if(!(price >= 0) || !(stock >= 0)){ statusEl.textContent = 'Enter a valid price and stock count.'; return; }

    button.disabled = true;
    button.textContent = 'Adding…';
    statusEl.textContent = '';

    const { data, error } = await supabaseClient.functions.invoke('clover-add-item', {
      body: { name: card.name, price, stock_count: stock }
    });

    if(error || data?.error){
      button.disabled = false;
      button.textContent = 'Add to Clover Inventory';
      statusEl.textContent = 'Could not add: ' + (data?.error || error.message);
      return;
    }

    inventoryAddedCount++;
    updateInventorySessionCount();
    statusEl.textContent = data.warning ? data.warning : '';
    button.textContent = 'Added!';
    setTimeout(() => {
      const resultsEl = document.getElementById('inventory-search-results');
      if(resultsEl) resultsEl.innerHTML = '';
      document.getElementById('inventory-search-form')?.reset();
    }, 900);
  });
}

function updateInventorySessionCount(){
  const el = document.getElementById('inventory-scan-session-count');
  if(!el) return;
  el.innerHTML = inventoryAddedCount
    ? `<small>✅ ${inventoryAddedCount} item${inventoryAddedCount === 1 ? '' : 's'} added to Clover this session.</small>`
    : '';
}

async function refreshInventoryScanCard(){
  const locked = document.getElementById('inventory-scan-locked');
  const unlocked = document.getElementById('inventory-scan-unlocked');
  if(!supabaseClient || !locked || !unlocked) return;
  const { data } = await supabaseClient.rpc('clover_connection_status');
  const status = Array.isArray(data) ? data[0] : data;
  const connected = !!status?.connected;
  locked.hidden = connected;
  unlocked.hidden = !connected;
}

document.getElementById('inventory-search-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const term = e.target.elements.term.value.trim();
  const resultsEl = document.getElementById('inventory-search-results');
  if(!term || !resultsEl) return;
  resultsEl.innerHTML = '<div class="empty-state">Searching…</div>';
  try{
    const cards = await invSearchCards(term);
    invRenderSearchResults(cards);
  }catch(err){
    resultsEl.innerHTML = `<div class="empty-state">Search failed: ${escapeAdminHtml(err.message)}</div>`;
  }
});

document.getElementById('inventory-scan-btn')?.addEventListener('click', () => {
  document.getElementById('inventory-scan-input')?.click();
});
document.getElementById('inventory-scan-input')?.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if(file) invHandleScanFile(file);
});

initAuth();

const DEFAULT_DATA = {
  storeName: "Infinite Pulls",
  tagline: "TCG & Hobby Shop",
  announcement: "Welcome to Infinite Pulls!",
  shopUrl: "#",
  address: "Store address coming soon",
  mapUrl: "#",
  phone: "Phone coming soon",
  email: "Email coming soon",
  facebook: "#",
  instagram: "#",
  about: "Infinite Pulls is your local TCG and hobby shop.",
  hours: {
    Monday:"Coming soon", Tuesday:"Coming soon", Wednesday:"Coming soon",
    Thursday:"Coming soon", Friday:"Coming soon", Saturday:"Coming soon", Sunday:"Coming soon"
  },
  events: [],
  deals: []
};

const form = document.getElementById('admin-form');
const hoursFields = document.getElementById('hours-fields');
const statusEl = document.getElementById('save-status');

// Store Info/Hours/Events/Deals used to live only in this browser's
// localStorage (a prototype limitation). They're now published from
// Supabase's store_info table — same live-for-everyone pattern as the
// banner — so the shop's real hours/events/deals actually reach visitors.
// If Supabase isn't configured yet, this quietly falls back to
// localStorage so local development without a project still works.
async function getData(){
  if(supabaseClient){
    const { data, error } = await supabaseClient.from('store_info').select('data').eq('id', 1).maybeSingle();
    if(!error && data?.data) return {...DEFAULT_DATA, ...data.data};
    if(error) statusEl.textContent = 'Could not load store info: ' + error.message;
    return {...DEFAULT_DATA};
  }
  try{
    return {...DEFAULT_DATA, ...(JSON.parse(localStorage.getItem('infinitePullsData')) || {})};
  }catch{
    return {...DEFAULT_DATA};
  }
}

async function saveData(data){
  if(supabaseClient){
    const { error } = await supabaseClient.from('store_info').update({ data }).eq('id', 1);
    return error;
  }
  localStorage.setItem('infinitePullsData', JSON.stringify(data));
  return null;
}

function buildHours(data){
  hoursFields.innerHTML = Object.keys(DEFAULT_DATA.hours).map(day =>
    `<label>${day}<input name="hours_${day}" value="${String(data.hours?.[day] ?? '').replaceAll('"','&quot;')}"></label>`
  ).join('');
}

async function populate(){
  const data = await getData();
  ['storeName','announcement','shopUrl','address','mapUrl','phone','email','facebook','instagram','about']
    .forEach(key => { if(form.elements[key]) form.elements[key].value = data[key] ?? ''; });
  buildHours(data);
  currentEvents = Array.isArray(data.events) ? data.events : [];
  currentDeals = Array.isArray(data.deals) ? data.deals : [];
  renderEventsList();
  renderDealsList();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  // Re-fetch first and only overwrite the Store Info/Hours fields this
  // form owns — Events and Deals now save independently below, so this
  // has to avoid clobbering whatever's currently live for those.
  const fresh = await getData();
  const data = { ...fresh };
  ['storeName','announcement','shopUrl','address','mapUrl','phone','email','facebook','instagram','about']
    .forEach(key => data[key] = form.elements[key].value.trim());

  data.hours = {};
  Object.keys(DEFAULT_DATA.hours).forEach(day => data.hours[day] = form.elements[`hours_${day}`].value.trim());

  statusEl.textContent = 'Publishing…';
  const error = await saveData(data);
  statusEl.textContent = error ? ('Could not publish: ' + error.message) : 'Published — live for every visitor now.';
});

document.getElementById('reset-data').addEventListener('click', async () => {
  statusEl.textContent = 'Resetting…';
  const error = await saveData({});
  await populate();
  statusEl.textContent = error ? ('Could not reset: ' + error.message) : 'Demo data reset.';
});

// ---- Events ----
let currentEvents = [];

function renderEventsList(){
  const listEl = document.getElementById('events-list');
  if(!listEl) return;
  if(!currentEvents.length){
    listEl.innerHTML = '<p><small>No events added yet — fill in the fields below and click "+ Add This Event."</small></p>';
    return;
  }
  listEl.innerHTML = currentEvents.map((ev, i) => `
    <div class="info-row" style="align-items:flex-start">
      <span style="min-width:0">
        <strong style="display:block">${escapeAdminHtml(ev.title)}</strong>
        ${ev.date ? `<small style="display:block">${escapeAdminHtml(ev.date)}</small>` : ''}
        ${ev.description ? `<small style="display:block; color:var(--muted)">${escapeAdminHtml(ev.description)}</small>` : ''}
      </span>
      <button type="button" class="ghost-btn remove-event-btn" data-index="${i}" aria-label="Remove this event">✕</button>
    </div>
  `).join('');

  listEl.querySelectorAll('.remove-event-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentEvents.splice(Number(btn.dataset.index), 1);
      renderEventsList();
    });
  });
}

document.getElementById('event-add')?.addEventListener('click', () => {
  const titleEl = document.getElementById('event-title');
  const dateEl = document.getElementById('event-date');
  const descEl = document.getElementById('event-description');
  const title = titleEl.value.trim();
  if(!title){ document.getElementById('events-status').textContent = 'Give the event a name first.'; return; }

  currentEvents.push({ title, date: dateEl.value.trim(), description: descEl.value.trim() });
  titleEl.value = ''; dateEl.value = ''; descEl.value = '';
  document.getElementById('events-status').textContent = '';
  renderEventsList();
});

document.getElementById('events-save')?.addEventListener('click', async () => {
  const statusEl2 = document.getElementById('events-status');
  statusEl2.textContent = 'Saving…';
  const fresh = await getData();
  const error = await saveData({ ...fresh, events: currentEvents });
  statusEl2.textContent = error ? 'Could not save: ' + error.message : 'Saved — live for every visitor now.';
});

// ---- Deals ----
let currentDeals = [];

function renderDealsList(){
  const listEl = document.getElementById('deals-list');
  if(!listEl) return;
  if(!currentDeals.length){
    listEl.innerHTML = '<p><small>No deals added yet — fill in the fields below and click "+ Add This Deal."</small></p>';
    return;
  }
  listEl.innerHTML = currentDeals.map((d, i) => `
    <div class="info-row" style="align-items:flex-start">
      <span style="min-width:0">
        <strong style="display:block">${escapeAdminHtml(d.title)}</strong>
        ${d.description ? `<small style="display:block; color:var(--muted)">${escapeAdminHtml(d.description)}</small>` : ''}
      </span>
      <button type="button" class="ghost-btn remove-deal-btn" data-index="${i}" aria-label="Remove this deal">✕</button>
    </div>
  `).join('');

  listEl.querySelectorAll('.remove-deal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentDeals.splice(Number(btn.dataset.index), 1);
      renderDealsList();
    });
  });
}

document.getElementById('deal-add')?.addEventListener('click', () => {
  const titleEl = document.getElementById('deal-title');
  const descEl = document.getElementById('deal-description');
  const title = titleEl.value.trim();
  if(!title){ document.getElementById('deals-status').textContent = 'Give the deal a name first.'; return; }

  currentDeals.push({ title, description: descEl.value.trim() });
  titleEl.value = ''; descEl.value = '';
  document.getElementById('deals-status').textContent = '';
  renderDealsList();
});

document.getElementById('deals-save')?.addEventListener('click', async () => {
  const statusEl2 = document.getElementById('deals-status');
  statusEl2.textContent = 'Saving…';
  const fresh = await getData();
  const error = await saveData({ ...fresh, deals: currentDeals });
  statusEl2.textContent = error ? 'Could not save: ' + error.message : 'Saved — live for every visitor now.';
});
