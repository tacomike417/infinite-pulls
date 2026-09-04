
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

// components/collector-goals-data.js (and components/pokemon-data.js)
// expect a Supabase client at window.InfinitePullsSupabase — the same
// convention app.js uses on the public app. Set it here too so the
// Collector Goals admin section below can reuse that file's template CRUD
// functions unmodified instead of duplicating them.
window.InfinitePullsSupabase = { client: supabaseClient, config: supabaseConfig, ready: supabaseReady && !!supabaseClient };

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
  await loadShopStats();
  await loadBanner();
  await loadShopPulse();
  await loadCloverStatus();
  await populate();
  await loadGoalsAdmin();
  await loadMarketing();
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
    const stats = document.querySelector('#stats-card');
    const clover = document.querySelector('#clover-card');
    const marketing = document.querySelector('#marketing-card');
    [banner, push, stats, shopPulse, clover, marketing].forEach(card => {
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

function escapeAdminHtml(value=''){
  return String(value).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

// ---- The Shop at a Glance ----
// Counts of what customers have already done. Nothing here is tracked,
// logged or collected: every number is a count of rows the app created
// because somebody used it. The function returns totals only, never a
// row, so this shows how many and never who.

async function loadShopStats(){
  const tilesEl = document.getElementById('stats-tiles');
  const listEl = document.getElementById('stats-list');
  const statusEl = document.getElementById('stats-status');
  if(!supabaseClient || !tilesEl) return;
  statusEl.textContent = 'Loading…';

  const { data, error } = await supabaseClient.rpc('shop_stats');
  if(error){
    statusEl.textContent = 'Could not load: ' + error.message;
    tilesEl.innerHTML = '';
    listEl.innerHTML = '';
    return;
  }
  statusEl.textContent = '';
  const s = Array.isArray(data) ? (data[0] || {}) : (data || {});
  const n = (v) => Number(v || 0).toLocaleString();

  // The four worth seeing before anything else.
  const tiles = [
    { value: s.customers, label: 'Customers',
      note: 'People who have made an account' },
    { value: s.customers_new_7d, label: 'New this week',
      note: 'Signed up in the last 7 days' },
    { value: s.collectors_with_cards, label: 'Building collections',
      note: 'Customers with at least one card saved' },
    { value: s.customers_hunting, label: 'Hunting for cards',
      note: 'Customers with a wish list going' }
  ];
  tilesEl.innerHTML = tiles.map(t => `
    <div class="stat-tile">
      <b>${n(t.value)}</b>
      <span>${escapeAdminHtml(t.label)}</span>
      <small>${escapeAdminHtml(t.note)}</small>
    </div>
  `).join('');

  // Everything else, in plain rows.
  const rows = [
    ['Cards saved across all collections', n(s.cards_tracked)],
    ['Different cards being collected', n(s.different_cards)],
    ['Different cards people are hunting', n(s.cards_wanted)],
    ['Collector goals being chased', n(s.goals_being_chased)],
    ['Phones getting your notifications', n(s.notify_devices)],
    ['Public collector pages', n(s.public_pages)],
    ['New customers in the last 30 days', n(s.customers_new_30d)],
    ['Shop items synced from Clover', n(s.shop_items)]
  ];
  listEl.innerHTML = rows.map(([label, value]) => `
    <div class="info-row" style="align-items:center">
      <span>${escapeAdminHtml(label)}</span>
      <strong>${value}</strong>
    </div>
  `).join('');

  if(Number(s.customers || 0) === 0){
    listEl.insertAdjacentHTML('afterbegin',
      '<p><small>Nothing to count yet — these fill in as customers sign up and start using the app.</small></p>');
  }
}

document.getElementById('stats-refresh')?.addEventListener('click', loadShopStats);

// ---- Shop Pulse (aggregated wish list demand) ----
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
  listEl.innerHTML = data.map((row, i) => `
    <div class="info-row" style="align-items:center">
      <span>${i + 1}. ${escapeAdminHtml(row.card_name)}</span>
      <strong>${row.wanter_count} customer${row.wanter_count === 1 ? '' : 's'}</strong>
    </div>
  `).join('');
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
    statusEl.innerHTML = '<small>Client ID/Secret saved — finish Step 4 below to connect it to your store.</small>';
  } else {
    statusEl.innerHTML = '<small>Not connected yet — follow the steps below.</small>';
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
  currentVideos = Array.isArray(data.videos) ? data.videos.slice(0, 5) : [];
  renderEventsList();
  renderDealsList();
  renderVideoSlots();
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

// ---- Collector Goals ----
// Templates a visitor picks from on My Collector Goals — see
// components/collector-goals-data.js for the actual progress-calculation
// engine this just feeds. Unlike Events/Deals (one JSON blob), goal
// templates live in their own Supabase table (collector_goal_templates)
// so the app can query/order/enable them properly — this section talks
// to that table through the shared collector-goals-data.js functions
// rather than duplicating Supabase calls here.
function pdA(){ return window.InfinitePullsPokemonData; }
function cgA(){ return window.InfinitePullsCollectorGoals; }

let currentGoalTemplates = [];
let cachedSets = null;
let chaseListItems = [];

const RARITY_SUGGESTIONS = [
  'Common', 'Uncommon', 'Rare', 'Rare Holo', 'Double Rare', 'Ultra Rare',
  'Illustration Rare', 'Special Illustration Rare', 'Hyper Rare', 'Secret Rare',
  'ACE SPEC Rare', 'Promo',
];

async function loadGoalsAdmin(){
  const statusEl2 = document.getElementById('goals-admin-status');
  if(!cgA()){ if(statusEl2) statusEl2.textContent = 'Collector Goals engine not loaded.'; return; }
  try{
    currentGoalTemplates = await cgA().loadGoalTemplates({ forceRefresh: true });
  }catch(err){
    if(statusEl2) statusEl2.textContent = 'Could not load goal templates: ' + (err.message || err);
    currentGoalTemplates = [];
  }
  renderGoalsAdminList();
}

function renderGoalsAdminList(){
  const listEl = document.getElementById('goals-admin-list');
  if(!listEl) return;
  if(!currentGoalTemplates.length){
    listEl.innerHTML = '<p><small>No goal templates yet — click "+ New Goal Template" below.</small></p>';
    return;
  }
  const typeLabel = (t) => cgA()?.GOAL_TYPE_META?.[t]?.label || t;
  listEl.innerHTML = currentGoalTemplates.map((t, i) => `
    <div class="info-row" style="align-items:flex-start">
      <span style="min-width:0">
        <strong style="display:block">${escapeAdminHtml(t.icon || '🎯')} ${escapeAdminHtml(t.name)} ${t.enabled ? '' : '<small style="color:var(--muted)">(disabled)</small>'}</strong>
        <small style="display:block; color:var(--muted)">${escapeAdminHtml(typeLabel(t.goal_type))}</small>
        ${t.description ? `<small style="display:block">${escapeAdminHtml(t.description)}</small>` : ''}
      </span>
      <span style="display:flex; flex-direction:column; gap:4px; flex:0 0 auto;">
        <span style="display:flex; gap:4px;">
          <button type="button" class="ghost-btn goal-move-up" data-index="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up" style="padding:4px 8px;">↑</button>
          <button type="button" class="ghost-btn goal-move-down" data-index="${i}" ${i === currentGoalTemplates.length - 1 ? 'disabled' : ''} aria-label="Move down" style="padding:4px 8px;">↓</button>
        </span>
        <button type="button" class="ghost-btn goal-edit" data-id="${t.id}" style="padding:4px 8px;">Edit</button>
        <button type="button" class="ghost-btn goal-toggle-enabled" data-id="${t.id}" style="padding:4px 8px;">${t.enabled ? 'Disable' : 'Enable'}</button>
        <button type="button" class="danger-btn goal-delete" data-id="${t.id}" style="padding:4px 8px;">Delete</button>
      </span>
    </div>
  `).join('');

  listEl.querySelectorAll('.goal-move-up').forEach(btn => btn.addEventListener('click', () => moveGoalTemplate(Number(btn.dataset.index), -1)));
  listEl.querySelectorAll('.goal-move-down').forEach(btn => btn.addEventListener('click', () => moveGoalTemplate(Number(btn.dataset.index), 1)));
  listEl.querySelectorAll('.goal-edit').forEach(btn => btn.addEventListener('click', () => openGoalForm(currentGoalTemplates.find(t => t.id === btn.dataset.id))));
  listEl.querySelectorAll('.goal-toggle-enabled').forEach(btn => btn.addEventListener('click', () => toggleGoalEnabled(btn.dataset.id)));
  listEl.querySelectorAll('.goal-delete').forEach(btn => btn.addEventListener('click', () => deleteGoalTemplate(btn.dataset.id)));
}

async function moveGoalTemplate(index, delta){
  const target = index + delta;
  if(target < 0 || target >= currentGoalTemplates.length) return;
  const reordered = currentGoalTemplates.slice();
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  currentGoalTemplates = reordered;
  renderGoalsAdminList();
  const statusEl2 = document.getElementById('goals-admin-status');
  if(statusEl2) statusEl2.textContent = 'Saving order…';
  try{
    await cgA().reorderTemplates(reordered.map(t => t.id));
    if(statusEl2) statusEl2.textContent = 'Order saved.';
  }catch(err){
    if(statusEl2) statusEl2.textContent = 'Could not save order: ' + (err.message || err);
  }
  await loadGoalsAdmin();
}

async function toggleGoalEnabled(id){
  const t = currentGoalTemplates.find(x => x.id === id);
  if(!t) return;
  const statusEl2 = document.getElementById('goals-admin-status');
  if(statusEl2) statusEl2.textContent = 'Saving…';
  try{
    await cgA().updateTemplate(id, { enabled: !t.enabled });
    if(statusEl2) statusEl2.textContent = 'Saved.';
  }catch(err){
    if(statusEl2) statusEl2.textContent = 'Could not save: ' + (err.message || err);
  }
  await loadGoalsAdmin();
}

async function deleteGoalTemplate(id){
  const statusEl2 = document.getElementById('goals-admin-status');
  if(statusEl2) statusEl2.textContent = 'Deleting…';
  try{
    await cgA().deleteTemplate(id);
    if(statusEl2) statusEl2.textContent = 'Deleted. Any visitor who had it selected keeps their progress data, but it no longer shows as an active goal.';
  }catch(err){
    if(statusEl2) statusEl2.textContent = 'Could not delete: ' + (err.message || err);
  }
  await loadGoalsAdmin();
}

// ---- Goal template form (shared for create + edit) ----
function goalFormSettingsHtml(type, config){
  config = config || {};
  switch(type){
    case 'pokedex_range':
      return `
        <label>Start Dex #<input type="number" id="goal-setting-startDex" min="1" value="${config.startDex || 1}"></label>
        <label>End Dex #<input type="number" id="goal-setting-endDex" min="1" value="${config.endDex || 151}"></label>
      `;
    case 'generation':
      return `<label>Generation<select id="goal-setting-generationKey">${(pdA()?.GENERATION_RANGES || []).map(g => `<option value="${g.key}" ${g.key === config.generationKey ? 'selected' : ''}>${escapeAdminHtml(g.label)}</option>`).join('')}</select></label>`;
    case 'type':
      return `<label>Pokémon Type<select id="goal-setting-typeKey">${(pdA()?.TYPE_LIST || []).map(t => `<option value="${t.key}" ${t.key === config.typeKey ? 'selected' : ''}>${t.emoji} ${escapeAdminHtml(t.label)}</option>`).join('')}</select></label>`;
    case 'pokemon':
      return `
        <label>National Dex #<input type="number" id="goal-setting-dexId" min="1" value="${config.dexId || ''}" placeholder="e.g. 25 for Pikachu"></label>
        <label>Count Mode
          <select id="goal-setting-countMode">
            <option value="quantity" ${config.countMode !== 'unique' ? 'selected' : ''}>Total cards owned (quantity)</option>
            <option value="unique" ${config.countMode === 'unique' ? 'selected' : ''}>Unique cards only</option>
          </select>
        </label>
      `;
    case 'set_completion':
    case 'master_set':
      return `
        <label>Set<select id="goal-setting-setId"><option value="${escapeAdminHtml(config.setId || '')}">${escapeAdminHtml(config.setName || config.setId || 'Loading sets…')}</option></select></label>
        ${type === 'master_set' ? `<label>Master Total Override (optional)<input type="number" id="goal-setting-masterTotal" min="1" value="${config.masterTotal || ''}" placeholder="Leave blank to use the set's normal card count"></label>` : ''}
      `;
    case 'rarity':
      return `
        <label>Rarity<input type="text" id="goal-setting-rarity" list="goal-rarity-suggestions" value="${escapeAdminHtml(config.rarity || '')}" placeholder="e.g. Illustration Rare"></label>
        <datalist id="goal-rarity-suggestions">${RARITY_SUGGESTIONS.map(r => `<option value="${escapeAdminHtml(r)}">`).join('')}</datalist>
      `;
    case 'artist':
      return `<label>Illustrator<input type="text" id="goal-setting-illustrator" value="${escapeAdminHtml(config.illustrator || '')}" placeholder="e.g. Yuka Morii"></label>`;
    case 'chase_list':
      return `
        <div id="goal-chase-list" class="info-list" style="margin:8px 0"></div>
        <label>Card ID<input type="text" id="goal-chase-card-id" placeholder="e.g. base1-4"></label>
        <label>Display Name (optional)<input type="text" id="goal-chase-card-name" placeholder="e.g. Charizard"></label>
        <div class="admin-actions"><button type="button" class="ghost-btn" id="goal-chase-add">+ Add Card</button></div>
      `;
    case 'full_pokedex':
    default:
      return `<p><small>No extra settings needed — this tracks every Pokémon in the National Dex automatically.</small></p>`;
  }
}

function renderChaseListItems(){
  const el = document.getElementById('goal-chase-list');
  if(!el) return;
  if(!chaseListItems.length){
    el.innerHTML = '<p><small>No cards added yet.</small></p>';
    return;
  }
  el.innerHTML = chaseListItems.map((item, i) => `
    <div class="info-row">
      <span>${escapeAdminHtml(item.name || item.id)} <small style="color:var(--muted)">(${escapeAdminHtml(item.id)})</small></span>
      <button type="button" class="ghost-btn goal-chase-remove" data-index="${i}" aria-label="Remove">✕</button>
    </div>
  `).join('');
  el.querySelectorAll('.goal-chase-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      chaseListItems.splice(Number(btn.dataset.index), 1);
      renderChaseListItems();
      updateGoalPreview();
    });
  });
}

