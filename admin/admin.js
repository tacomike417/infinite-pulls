
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
    [banner, push, shopPulse].forEach(card => {
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
  form.elements.eventsJson.value = JSON.stringify(data.events || [], null, 2);
  form.elements.dealsJson.value = JSON.stringify(data.deals || [], null, 2);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try{
    const data = {};
    ['storeName','announcement','shopUrl','address','mapUrl','phone','email','facebook','instagram','about']
      .forEach(key => data[key] = form.elements[key].value.trim());

    data.hours = {};
    Object.keys(DEFAULT_DATA.hours).forEach(day => data.hours[day] = form.elements[`hours_${day}`].value.trim());

    data.events = JSON.parse(form.elements.eventsJson.value || '[]');
    data.deals = JSON.parse(form.elements.dealsJson.value || '[]');

    statusEl.textContent = 'Publishing…';
    const error = await saveData(data);
    statusEl.textContent = error ? ('Could not publish: ' + error.message) : 'Published — live for every visitor now.';
  }catch(err){
    statusEl.textContent = 'Could not save: check the Events/Deals JSON.';
  }
});

document.getElementById('reset-data').addEventListener('click', async () => {
  statusEl.textContent = 'Resetting…';
  const error = await saveData({});
  await populate();
  statusEl.textContent = error ? ('Could not reset: ' + error.message) : 'Demo data reset.';
});
