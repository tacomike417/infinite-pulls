
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
  await loadBanner();
  await loadShopPulse();
  await loadCloverStatus();
  await populate();
  await loadGoalsAdmin();
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
    [banner, push, shopPulse, clover].forEach(card => {
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