async function populateSetSelect(selectedSetId){
  const select = document.getElementById('goal-setting-setId');
  if(!select) return;
  try{
    if(!cachedSets) cachedSets = await cgA().loadAllSets();
    select.innerHTML = cachedSets.map(s => `<option value="${escapeAdminHtml(s.id)}" ${s.id === selectedSetId ? 'selected' : ''}>${escapeAdminHtml(s.name)} (${escapeAdminHtml(s.id)})</option>`).join('');
  }catch{
    select.innerHTML = `<option value="${escapeAdminHtml(selectedSetId || '')}">Could not load sets — type not available, try again</option>`;
  }
  updateGoalPreview();
}

function currentGoalFormConfig(){
  const type = document.getElementById('goal-form-type').value;
  switch(type){
    case 'pokedex_range':
      return { startDex: Number(document.getElementById('goal-setting-startDex')?.value) || 1, endDex: Number(document.getElementById('goal-setting-endDex')?.value) || 151 };
    case 'generation':
      return { generationKey: document.getElementById('goal-setting-generationKey')?.value };
    case 'type':
      return { typeKey: document.getElementById('goal-setting-typeKey')?.value };
    case 'pokemon':
      return { dexId: Number(document.getElementById('goal-setting-dexId')?.value) || null, countMode: document.getElementById('goal-setting-countMode')?.value || 'quantity' };
    case 'set_completion': {
      const select = document.getElementById('goal-setting-setId');
      return { setId: select?.value || null, setName: select?.selectedOptions?.[0]?.text || null };
    }
    case 'master_set': {
      const select = document.getElementById('goal-setting-setId');
      const masterTotal = document.getElementById('goal-setting-masterTotal')?.value;
      return { setId: select?.value || null, setName: select?.selectedOptions?.[0]?.text || null, masterTotal: masterTotal ? Number(masterTotal) : null };
    }
    case 'rarity':
      return { rarity: document.getElementById('goal-setting-rarity')?.value.trim() || null };
    case 'artist':
      return { illustrator: document.getElementById('goal-setting-illustrator')?.value.trim() || null };
    case 'chase_list':
      return { cardIds: chaseListItems.slice() };
    case 'full_pokedex':
    default:
      return {};
  }
}

