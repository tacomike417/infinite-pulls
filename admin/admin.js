
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

function getData(){
  try{
    return {...DEFAULT_DATA, ...(JSON.parse(localStorage.getItem('infinitePullsData')) || {})};
  }catch{
    return {...DEFAULT_DATA};
  }
}

function buildHours(data){
  hoursFields.innerHTML = Object.keys(DEFAULT_DATA.hours).map(day =>
    `<label>${day}<input name="hours_${day}" value="${String(data.hours?.[day] ?? '').replaceAll('"','&quot;')}"></label>`
  ).join('');
}

function populate(){
  const data = getData();
  ['storeName','announcement','shopUrl','address','mapUrl','phone','email','facebook','instagram','about']
    .forEach(key => { if(form.elements[key]) form.elements[key].value = data[key] ?? ''; });
  buildHours(data);
  form.elements.eventsJson.value = JSON.stringify(data.events || [], null, 2);
  form.elements.dealsJson.value = JSON.stringify(data.deals || [], null, 2);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  try{
    const data = {};
    ['storeName','announcement','shopUrl','address','mapUrl','phone','email','facebook','instagram','about']
      .forEach(key => data[key] = form.elements[key].value.trim());

    data.hours = {};
    Object.keys(DEFAULT_DATA.hours).forEach(day => data.hours[day] = form.elements[`hours_${day}`].value.trim());

    data.events = JSON.parse(form.elements.eventsJson.value || '[]');
    data.deals = JSON.parse(form.elements.dealsJson.value || '[]');

    localStorage.setItem('infinitePullsData', JSON.stringify(data));
    statusEl.textContent = 'Saved. Refresh the app to see changes.';
  }catch(err){
    statusEl.textContent = 'Could not save: check the Events/Deals JSON.';
  }
});

document.getElementById('reset-data').addEventListener('click', () => {
  localStorage.removeItem('infinitePullsData');
  populate();
  statusEl.textContent = 'Demo data reset.';
});

populate();
