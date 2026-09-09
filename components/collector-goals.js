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

  /* Which tiles are open. Kept out here because every button on a tile
     redraws the whole wall, and a tile that slammed shut every time you
     pressed something inside it would be unusable. */
  const openGoalIds = new Set();

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
  let showAll = false;      // untouched automatic badges stay folded away until asked for

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
    /* "Add A Goal" only ever offers the goals that need a choice made.
       An automatic badge has nothing to pick, so offering it as something
       to add would be offering somebody a button that changes nothing. */
    templates = allTemplates.filter(t => t.enabled && !t.auto_track && !selectedTemplateIds.has(t.id));
    const ctx = await cg().buildContext(user.id);
    allSpeciesCache = ctx.allSpecies;
    const picked = await cg().computeAllProgress(user.id, userGoals, ctx);
    const auto = await cg().computeAutoProgress(user.id, ctx, selectedTemplateIds);

    /* ORDER: earned first, then whatever is closest to done.
       A wall of zeroes reads as "you have failed at 25 things", so the
       badges nobody has started fold away behind a count instead of
       filling the screen. A goal the collector PICKED is never folded
       away, however far off it is -- they chose it, so it stays in
       front of them. */
    progressList = picked.concat(auto).sort((a, b) => {
      if(a.progress.complete !== b.progress.complete) return a.progress.complete ? -1 : 1;
      return (b.progress.pct || 0) - (a.progress.pct || 0);
    });
  }

  function isUntouched(row){
    return !!row.auto && !row.progress.complete && !(row.progress.pct > 0);
  }

  /* THE BADGE. Artwork when the goal has it, the emoji when it does not,
     so a goal added from the admin panel without art still looks like
     something rather than a hole.

     Never smaller than 84px: the art carries a title banner that turns to
     mush below about that size, which is why the goal NAME is always real
     text beside it and never left to the picture alone.

     Unearned badges are desaturated and dimmed rather than hidden -- the
     wall of what is still out there is the reason to come back, and the
     art was drawn to stay recognisable greyed out. */
  function badgeHtml(eff, earned){
    const cls = 'goal-badge' + (earned ? ' is-earned' : '');
    if(eff.badgeImage){
      return `<span class="${cls}"><img src="${escapeHtml(eff.badgeImage)}" alt="" loading="lazy" width="96" height="96"></span>`;
    }
    return `<span class="${cls} goal-badge-emoji">${escapeHtml(eff.icon || '🎯')}</span>`;
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

  /* ---- ONE BADGE ON THE WALL ------------------------------------------
   *
   * WHY THIS IS A GRID AND NOT A LIST. It was full-width rows, one under
   * the other, and the sort already put earned ones at the top -- but
   * "first" in a stack of rows does not read as first. A shelf of trophies
   * reads left to right, the ones you have won at the front, and you can
   * see the whole lot in one look instead of scrolling past three of them.
   *
   * WHAT IS ON THE TILE. The art, the name, and one line that says either
   * that you have it or how far off you are. Everything else -- which
   * cards are missing, making it your primary, removing it -- is behind a
   * tap, because none of that is browsing and all of it was crowding the
   * thing people actually came to look at.
   *
   * EARNED ONES ARE LOUD. Full colour, a gold edge and a ribbon. The rest
   * are greyed back on purpose: the art was drawn to stay recognisable
   * dimmed, and a wall of what is still out there is the reason to come
   * back. */
  function goalCardHtml({ userGoal, eff, progress }){
    const isManual = eff.goalType === 'custom_manual' && !userGoal.template_id;
    const done = !!progress.complete;
    const open = openGoalIds.has(userGoal.id);

    /* The one line under the name. Earned says so and stops; the rest
       show the count they are chasing, which is the number that brings
       somebody back. */
    const line = done
      ? 'Earned'
      : (progress.displayMode === 'fraction' ? escapeHtml(progress.primaryLabel) : escapeHtml(progress.primaryLabel));

    return `
      <div class="goal-tile${done ? ' is-earned' : ''}${open ? ' is-open' : ''}" data-goal-id="${userGoal.id}">
        <button type="button" class="goal-tile-face" data-goal-open="${userGoal.id}"
                aria-expanded="${open}" aria-label="${escapeHtml(eff.name)}">
          ${userGoal.is_primary ? '<span class="goal-star" aria-label="Your main goal">★</span>' : ''}
          ${badgeHtml(eff, done)}
          <strong class="goal-tile-name">${escapeHtml(eff.name)}</strong>
          <span class="goal-tile-line">${line}</span>
          ${!done && progress.displayMode === 'fraction'
            ? `<span class="pokedex-progress-bar"><span class="pokedex-progress-fill" style="width:${progress.pct}%"></span></span>`
            : ''}
          ${done ? '<span class="goal-ribbon">🏆</span>' : ''}
        </button>

        ${open ? `
        <div class="goal-tile-more">
          ${eff.description ? `<p class="goal-card-desc">${escapeHtml(eff.description)}</p>` : ''}
          ${progress.missingLabel && !done ? `<p><small style="color:var(--muted)">${escapeHtml(progress.missingLabel)}</small></p>` : ''}
          ${!done ? missingChipsHtml(progress) : ''}
          ${isManual ? `
            <div class="form-actions">
              <button type="button" class="ghost-btn goal-manual-btn" data-goal-id="${userGoal.id}" data-delta="-1">－</button>
              <button type="button" class="ghost-btn goal-manual-btn" data-goal-id="${userGoal.id}" data-delta="1">＋</button>
            </div>
          ` : ''}
          ${userGoal.auto ? '<p><small style="color:var(--muted)">This one earns itself — nothing to add.</small></p>' : `
          <div class="form-actions">
            ${userGoal.is_primary
              ? `<button type="button" class="ghost-btn goal-unprimary-btn" data-goal-id="${userGoal.id}">Not my main goal</button>`
              : `<button type="button" class="secondary-btn goal-primary-btn" data-goal-id="${userGoal.id}">★ Make this my main goal</button>`}
            <button type="button" class="ghost-btn goal-remove-btn" data-goal-id="${userGoal.id}">Take it off my list</button>
          </div>`}
        </div>` : ''}
      </div>
    `;
  }

  /* Browsing is the point of this section, so it reads as a wall of
     badges rather than a list of rows: the art first, the name in real
     text under it, and the button last. Nothing here is earned yet, so
     every badge on this section is drawn locked. */
  function templateCardHtml(t){
    return `
      <div class="goal-tile goal-tile-browse">
        <div class="goal-tile-face">
          ${badgeHtml({ badgeImage: t.badge_image, icon: t.icon }, false)}
          <strong class="goal-tile-name">${escapeHtml(t.name)}</strong>
          ${t.description ? `<span class="goal-tile-line">${escapeHtml(t.description)}</span>` : ''}
        </div>
        <div class="goal-tile-more is-always">
          <button type="button" class="primary-btn goal-add-btn" data-template-id="${t.id}">Add this one</button>
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
    const folded = showAll ? [] : progressList.filter(isUntouched);
    const shown  = showAll ? progressList : progressList.filter(r => !isUntouched(r));
    return `
      <section class="hero">
        <div class="eyebrow">Collector Goals</div>
        <h1>MY GOALS</h1>
        <p>Most of these earn themselves off your collection. The ones that need you to choose something — a set, a region — are down below.</p>
      </section>

      <section class="hero section">
        <div class="eyebrow">My Badges</div>
        ${(() => {
          /* HOW MANY YOU HAVE, IN WORDS, ABOVE THE WALL. The tiles say
             which; this says how many, which is the thing somebody
             actually wants to tell their mate. */
          const won = progressList.filter(r => r.progress.complete).length;
          const all = progressList.length;
          return all
            ? `<p class="goal-tally"><strong>${won}</strong> of ${all} earned${won ? ' — the ones you have are first' : ''}.</p>`
            : '';
        })()}
        <div id="goals-my-list" class="goal-wall">
          ${shown.length ? shown.map(goalCardHtml).join('') : '<p><small style="color:var(--muted)">Add a card to your collection and these start filling in on their own.</small></p>'}
        </div>
        ${folded.length ? `
          <div class="form-actions" style="margin-top:12px;">
            <button type="button" class="ghost-btn" id="goals-show-all">
              ${showAll ? 'Hide the ones I have not started' : `See all badges (${folded.length} more)`}
            </button>
          </div>` : ''}
      </section>

      <section class="hero section">
        <div class="eyebrow">Add A Goal</div>
        <div id="goals-template-list" class="goal-wall">
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
    document.querySelectorAll('[data-goal-open]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.goalOpen;
        if(openGoalIds.has(id)) openGoalIds.delete(id); else openGoalIds.add(id);
        render();
        /* Put the eye back where the finger was: the wall reflows when a
           tile opens, and a tile that jumps off screen when you tap it
           feels broken. */
        document.querySelector(`[data-goal-open="${id}"]`)?.scrollIntoView({ block: 'nearest' });
      });
    });
    document.getElementById('goals-show-all')?.addEventListener('click', () => {
      showAll = !showAll;
      render();
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