function updateGoalPreview(){
  const previewEl = document.getElementById('goal-form-preview');
  if(!previewEl) return;
  const name = document.getElementById('goal-form-name').value.trim() || 'Goal Name';
  const icon = document.getElementById('goal-form-icon').value.trim() || '🎯';
  const type = document.getElementById('goal-form-type').value;
  // A live preview can't show a real visitor's actual progress (the admin
  // panel has no My Collection of its own) — this is just sample numbers
  // so the shop can see roughly how the card will read.
  const sampleCurrent = 62, sampleTotal = 100;
  const isFraction = ['pokedex_range', 'generation', 'set_completion', 'master_set', 'chase_list'].includes(type);
  previewEl.innerHTML = `
    <div class="eyebrow">Preview (sample numbers)</div>
    <strong style="font-size:1.1rem; display:block;">${escapeAdminHtml(icon)} ${escapeAdminHtml(name).toUpperCase()}</strong>
    ${isFraction
      ? `<span>${sampleCurrent} / ${sampleTotal}</span><span class="pokedex-progress-bar"><span class="pokedex-progress-fill" style="width:${sampleCurrent}%"></span></span><small>${sampleCurrent}% COMPLETE</small>`
      : `<span>${sampleCurrent} ${type === 'full_pokedex' ? 'Pokémon Discovered' : 'items'}</span>`}
  `;
}

