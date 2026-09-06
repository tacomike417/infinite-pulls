// My Collector Goals — the visitor-facing screen for the flexible goal
// system in components/collector-goals-data.js (see that file's header
// for the full architecture). Reached from Menu → Collector Goals, and
// from the "Primary Goal" summary card My Pokédex shows near the bottom
// of its main screen (see components/pokedex.js's renderPrimaryGoal).
//
// Three things happen here:
//   1. "My Collector Goals" — every goal the visitor has already picked,
//      with live, automatic progress (no manual entry, except a fully
//      custom manual goal's own stepper — see below).
//   2. Picking a Primary Goal — one goal highlighted here (and on My
//      Pokédex) as "the" goal, easy to build on for a future public
//      profile per the spec's Future Social Connection note.
//   3. "Add A Collector Goal" — every shop-enabled template not already
//      selected, plus "Create My Own Goal" for a simple manual target.
(function(){
  'use strict';

  function cg(){ return window.InfinitePullsCollectorGoals; }
  function pd(){ return window.InfinitePullsPokemonData; }
  function client(){ return window.InfinitePullsSupabase && window.InfinitePullsSupabase.client; }
  function root(){ return document.getElementById('goals-page'); }

  function escapeHtml(value=''){
    return String(value).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[m]));
  }

  let currentUser = null;
  let templates = [];       // enabled templates not yet selected
  let progressList = [];    // [{userGoal, eff, progress}] for selected goals
  let allSpeciesCache = []; // from the shared ctx — used only to turn missingDexIds into names below

  function renderSignedOut(){
    const el = root();
    if(!el) return;
    el.innerHTML = `
      <section class="hero">
        <div class="eyebrow">Collector Goals</div>
        <h1>Sign In To Get Started</h1>
        <p>Pick goals — Original 151, complete a set, collect your favorite Pokémon — and Infinite Pulls tracks your progress automatically from My Collection.</p>
        <p><a class="primary-btn" href="?page=account" data-route="account">Sign In / Create Account</a></p>
      </section>
    `;
  }

  function renderNotConnected(){
    const el = root();
    if(!el) return;
    el.innerHTML = `<section class="hero"><div class="eyebrow">Collector Goals</div><h1>Not connected yet</h1><p>Connect Supabase in config.js to enable accounts and collections.</p></section>`;
  }

  async function loadData(user){
    const [allTemplates, userGoals] = await Promise.all([
      cg().loadGoalTemplates(),
      cg().loadUserGoals(user.id),
    ]);
    const selectedTemplateIds = new Set(userGoals.filter(g => g.template_id).map(g => g.template_id));
    templates = allTemplates.filter(t => t.enabled && !selectedTemplateIds.has(t.id));
    const ctx = await cg().buildContext(user.id);
    allSpeciesCache = ctx.allSpecies;
    progressList = await cg().computeAllProgress(user.id, userGoals, ctx);
  }

  function missingChipsHtml(progress){
    if(Array.isArray(progress.missingDexIds) && progress.missingDexIds.length){
      const names = progress.missingDexIds.slice(0, 12).map(id => {
        const species = allSpeciesCache.find(s => s.id === id);
        return species ? pd().displayName(species.name) : `#${id}`;
      });
      const extra = progress.missingDexIds.length - names.length;
      return `<p><small style="color:var(--muted)">Missing: ${names.map(escapeHtml).join(', ')}${extra > 0 ? ` +${extra} more` : ''}</small></p>`;
    }
    if(Array.isArray(progress.missingCards) && progress.missingCards.length){
      const names = progress.missingCards.slice(0, 12).map(c => typeof c === 'string' ? c : (c.name || c.id));
      const extra = progress.missingCards.length - names.length;
      return `<p><small style="color:var(--muted)">Missing: ${names.map(escapeHtml).join(', ')}${extra > 0 ? ` +${extra} more` : ''}</small></p>`;
    }
    return '';
  }

  function goalCardHtml({ userGoal, eff, progress }){
    const isManual = eff.goalType === 'custom_manual' && !userGoal.template_id;
    return `
      <div class="card goal-card ${progress.complete ? 'goal-card-complete' : ''}" data-goal-id="${userGoal.id}" style="text-align:left;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
          <div style="min-width:0;">
            <div class="eyebrow">${userGoal.is_primary ? '★ Primary Goal' : (eff.description ? escapeHtml(eff.description) : '')}</div>
            <strong style="font-size:1.1rem; display:block;">${escapeHtml(eff.icon || '🎯')} ${escapeHtml(eff.name).toUpperCase()}</strong>
          </div>
          <button type="button" class="ghost-btn goal-remove-btn" data-goal-id="${userGoal.id}" aria-label="Remove this goal" style="flex:0 0 auto;">✕</button>
        </div>
        <p style="margin:8px 0 2px;">${escapeHtml(progress.primaryLabel)}${progress.complete ? ' — Complete! 🏆' : ''}</p>
        ${progress.displayMode === 'fraction' ? `<span class="pokedex-progress-bar"><span class="pokedex-progress-fill" style="width:${progress.pct}%"></span></span>` : ''}
        ${progress.missingLabel && !progress.complete ? `<p><small style="color:var(--muted)">${escapeHtml(progress.missingLabel)}</small></p>` : ''}
        ${!progress.complete ? missingChipsHtml(progress) : ''}
        ${isManual ? `
          <div class="form-actions" style="margin-top:8px;">
            <button type="button" class="ghost-btn goal-manual-btn" data-goal-id="${userGoal.id}" data-delta="-1">－</button>
            <button type="button" class="ghost-btn goal-manual-btn" data-goal-id="${userGoal.id}" data-delta="1">＋</button>
          </div>
        ` : ''}
        <div class="form-actions" style="margin-top:10px;">
          ${userGoal.is_primary
            ? `<button type="button" class="ghost-btn goal-unprimary-btn" data-goal-id="${userGoal.id}">Remove As Primary</button>`
            : `<button type="button" class="secondary-btn goal-primary-btn" data-goal-id="${userGoal.id}">★ Make Primary Goal</button>`}
        </div>
      </div>
    `;
  }

  function templateCardHtml(t){
    return `
      <div class="card" style="text-align:left;">
        <strong style="font-size:1rem; display:block;">${escapeHtml(t.icon || '🎯')} ${escapeHtml(t.name)}</strong>
        ${t.description ? `<small style="display:block; color:var(--muted); margin-top:4px;">${escapeHtml(t.description)}</small>` : ''}
        <div class="form-actions" style="margin-top:10px;">
          <button type="button" class="primary-btn goal-add-btn" data-template-id="${t.id}">+ Add This Goal</button>
        </div>
      </div>
    `;
  }

  /* CREATE MY OWN GOAL — REMOVED 6 Sep 2026.
     It was a hand-cranked +/- counter with a name and an optional target,
     and it was the weakest thing on the screen: the shop got set, master
     set, rarity, artist, type and favourite-Pokémon goals that track
     themselves, while a visitor making their own got a tally they had to
     remember to press. Too fiddly to use and too vague to be worth the
     screen. His call: kill it.

     The custom_manual CALCULATOR is deliberately still in
     collector-goals-data.js, and the +/- stepper below still renders. Any
     goal somebody already made keeps working and can still be removed by
     its owner -- nobody's row disappears underneath them. Nothing new can
     be created. */

  function shellHtml(){
    return `
      <section class="hero">
        <div class="eyebrow">Collector Goals</div>
        <h1>MY GOALS</h1>
        <p>Pick what you're chasing — Infinite Pulls tracks your progress automatically from My Collection. No manual updates needed.</p>
      </section>

      <section class="hero section">
        <div class="eyebrow">My Goals</div>
        <div id="goals-my-list">
          ${progressList.length ? progressList.map(goalCardHtml).join('') : '<p><small style="color:var(--muted)">Add your first goal below.</small></p>'}
        </div>
      </section>

      <section class="hero section">
        <div class="eyebrow">Add A Goal</div>
        <div id="goals-template-list" class="card-grid" style="grid-template-columns:1fr;">
          ${templates.length ? templates.map(templateCardHtml).join('') : '<p><small style="color:var(--muted)">You\'ve added every goal the shop currently offers.</small></p>'}
        </div>
      </section>
    `;
  }

  function render(){
    const el = root();
    if(!el) return;
    el.innerHTML = shellHtml();
    wireEvents();
  }

  function wireEvents(){
    document.querySelectorAll('.goal-primary-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try{ await cg().setPrimaryGoal(currentUser.id, btn.dataset.goalId); }catch{}
        await loadData(currentUser);
        render();
      });
    });
    document.querySelectorAll('.goal-unprimary-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try{ await cg().clearPrimaryGoal(currentUser.id); }catch{}
        await loadData(currentUser);
        render();
      });
    });
    document.querySelectorAll('.goal-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try{ await cg().deleteUserGoal(currentUser.id, btn.dataset.goalId); }catch{}
        await loadData(currentUser);
        render();
      });
    });
    document.querySelectorAll('.goal-add-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Adding…';
        try{ await cg().selectGoal(currentUser.id, btn.dataset.templateId); }catch{}
        await loadData(currentUser);
        render();
      });
    });
    document.querySelectorAll('.goal-manual-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = progressList.find(p => p.userGoal.id === btn.dataset.goalId);
        if(!row) return;
        const current = Number(row.userGoal.custom_config?.current) || 0;
        const next = Math.max(0, current + Number(btn.dataset.delta));
        btn.disabled = true;
        try{
          await cg().updateCustomManualCurrent(currentUser.id, row.userGoal, next);
          const wasComplete = !!row.userGoal.completed_at;
          const target = row.userGoal.custom_config?.target;
          const nowComplete = target ? next >= Number(target) : false;
          if(nowComplete && !wasComplete){
            await client().from('user_collector_goals').update({ completed_at: new Date().toISOString() }).eq('id', row.userGoal.id);
          } else if(!nowComplete && wasComplete){
            await client().from('user_collector_goals').update({ completed_at: null }).eq('id', row.userGoal.id);
          }
          cg().invalidateUserGoalsCache();
        }catch{}
        await loadData(currentUser);
        render();
      });
    });
  }

  async function renderSignedIn(user){
    currentUser = user;
    const el = root();
    if(el) el.innerHTML = `<section class="hero"><div class="eyebrow">Collector Goals</div><h1>Loading…</h1></section>`;
    try{
      await loadData(user);
    }catch{
      if(el) el.innerHTML = `<section class="hero"><div class="eyebrow">Collector Goals</div><h1>Could not load Collector Goals</h1><p>Try again in a moment.</p></section>`;
      return;
    }
    render();
  }

  async function init(){
    if(!window.InfinitePullsSupabase || !window.InfinitePullsSupabase.ready){ renderNotConnected(); return; }
    if(!cg() || !pd()){ renderNotConnected(); return; }
    const { data: { session } } = await client().auth.getSession();
    if(!session){ renderSignedOut(); return; }
    await renderSignedIn(session.user);
  }

  window.InfinitePullsCollectorGoalsPage = { init };
})();