function renderGoalFormSettings(type, config){
  const el = document.getElementById('goal-form-settings');
  el.innerHTML = goalFormSettingsHtml(type, config || {});
  el.querySelectorAll('input, select').forEach(input => input.addEventListener('input', updateGoalPreview));
  if(type === 'set_completion' || type === 'master_set') populateSetSelect(config?.setId);
  if(type === 'chase_list'){
    chaseListItems = Array.isArray(config?.cardIds) ? config.cardIds.slice() : [];
    renderChaseListItems();
    document.getElementById('goal-chase-add')?.addEventListener('click', () => {
      const idEl = document.getElementById('goal-chase-card-id');
      const nameEl = document.getElementById('goal-chase-card-name');
      const id = idEl.value.trim();
      if(!id) return;
      chaseListItems.push({ id, name: nameEl.value.trim() || id });
      idEl.value = ''; nameEl.value = '';
      renderChaseListItems();
      updateGoalPreview();
    });
  }
  updateGoalPreview();
}

function resetGoalForm(){
  const form = document.getElementById('goals-admin-form');
  form.reset();
  document.getElementById('goal-form-id').value = '';
  document.getElementById('goal-form-enabled').checked = true;
  document.getElementById('goal-form-order').value = currentGoalTemplates.length + 1;
  chaseListItems = [];
  renderGoalFormSettings(document.getElementById('goal-form-type').value, {});
}

function openGoalForm(template){
  const form = document.getElementById('goals-admin-form');
  form.hidden = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if(!template){
    resetGoalForm();
    return;
  }
  document.getElementById('goal-form-id').value = template.id;
  document.getElementById('goal-form-name').value = template.name || '';
  document.getElementById('goal-form-description').value = template.description || '';
  document.getElementById('goal-form-icon').value = template.icon || '';
  document.getElementById('goal-form-badge').value = template.badge_text || '';
  document.getElementById('goal-form-type').value = template.goal_type;
  document.getElementById('goal-form-enabled').checked = template.enabled !== false;
  document.getElementById('goal-form-order').value = template.display_order || 1;
  renderGoalFormSettings(template.goal_type, template.config || {});
}

document.getElementById('goals-admin-new')?.addEventListener('click', () => openGoalForm(null));
document.getElementById('goal-form-cancel')?.addEventListener('click', () => {
  document.getElementById('goals-admin-form').hidden = true;
});
document.getElementById('goal-form-type')?.addEventListener('change', (e) => renderGoalFormSettings(e.target.value, {}));
['goal-form-name', 'goal-form-icon'].forEach(id => document.getElementById(id)?.addEventListener('input', updateGoalPreview));

document.getElementById('goals-admin-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl2 = document.getElementById('goals-admin-status');
  const id = document.getElementById('goal-form-id').value;
  const fields = {
    name: document.getElementById('goal-form-name').value.trim(),
    description: document.getElementById('goal-form-description').value.trim() || null,
    icon: document.getElementById('goal-form-icon').value.trim() || null,
    badge_text: document.getElementById('goal-form-badge').value.trim() || null,
    goal_type: document.getElementById('goal-form-type').value,
    config: currentGoalFormConfig(),
    enabled: document.getElementById('goal-form-enabled').checked,
    display_order: Number(document.getElementById('goal-form-order').value) || 1,
  };
  if(!fields.name){ statusEl2.textContent = 'Give the goal a name first.'; return; }
  statusEl2.textContent = 'Saving…';
  try{
    if(id) await cgA().updateTemplate(id, fields);
    else await cgA().createTemplate(fields);
    document.getElementById('goals-admin-form').hidden = true;
    statusEl2.textContent = 'Saved — live for every visitor now.';
  }catch(err){
    statusEl2.textContent = 'Could not save: ' + (err.message || err);
    return;
  }
  await loadGoalsAdmin();
});


/* ============================================================
   MARKETING — the poster prompt builder.

   What this is solving, plainly: the shop owner writes his own Facebook
   posts and they open with "here we go kids". He is not short of effort,
   he is short of a house style, and asking him to learn prompt-writing on
   top of running a shop is asking for the wrong thing.

   So he never writes a prompt. He answers four questions -- what is it
   for, where are the numbers, what should it look like, anything else --
   and the prompt gets built around his answers from a template in
   marketing_prompts. The craft lives in the template; the form just fills
   in the blanks.

   NOTHING HERE PUBLISHES ANYTHING. Every other card in this panel reaches
   customers the moment you press the button. This one writes text and puts
   it on the clipboard, which is worth saying out loud on a page where that
   is not the norm.
   ============================================================ */

const POSTER_SLUG = 'poster';
let marketingPrompt = null;

// How much prompt the deep link will carry.
//
// This was 1800, guessed conservatively before anybody had measured it --
// and the real poster prompt encodes to about 4500, so `fits` was ALWAYS
// false. Every Send fell back to a plain ChatGPT tab with an empty
// composer, which from the outside looks exactly like a button that does
// nothing. It was doing precisely what it was told.
//
// Measured rather than guessed the second time: a 3160-character prompt
// (4302 encoded) arrives in the composer complete, every character.
//
// Then the template grew -- the brand-kit links and the QR rule took it to
// about 7200 encoded, which left almost no room for anything typed into
// "Anything else?". 8000 would have started failing again the first time he
// wrote three sentences of notes, and failing the same way: an empty
// composer and no explanation.
//
// 14000 is chosen against what actually breaks rather than what feels safe.
// The limit that matters is the edge in front of ChatGPT, not the browser
// (Chrome handles URLs orders of magnitude longer than this) and not an
// origin server's 8k default (there is no origin here -- the query string is
// read by their front end). It leaves room for the template to grow again
// and for real notes on top.
//
// And if it is ever exceeded, nothing silently breaks: the clipboard is
// loaded either way and the status line says so, loudly.
const CHATGPT_URL_LIMIT = 14000;

const posterTitleEl   = document.getElementById('poster-title');
const posterSourceEl  = document.getElementById('poster-source');
const posterLookEl    = document.getElementById('poster-look');
const posterShapeEl   = document.getElementById('poster-shape');
const posterNotesEl   = document.getElementById('poster-notes');
const posterPreviewEl = document.getElementById('poster-preview');
const posterStatusEl  = document.getElementById('poster-status');
const posterAttachEl  = document.getElementById('poster-attachments');

async function loadMarketing(){
  const body = document.getElementById('marketing-body');
  if(!supabaseClient || !body) return;
  try{
    const { data, error } = await supabaseClient
      .from('marketing_prompts').select('*').eq('slug', POSTER_SLUG).maybeSingle();
    if(error) throw error;
    if(!data){
      document.getElementById('marketing-blurb').textContent =
        'Run supabase/marketing.sql on the project, then reload this page.';
      return;
    }
    marketingPrompt = data;
    document.getElementById('marketing-blurb').textContent = data.blurb || '';
    body.hidden = false;
    renderLookChoices();
    renderShapeChoices();
    renderAttachments();
    renderPosterPreview();
    // Your editor, not his. ?prompts=1 keeps it out of the way of somebody
    // who came here to make a poster -- it is not a lock, and is not meant
    // to be one; the point is that he never meets a box of instructions he
    // did not ask for and cannot judge.
    if(new URLSearchParams(location.search).get('prompts') === '1'){
      const ed = document.getElementById('prompt-editor');
      if(ed){ ed.hidden = false; fillPromptEditor(); }
    }
  }catch(err){
    document.getElementById('marketing-blurb').textContent =
      'Could not load the marketing prompts: ' + (err.message || err);
  }
}

function posterLooks(){
  const raw = marketingPrompt && marketingPrompt.options;
  return Array.isArray(raw) ? raw : [];
}

function posterShapes(){
  const raw = marketingPrompt && marketingPrompt.shapes;
  return Array.isArray(raw) ? raw : [];
}

function fillSelect(el, list){
  if(!el) return;
  el.innerHTML = list
    .map(o => '<option value="' + escapeAdminHtml(o.id) + '">' + escapeAdminHtml(o.label) + '</option>')
    .join('');
  // A select with nothing in it is a select nobody can use. Hide the whole
  // row rather than showing an empty dropdown.
  const row = el.closest('label');
  if(row) row.hidden = !list.length;
}

function renderLookChoices(){ fillSelect(posterLookEl, posterLooks()); }
function renderShapeChoices(){ fillSelect(posterShapeEl, posterShapes()); }

/* What to attach, and where to get it.
 *
 * The list is written by you as plain sentences. The brand files come from
 * marketing_assets, which holds a real URL for each -- so this is not a
 * reminder to go and find the logo, it is a Download button for the logo.
 * On a phone that is the difference between a step he does and a step he
 * skips. */
async function loadBrandFiles(){
  if(!supabaseClient) return [];
  try{
    const { data, error } = await supabaseClient
      .from('marketing_assets').select('*').order('sort');
    if(error) throw error;
    return data || [];
  }catch(_){ return []; }
}

async function renderAttachments(){
  if(!posterAttachEl) return;
  const said = Array.isArray(marketingPrompt && marketingPrompt.attachments)
    ? marketingPrompt.attachments : [];
  const files = await loadBrandFiles();
  if(!said.length && !files.length){ posterAttachEl.hidden = true; return; }
  posterAttachEl.hidden = false;

  let html = '<h4>Attach these in ChatGPT before you send</h4>';
  if(said.length){
    html += '<ul>' + said.map(x => '<li>' + escapeAdminHtml(String(x)) + '</li>').join('') + '</ul>';
  }
  if(files.length){
    html += '<h4 style="margin-top:12px">The files</h4><ul>'
      + files.map(f =>
          '<li><a href="' + escapeAdminHtml(f.url) + '" target="_blank" rel="noopener" download>'
          + escapeAdminHtml(f.label) + '</a>'
          + (f.note ? ' — ' + escapeAdminHtml(f.note) : '') + '</li>').join('')
      + '</ul>';
  }
  html += '<p>The prompt cannot carry files — save them, then drag them in once ChatGPT is open.</p>';
  posterAttachEl.innerHTML = html;
}

/* Fills the template.
 *
 * An empty answer takes its whole line out rather than leaving "Title:" with
 * nothing after it -- a prompt with blanks in it reads to ChatGPT as a
 * question, and it will happily invent an answer.
 *
 * A placeholder the template asks for and the form does not have is left
 * exactly as written. A typo like {{titel}} then shows up in the preview
 * where you can see it, instead of quietly deleting the title. */
function buildPosterPrompt(){
  if(!marketingPrompt) return '';
  const look  = posterLooks().find(o => o.id === (posterLookEl && posterLookEl.value));
  const shape = posterShapes().find(o => o.id === (posterShapeEl && posterShapeEl.value));
  const values = {
    title:   (posterTitleEl && posterTitleEl.value.trim())  || '',
    source:  (posterSourceEl && posterSourceEl.value.trim()) || '',
    notes:   (posterNotesEl && posterNotesEl.value.trim())   || '',
    palette: (look && look.instruction) || '',
    shape:   (shape && shape.instruction) || ''
  };
  return String(marketingPrompt.template || '')
    .split('\n')
    .map(line => {
      const asked = [...line.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
      const known = asked.filter(k => k in values);
      // A line whose only content was an answer he did not give goes.
      if(known.length && known.every(k => !values[k])) return null;
      return line.replace(/\{\{(\w+)\}\}/g, (whole, key) =>
        (key in values) ? values[key] : whole);
    })
    .filter(line => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderPosterPreview(){
  const prompt = buildPosterPrompt();
  if(posterPreviewEl) posterPreviewEl.textContent = prompt || '(fill something in above)';
  syncSendLink(prompt);
}

/* Keeps the Send link pointing at the current prompt.
 *
 * THE BUG THIS FIXES: Send used to be a <button> that copied the prompt and
 * then called window.open(). The copy is asynchronous, so by the time the
 * open ran it was no longer inside the click that asked for it -- which is
 * exactly what a browser's pop-up blocker exists to stop. It blocked it,
 * silently, and the button did nothing at all.
 *
 * A real link with target="_blank" is an ordinary navigation, and no
 * blocker touches it. So the href is kept current as the form is typed in,
 * and the click just follows it. */
function syncSendLink(prompt){
  const link = document.getElementById('poster-send');
  if(!link) return;
  const text = prompt || '';
  const fits = encodeURIComponent(text).length <= CHATGPT_URL_LIMIT;
  link.href = (text && fits)
    ? 'https://chatgpt.com/?q=' + encodeURIComponent(text)
    : 'https://chatgpt.com/';
}

function posterReady(){
  const title = posterTitleEl && posterTitleEl.value.trim();
  if(!title){
    setPosterStatus('Give it a title first — that is what the poster is about.', true);
    if(posterTitleEl) posterTitleEl.focus();
    return false;
  }
  return true;
}

let posterStatusTimer = null;
function setPosterStatus(message, warn){
  if(!posterStatusEl) return;
  posterStatusEl.textContent = message;
  posterStatusEl.style.color = warn ? '#fca5a5' : '';
  clearTimeout(posterStatusTimer);
  if(message) posterStatusTimer = setTimeout(() => { posterStatusEl.textContent = ''; }, 6000);
}

// Same fallback chain as everywhere else: the async clipboard API is not
// there on an insecure origin and refuses outside a real tap on iOS.
async function copyToClipboard(text){
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(text);
      return true;
    }
  }catch(_){ /* fall through */ }
  try{
    const pad = document.createElement('textarea');
    pad.value = text;
    pad.setAttribute('readonly','');
    pad.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(pad);
    pad.select();
    pad.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    pad.remove();
    return ok;
  }catch(_){ return false; }
}

async function copyPosterPrompt(){
  if(!posterReady()) return;
  const ok = await copyToClipboard(buildPosterPrompt());
  setPosterStatus(ok
    ? 'Copied. Open ChatGPT, paste it, attach the files, send.'
    : 'Could not copy — open "See the prompt this makes" and copy it by hand.', !ok);
}

/* Send.
 *
 * chatgpt.com/?q=... drops the prompt straight into the composer, so all he
 * has to do is attach the files and hit the arrow. It is undocumented, it
 * has a URL length ceiling, and OpenAI can take it away on any given
 * Tuesday -- so the clipboard is loaded as well, every time. If the deep
 * link ever stops prefilling, he lands in ChatGPT with the prompt already
 * copied and a line telling him to paste, rather than a broken button.
 *
 * Nothing here calls window.open. The link's href is already correct (see
 * syncSendLink); this only decides whether to let the click through, and
 * loads the clipboard on the way past. The copy is deliberately NOT awaited
 * -- awaiting it is what broke this in the first place. */
function onSendClick(e){
  if(!posterReady()){ e.preventDefault(); return; }
  const prompt = buildPosterPrompt();
  const fits = encodeURIComponent(prompt).length <= CHATGPT_URL_LIMIT;
  copyToClipboard(prompt);
  setPosterStatus(fits
    ? 'Sent. Attach the files in ChatGPT, then hit the arrow.'
    : 'TOO LONG to send as a link — it is on your clipboard instead. Paste it into ChatGPT, attach the files, send.', !fits);
}

// ---- the prompt editor (yours) ----
function fillPromptEditor(){
  if(!marketingPrompt) return;
  document.getElementById('prompt-template').value = marketingPrompt.template || '';
  document.getElementById('prompt-options').value =
    JSON.stringify(marketingPrompt.options || [], null, 2);
  document.getElementById('prompt-shapes').value =
    JSON.stringify(marketingPrompt.shapes || [], null, 2);
  // One per line, not JSON. It is a list of sentences to show him, not
  // data -- and counting brackets to add "the store photo" is a silly tax.
  document.getElementById('prompt-attachments').value =
    (marketingPrompt.attachments || []).join('\n');
  const st = document.getElementById('prompt-editor-status');
  if(st) st.textContent = '';
}

async function savePromptEditor(){
  const st = document.getElementById('prompt-editor-status');
  let options, shapes;
  // Parsed before anything is sent, so bad JSON is a message rather than a
  // saved row that breaks the dropdown for him.
  try{
    options = JSON.parse(document.getElementById('prompt-options').value || '[]');
    shapes  = JSON.parse(document.getElementById('prompt-shapes').value || '[]');
  }catch(err){
    if(st){ st.textContent = 'That JSON is not valid: ' + err.message; st.style.color = '#fca5a5'; }
    return;
  }
  const named = (list) => Array.isArray(list) && list.every(o => o && o.id && o.label);
  if(!named(options) || !named(shapes)){
    if(st){ st.textContent = 'Every colour and shape needs an id and a label.'; st.style.color = '#fca5a5'; }
    return;
  }
  // Plain lines in, array out. Blank lines dropped so a stray return does
  // not put an empty bullet on his screen.
  const attachments = (document.getElementById('prompt-attachments').value || '')
    .split('\n').map(x => x.trim()).filter(Boolean);
  try{
    const { error } = await supabaseClient.from('marketing_prompts')
      .update({
        template: document.getElementById('prompt-template').value,
        options, shapes, attachments
      })
      .eq('slug', POSTER_SLUG);
    if(error) throw error;
    if(st){ st.textContent = 'Saved.'; st.style.color = ''; }
    await loadMarketing();
  }catch(err){
    if(st){ st.textContent = err.message || 'Could not save that'; st.style.color = '#fca5a5'; }
  }
}

[posterTitleEl, posterSourceEl, posterNotesEl].forEach(el => {
  if(el) el.addEventListener('input', renderPosterPreview);
});
if(posterLookEl) posterLookEl.addEventListener('change', renderPosterPreview);
if(posterShapeEl) posterShapeEl.addEventListener('change', renderPosterPreview);
const posterCopyBtn = document.getElementById('poster-copy');
if(posterCopyBtn) posterCopyBtn.addEventListener('click', copyPosterPrompt);
const posterSendBtn = document.getElementById('poster-send');
if(posterSendBtn) posterSendBtn.addEventListener('click', onSendClick);
const promptSaveBtn = document.getElementById('prompt-save');
if(promptSaveBtn) promptSaveBtn.addEventListener('click', savePromptEditor);
const promptReloadBtn = document.getElementById('prompt-reload');
if(promptReloadBtn) promptReloadBtn.addEventListener('click', fillPromptEditor);

/* ---- Tutorial videos (home page) -----------------------------------
 *
 * Up to five YouTube links, saved into store_info.data.videos — the same
 * single JSON row this file already publishes for the store name, hours
 * and announcement. No new table and no new policy: Jeff gets fields in a
 * panel he already knows, and components/home-rails.js reads them.
 *
 * FIVE NUMBERED SLOTS, NOT AN ADD/REMOVE LIST
 *
 * Same reasoning as the ten card slots: a list with "+ Add" and "✕" is a
 * thing that can be got wrong — added twice, half-deleted, reordered by
 * accident. Five fixed boxes cannot be. Slot 1 shows first on the home
 * page, an empty slot is simply skipped, and clearing a box is how a video
 * comes down.
 *
 * THE PICTURE IS THE POINT
 *
 * Paste a link and the video's own thumbnail appears in the slot. That is
 * the whole confidence check — Jeff sees the video he meant rather than
 * reading an id back to himself, and a wrong paste is obvious instantly
 * instead of after publishing.
 */
const MAX_TUTORIAL_VIDEOS = 5;
let currentVideos = [];

// Takes whatever he pastes: a watch link, a share link, an embed link, or
// the bare id. Anything else comes back empty and the slot says so.
function adminVideoId(raw){
  const v = String(raw || '').trim();
  if(!v) return '';
  if(/^[\w-]{11}$/.test(v)) return v;
  const m = v.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
  return m ? m[1] : '';
}

function renderVideoThumb(i){
  const cell = document.getElementById(`video-thumb-${i}`);
  const input = document.getElementById(`video-url-${i}`);
  if(!cell || !input) return;
  const raw = input.value.trim();
  const id = adminVideoId(raw);
  if(!raw){ cell.className = 'video-slot-thumb is-empty'; cell.innerHTML = '<span>Empty</span>'; return; }
  if(!id){ cell.className = 'video-slot-thumb is-bad'; cell.innerHTML = '<span>Not a YouTube link</span>'; return; }
  cell.className = 'video-slot-thumb is-ok';
  cell.innerHTML = `<img src="https://i.ytimg.com/vi/${escapeAdminHtml(id)}/mqdefault.jpg" alt="">`;
}

function renderVideoSlots(){
  const wrap = document.getElementById('videos-slots');
  if(!wrap) return;
  wrap.innerHTML = Array.from({ length: MAX_TUTORIAL_VIDEOS }, (_, i) => {
    const v = currentVideos[i] || {};
    return `
      <div class="video-slot">
        <div class="video-slot-row">
          <span class="video-slot-n">${i + 1}</span>
          <div class="video-slot-thumb is-empty" id="video-thumb-${i}"><span>Empty</span></div>
        </div>
        <label>YouTube link
          <input type="text" id="video-url-${i}" value="${escapeAdminHtml(v.url || '')}"
                 placeholder="Paste the link from YouTube">
        </label>
        <label>What it shows
          <input type="text" id="video-title-${i}" value="${escapeAdminHtml(v.title || '')}"
                 placeholder="e.g. Scanning your first card">
        </label>
      </div>`;
  }).join('');

  for(let i = 0; i < MAX_TUTORIAL_VIDEOS; i++){
    document.getElementById(`video-url-${i}`)?.addEventListener('input', () => renderVideoThumb(i));
    renderVideoThumb(i);
  }
}

document.getElementById('videos-save')?.addEventListener('click', async () => {
  const st = document.getElementById('videos-status');
  const kept = [];
  let bad = 0;

  for(let i = 0; i < MAX_TUTORIAL_VIDEOS; i++){
    const url = (document.getElementById(`video-url-${i}`)?.value || '').trim();
    const title = (document.getElementById(`video-title-${i}`)?.value || '').trim();
    if(!url) continue;
    if(!adminVideoId(url)){ bad++; continue; }
    kept.push({ url, title });
  }

  if(bad){
    // Saving anyway would quietly drop the ones he got wrong, and he would
    // find out by them never appearing. Stop and say which.
    if(st){ st.textContent = `Slot${bad > 1 ? 's' : ''} with something that is not a YouTube link — fix ${bad > 1 ? 'those' : 'that'} and save again.`; st.style.color = '#fca5a5'; }
    return;
  }

  if(st){ st.textContent = 'Publishing…'; st.style.color = ''; }
  // Re-fetch first: Events, Deals and Store Info all write this same row,
  // so only the videos key is ours to overwrite.
  const fresh = await getData();
  const error = await saveData({ ...fresh, videos: kept });
  currentVideos = kept;
  if(st){
    st.textContent = error
      ? ('Could not publish: ' + error.message)
      : (kept.length
          ? `Published — ${kept.length} video${kept.length === 1 ? '' : 's'} live on the home page now.`
          : 'Published — no videos, so that section is off the home page.');
    st.style.color = error ? '#fca5a5' : '';
  }
});
