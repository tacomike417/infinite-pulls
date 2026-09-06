// Collector Goals — the shared data/engine layer behind the flexible
// goal system that replaced the old hardcoded "Original 151" card on My
// Pokédex. Nothing in this file renders anything; components/
// collector-goals.js (the visitor-facing "My Collector Goals" screen) and
// admin/admin.js (the Collector Goals admin section) both build on top of
// it, same relationship components/pokedex.js has with pokemon-data.js.
//
// Core idea (see supabase/schema.sql section 11 for the tables):
//   - collector_goal_templates: shop-curated goals a visitor can pick
//     from — admin-managed, one row per goal, tagged with a goal_type
//     ('pokedex_range', 'type', 'set_completion', etc.) plus a small
//     `config` jsonb carrying that type's settings (which dex range,
//     which set, which Pokémon...).
//   - user_collector_goals: which goals a specific visitor has actually
//     selected, which one (if any) is their Primary Goal, and
//     completed_at (set once progress crosses 100%, cleared again if it
//     drops back below — see checkAndUpdateGoalCompletions).
//
// Adding a new goal TYPE later (per the spec's "don't rebuild this every
// time we think of a new idea") means: add one entry to GOAL_CALCULATORS
// below, one value to the goal_type check constraint in schema.sql, and a
// config-editing block in the admin form — nothing else in the app needs
// to change, since every goal (built-in or custom) flows through the same
// effectiveGoal() → computeGoalProgress() pipeline.
//
// Pokémon goals vs card goals (the distinction the spec is explicit
// about): pokedex_range/full_pokedex/generation/type all count UNIQUE
// POKÉMON represented (reusing pokemon-data.js's discoveredMap — the
// exact same data My Pokédex itself is built from). set_completion/
// master_set/rarity/artist/chase_list all count actual QUALIFYING CARDS
// from My Collection. pokemon (a favorite-Pokémon goal like "Pikachu
// Collector") is a hybrid — it's about card ownership, but scoped to one
// species — see its calculator below.
(function(){
  'use strict';

  function pd(){ return window.InfinitePullsPokemonData; }
  function client(){ return window.InfinitePullsSupabase && window.InfinitePullsSupabase.client; }

  // Small, deliberately separate TCGdex fetcher — components/collection.js
  // already has its own (private) fetchTcgdex/fetchSetDetail, but pulling
  // that out into a shared file would mean touching 1300+ lines of
  // already-working card search/detail code for a handful of lines here.
  // Same base URL, same "cache the resolved set forever" idea, just local
  // to this file.
  const TCGDEX_BASE = 'https://api.tcgdex.net/v2/en';
  const FETCH_TIMEOUT_MS = 8000;

  const setDetailCache = {};
  async function fetchSetDetail(setId){
    if(!setId) return null;
    if(setDetailCache[setId]) return setDetailCache[setId];
    const promise = (async () => {
      const res = await fetch(`${TCGDEX_BASE}/sets/${encodeURIComponent(setId)}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if(!res.ok) throw new Error(`TCGdex returned ${res.status}`);
      return res.json();
    })();
    setDetailCache[setId] = promise;
    promise.catch(() => { if(setDetailCache[setId] === promise) delete setDetailCache[setId]; });
    return promise;
  }

  let allSetsPromise = null;
  function loadAllSets(){
    if(allSetsPromise) return allSetsPromise;
    allSetsPromise = (async () => {
      const res = await fetch(`${TCGDEX_BASE}/sets`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if(!res.ok) throw new Error(`TCGdex returned ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      list.sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')));
      return list;
    })();
    allSetsPromise.catch(() => { allSetsPromise = null; });
    return allSetsPromise;
  }

  // ---- Goal type registry (used by both the admin config form and the
  // user-facing "Create My Own Goal" flow) ----
  const GOAL_TYPE_META = {
    pokedex_range:  { label: 'Pokédex Range',        group: 'pokemon' },
    full_pokedex:   { label: 'Complete My Pokédex',  group: 'pokemon' },
    generation:     { label: 'Generation',           group: 'pokemon' },
    type:           { label: 'Pokémon Type',         group: 'pokemon' },
    pokemon:        { label: 'Favorite Pokémon',     group: 'pokemon' },
    set_completion: { label: 'Complete a Set',       group: 'card' },
    master_set:     { label: 'Master a Set',         group: 'card' },
    rarity:         { label: 'Card Rarity',          group: 'card' },
    artist:         { label: 'Card Artist',          group: 'card' },
    chase_list:     { label: 'Chase List',           group: 'card' },
    // Added 6 Sep 2026 for the badge goals. All five read data the app
    // already had -- added_at was on user_cards all along, graded cards
    // have written their grade into `condition` since the Card Lookup
    // grade rail shipped, and the collection total lives on the profile.
    // No new tables, no new fetches per card.
    graded_count:   { label: 'Graded Cards',          group: 'card' },
    grade_ladder:   { label: 'Grade Ladder',          group: 'card' },
    added_in_month: { label: 'Cards In A Month',      group: 'card' },
    monthly_streak: { label: 'Monthly Streak',        group: 'card' },
    value_total:    { label: 'Collection Value',      group: 'value' },
    custom_manual:  { label: 'Manual / Custom',      group: 'manual' },
  };

  // ---- Template CRUD (admin) ----
  /* COLUMNS THAT ARRIVED LATER.
     badge_image and auto_track came with the badge work on 6 Sep 2026,
     and they only exist once supabase/goal_badges.sql and
     supabase/goal_auto_track.sql have been run. Asking for a column the
     database does not have fails the whole SELECT, which took the entire
     Collector Goals page down to "Could not load" -- every goal gone
     because of one missing flag.

     So it asks for everything, and drops back to the older column list if
     the database has not caught up yet. Same defence pokemon-data.js
     already had to grow for dex_id/card_lang, for exactly this reason.
     A goal without artwork shows its emoji; a goal without auto_track is
     one you pick. Both are the behaviour from before those files ran. */
  const TEMPLATE_COLUMNS_FULL = 'id, name, description, icon, badge_image, badge_text, goal_type, config, enabled, auto_track, display_order';
  const TEMPLATE_COLUMNS_BASE = 'id, name, description, icon, badge_text, goal_type, config, enabled, display_order';

  function isMissingColumn(error, names){
    const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
    if(!names.some(n => text.includes(n))) return false;
    return text.includes('does not exist') || text.includes('could not find') || text.includes('schema cache');
  }

  let templatesPromise = null;
  function loadGoalTemplates(opts){
    opts = opts || {};
    if(!opts.forceRefresh && templatesPromise) return templatesPromise;
    templatesPromise = (async () => {
      const read = (columns) => client()
        .from('collector_goal_templates')
        .select(columns)
        .order('display_order', { ascending: true });
      let { data, error } = await read(TEMPLATE_COLUMNS_FULL);
      if(error && isMissingColumn(error, ['badge_image', 'auto_track'])){
        ({ data, error } = await read(TEMPLATE_COLUMNS_BASE));
      }
      if(error) throw error;
      return (data || []).map(t => ({ badge_image: null, auto_track: false, ...t }));
    })();
    templatesPromise.catch(() => { templatesPromise = null; });
    return templatesPromise;
  }

  function invalidateTemplatesCache(){ templatesPromise = null; }

  async function createTemplate(fields){
    const { data, error } = await client().from('collector_goal_templates').insert(fields).select().single();
    invalidateTemplatesCache();
    if(error) throw error;
    return data;
  }

  async function updateTemplate(id, fields){
    const { data, error } = await client().from('collector_goal_templates').update(fields).eq('id', id).select().single();
    invalidateTemplatesCache();
    if(error) throw error;
    return data;
  }

  async function deleteTemplate(id){
    const { error } = await client().from('collector_goal_templates').delete().eq('id', id);
    invalidateTemplatesCache();
    if(error) throw error;
  }

  // Reassigns display_order 1..N to match the given id order — the admin
  // UI just needs to move an item up/down in a local array and call this.
  async function reorderTemplates(orderedIds){
    await Promise.all(orderedIds.map((id, i) =>
      client().from('collector_goal_templates').update({ display_order: i + 1 }).eq('id', id)
    ));
    invalidateTemplatesCache();
  }

  // ---- User goal selection CRUD ----
  let userGoalsPromise = null;
  let userGoalsUserId = null;
  function loadUserGoals(userId, opts){
    opts = opts || {};
    if(!opts.forceRefresh && userGoalsPromise && userGoalsUserId === userId) return userGoalsPromise;
    userGoalsUserId = userId;
    userGoalsPromise = (async () => {
      const read = (nested) => client()
        .from('user_collector_goals')
        .select(`id, user_id, template_id, custom_config, is_primary, completed_at, created_at, template:collector_goal_templates(${nested})`)
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      let { data, error } = await read('id, name, description, icon, badge_image, badge_text, goal_type, config, enabled, auto_track');
      if(error && isMissingColumn(error, ['badge_image', 'auto_track'])){
        ({ data, error } = await read('id, name, description, icon, badge_text, goal_type, config, enabled'));
      }
      if(error) throw error;
      return data || [];
    })();
    userGoalsPromise.catch(() => { userGoalsPromise = null; });
    return userGoalsPromise;
  }

  function invalidateUserGoalsCache(){
    userGoalsPromise = null;
    userGoalsUserId = null;
  }

  async function selectGoal(userId, templateId){
    const existing = await loadUserGoals(userId);
    const already = existing.find(g => g.template_id === templateId);
    if(already) return already;
    const { data, error } = await client().from('user_collector_goals')
      .insert({ user_id: userId, template_id: templateId })
      .select('id, user_id, template_id, custom_config, is_primary, completed_at, created_at, template:collector_goal_templates(id, name, description, icon, badge_image, badge_text, goal_type, config, enabled, auto_track)')
      .single();
    invalidateUserGoalsCache();
    if(error) throw error;
    return data;
  }

  // v1 "Create My Own Goal" — deliberately just a manual target/current
  // per the spec ("a simple manual/custom target is fine initially"). The
  // architecture doesn't lock us into this — a fancier custom-goal
  // builder (pick any goal_type + config, same as the admin form) can
  // reuse the exact same custom_config/effectiveGoal plumbing later
  // without a schema change.
  async function createCustomGoal(userId, { name, description, icon, target }){
    const custom_config = {
      name: (name || 'My Goal').trim(),
      description: (description || '').trim() || null,
      icon: icon || '🎯',
      goal_type: 'custom_manual',
      target: target ? Math.max(1, Math.floor(Number(target))) : null,
      current: 0,
    };
    const { data, error } = await client().from('user_collector_goals')
      .insert({ user_id: userId, template_id: null, custom_config })
      .select('id, user_id, template_id, custom_config, is_primary, completed_at, created_at, template:collector_goal_templates(id, name, description, icon, badge_image, badge_text, goal_type, config, enabled, auto_track)')
      .single();
    invalidateUserGoalsCache();
    if(error) throw error;
    return data;
  }

  async function updateCustomManualCurrent(userId, userGoalRow, newCurrent){
    const nextConfig = { ...(userGoalRow.custom_config || {}), current: Math.max(0, Math.floor(Number(newCurrent) || 0)) };
    const { error } = await client().from('user_collector_goals').update({ custom_config: nextConfig }).eq('id', userGoalRow.id);
    invalidateUserGoalsCache();
    if(error) throw error;
  }

  async function setPrimaryGoal(userId, userGoalId){
    // Two updates rather than one, since Postgres would otherwise briefly
    // have two is_primary=true rows mid-statement and trip the partial
    // unique index — clear the old one first, then set the new one.
    await client().from('user_collector_goals').update({ is_primary: false }).eq('user_id', userId).eq('is_primary', true);
    const { error } = await client().from('user_collector_goals').update({ is_primary: true }).eq('id', userGoalId);
    invalidateUserGoalsCache();
    if(error) throw error;
  }

  async function clearPrimaryGoal(userId){
    await client().from('user_collector_goals').update({ is_primary: false }).eq('user_id', userId).eq('is_primary', true);
    invalidateUserGoalsCache();
  }

  async function deleteUserGoal(userId, userGoalId){
    const { error } = await client().from('user_collector_goals').delete().eq('id', userGoalId).eq('user_id', userId);
    invalidateUserGoalsCache();
    if(error) throw error;
  }

  // Resolves a user_collector_goals row (template-based OR custom) into
  // one flat shape everything downstream can treat identically.
  function effectiveGoal(userGoalRow){
    if(userGoalRow.template_id && userGoalRow.template){
      const t = userGoalRow.template;
      return { name: t.name, description: t.description, icon: t.icon || '🎯', badgeImage: t.badge_image || null, badgeText: t.badge_text || `🏆 ${t.name}`, goalType: t.goal_type, config: t.config || {}, templateId: t.id, enabled: t.enabled !== false };
    }
    const c = userGoalRow.custom_config || {};
    return { name: c.name || 'My Goal', description: c.description || null, icon: c.icon || '🎯', badgeImage: null, badgeText: c.badge_text || `🏆 ${c.name || 'Goal'}`, goalType: 'custom_manual', config: c, templateId: null, enabled: true };
  }

  // ---- Progress calculators ----
  // Each takes (config, ctx) and returns a progress object. `ctx` is built
  // once per computeAllProgress() call and shared across every goal, so a
  // visitor with 5 selected goals still only loads the species roster and
  // My Collection rows once (see buildContext below).
  //
  // Shape returned by every calculator:
  //   { current, total (or null for count-style goals), displayMode:
  //     'fraction'|'count', primaryLabel (the big number line), pct,
  //     complete, missingCount, missingLabel }

  function fractionResult(current, total, unitLabel){
    const safeTotal = total || 0;
    const pct = safeTotal > 0 ? Math.round((current / safeTotal) * 100) : 0;
    const missingCount = Math.max(0, safeTotal - current);
    return {
      current, total: safeTotal, displayMode: 'fraction',
      primaryLabel: `${current} / ${safeTotal}`,
      pct, complete: safeTotal > 0 && current >= safeTotal,
      missingCount,
      missingLabel: missingCount > 0 ? `${missingCount} ${unitLabel || 'missing'}` : null,
    };
  }

  function countResult(current, unitLabel){
    return {
      current, total: null, displayMode: 'count',
      primaryLabel: `${current} ${unitLabel}`,
      pct: null, complete: false, missingCount: null, missingLabel: null,
    };
  }

  function speciesInRange(allSpecies, min, max){
    return allSpecies.filter(s => s.id >= min && s.id <= max);
  }

  /* READING A GRADE OFF A COLLECTION ROW.
     A graded card writes its slab into `condition` as "<COMPANY> <GRADE>"
     -- "PSA 10", "CGC 9.5", "BGS 10 Pristine", "TAG 10 Gem Mint" -- see
     collection.js line ~133 where the selection is turned into a row.
     Raw cards hold "Near Mint" and friends, which parse to no company and
     are ignored by every grading goal. */
  const GRADE_COMPANY_SET = ['PSA', 'TAG', 'BGS', 'CGC', 'SGC', 'ACE'];
  function readGrade(condition){
    const text = String(condition || '').trim();
    const space = text.indexOf(' ');
    if(space < 1) return null;
    const company = text.slice(0, space).toUpperCase();
    if(!GRADE_COMPANY_SET.includes(company)) return null;
    const rest = text.slice(space + 1).trim();       // "10", "9.5", "10 Pristine"
    const num = parseFloat(rest);
    if(!isFinite(num)) return null;
    return { company, value: rest, number: num };
  }

  /* Calendar-month key in the collector's own timezone. Their month, not
     UTC's -- a card added at 8pm on the 31st is not next month's card. */
  function monthKey(iso){
    const d = new Date(iso);
    if(isNaN(d)) return null;
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function monthKeyBack(n){
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  const GOAL_CALCULATORS = {
    /* Ten different cards slabbed at 10 by anybody, or by one named
       company when config.company is set. Distinct CARDS, not copies --
       ten of the same PSA 10 Pikachu is one card ten times. */
    async graded_count(config, ctx){
      const want = Number(config.grade != null ? config.grade : 10);
      const company = config.company ? String(config.company).toUpperCase() : null;
      const target = Math.max(1, Number(config.target) || 10);
      const seen = new Set();
      ctx.ownedRows.forEach(r => {
        const g = readGrade(r.condition);
        if(!g) return;
        if(company && g.company !== company) return;
        if(g.number !== want) return;
        seen.add(r.card_id);
      });
      return fractionResult(Math.min(seen.size, target), target, 'to go');
    },

    /* The same card, in every whole grade 1 through 10, from one company.
       Half grades do not count towards a rung; they are a different ladder. */
    async grade_ladder(config, ctx){
      const company = config.company ? String(config.company).toUpperCase() : null;
      const byCard = new Map();
      ctx.ownedRows.forEach(r => {
        const g = readGrade(r.condition);
        if(!g) return;
        if(company && g.company !== company) return;
        if(!Number.isInteger(g.number) || g.number < 1 || g.number > 10) return;
        const key = r.card_id + '|' + g.company;
        if(!byCard.has(key)) byCard.set(key, new Set());
        byCard.get(key).add(g.number);
      });
      let best = 0;
      byCard.forEach(rungs => { if(rungs.size > best) best = rungs.size; });
      return fractionResult(best, 10, 'grades missing');
    },

    /* Distinct cards added this calendar month. Resets on the 1st, which
       is the point -- it is the goal somebody can start again next month. */
    async added_in_month(config, ctx){
      const target = Math.max(1, Number(config.target) || 25);
      const thisMonth = monthKeyBack(0);
      const seen = new Set();
      ctx.ownedRows.forEach(r => {
        if(r.added_at && monthKey(r.added_at) === thisMonth) seen.add(r.card_id);
      });
      return fractionResult(Math.min(seen.size, target), target, 'to go this month');
    },

    /* A run of calendar months, each with at least one card added, ending
       with this month or last month -- last month still counts so the
       streak does not read as broken on the 1st before anybody has been
       to the shop. */
    async monthly_streak(config, ctx){
      const target = Math.max(2, Number(config.months) || 12);
      const months = new Set();
      ctx.ownedRows.forEach(r => { const k = r.added_at && monthKey(r.added_at); if(k) months.add(k); });
      let run = 0;
      const start = months.has(monthKeyBack(0)) ? 0 : 1;
      for(let i = start; i < start + target + 24; i++){
        if(months.has(monthKeyBack(i))) run++;
        else break;
      }
      return fractionResult(Math.min(run, target), target, 'months to go');
    },

    /* Collection value against a target. Reads the same figure the home
       page scoreboard shows, so the two can never disagree. */
    async value_total(config, ctx){
      const target = Math.max(1, Number(config.target) || 1000);
      const value = Number(ctx.collectionValue) || 0;
      const r = fractionResult(Math.min(value, target), target, 'to go');
      r.primaryLabel = '$' + Math.round(value).toLocaleString() + ' of $' + target.toLocaleString();
      return r;
    },


    async pokedex_range(config, ctx){
      const min = Math.max(1, Number(config.startDex) || 1);
      const max = Math.max(min, Number(config.endDex) || min);
      const inRange = speciesInRange(ctx.allSpecies, min, max);
      const current = inRange.filter(s => ctx.discoveredMap[s.id]?.discovered).length;
      const r = fractionResult(current, inRange.length, 'Pokémon missing');
      r.missingDexIds = inRange.filter(s => !ctx.discoveredMap[s.id]?.discovered).map(s => s.id);
      return r;
    },

    async full_pokedex(config, ctx){
      const current = ctx.allSpecies.filter(s => ctx.discoveredMap[s.id]?.discovered).length;
      const r = countResult(current, current === 1 ? 'Pokémon Discovered' : 'Pokémon Discovered');
      r.total = ctx.allSpecies.length;
      r.pct = r.total > 0 ? Math.round((current / r.total) * 100) : 0;
      r.complete = r.total > 0 && current >= r.total;
      return r;
    },

    async generation(config, ctx){
      const gen = (pd().GENERATION_RANGES || []).find(g => g.key === config.generationKey);
      if(!gen) return fractionResult(0, 0, 'Pokémon missing');
      const inRange = speciesInRange(ctx.allSpecies, gen.min, gen.max);
      const current = inRange.filter(s => ctx.discoveredMap[s.id]?.discovered).length;
      const r = fractionResult(current, inRange.length, 'Pokémon missing');
      r.missingDexIds = inRange.filter(s => !ctx.discoveredMap[s.id]?.discovered).map(s => s.id);
      return r;
    },

    async type(config, ctx){
      const typeMeta = (pd().TYPE_LIST || []).find(t => t.key === config.typeKey);
      const label = typeMeta ? `${typeMeta.emoji} ${typeMeta.label}` : (config.typeKey || 'Type');
      let ids;
      try{ ids = await pd().loadTypeMembership(config.typeKey); }catch{ ids = new Set(); }
      const inType = ctx.allSpecies.filter(s => ids.has(s.id));
      const current = inType.filter(s => ctx.discoveredMap[s.id]?.discovered).length;
      const r = countResult(current, `${label} Pokémon discovered`);
      r.total = inType.length;
      r.missingDexIds = inType.filter(s => !ctx.discoveredMap[s.id]?.discovered).map(s => s.id);
      return r;
    },

    async pokemon(config, ctx){
      const dexId = Number(config.dexId);
      const species = ctx.allSpecies.find(s => s.id === dexId);
      const name = species ? pd().displayName(species.name) : 'This Pokémon';
      const matches = ctx.ownedRows.filter(r => species && pd().speciesMatchesCardName(species.name, r.card_name));
      const current = config.countMode === 'unique'
        ? new Set(matches.map(r => r.card_id)).size
        : matches.reduce((sum, r) => sum + (Number(r.quantity) || 1), 0);
      return countResult(current, `${name} ${config.countMode === 'unique' ? 'unique cards' : 'cards'} owned`);
    },

    async set_completion(config, ctx){
      const setId = config.setId;
      const owned = ctx.ownedRows.filter(r => r.set_id === setId);
      const current = new Set(owned.map(r => r.card_id)).size;
      let total = null;
      try{
        const detail = await fetchSetDetail(setId);
        total = detail?.cardCount?.official ?? (Array.isArray(detail?.cards) ? detail.cards.length : null);
      }catch{ total = null; }
      return fractionResult(current, total || 0, 'cards missing');
    },

    async master_set(config, ctx){
      const setId = config.setId;
      const owned = ctx.ownedRows.filter(r => r.set_id === setId);
      // A "master set" also wants every variant, not just every card —
      // counted here as distinct (card_id + variant) pairs. This is a
      // deliberate simplification (see schema.sql's comment on this goal
      // type) — a true master-set definition (which variants actually
      // exist per card) needs richer TCGdex variant data than the app
      // currently pulls in, so config.masterTotal lets the admin override
      // the target by hand until that's built out.
      const current = new Set(owned.map(r => `${r.card_id}|${r.variant || 'normal'}`)).size;
      let total = config.masterTotal ? Number(config.masterTotal) : null;
      if(!total){
        try{
          const detail = await fetchSetDetail(setId);
          total = detail?.cardCount?.official ?? (Array.isArray(detail?.cards) ? detail.cards.length : null);
        }catch{ total = null; }
      }
      return fractionResult(current, total || 0, 'cards missing');
    },

    async rarity(config, ctx){
      const rarity = String(config.rarity || '').trim().toLowerCase();
      const matches = ctx.ownedRows.filter(r => String(r.rarity || '').trim().toLowerCase() === rarity);
      const current = matches.reduce((sum, r) => sum + (Number(r.quantity) || 1), 0);
      return countResult(current, `${config.rarity || 'matching'} card${current === 1 ? '' : 's'}`);
    },

    async artist(config, ctx){
      const illustrator = String(config.illustrator || '').trim().toLowerCase();
      const matches = ctx.ownedRows.filter(r => String(r.illustrator || '').trim().toLowerCase() === illustrator);
      const current = matches.reduce((sum, r) => sum + (Number(r.quantity) || 1), 0);
      return countResult(current, `card${current === 1 ? '' : 's'}`);
    },

    async chase_list(config, ctx){
      const items = Array.isArray(config.cardIds) ? config.cardIds : [];
      const ownedIds = new Set(ctx.ownedRows.map(r => r.card_id));
      const current = items.filter(item => ownedIds.has(typeof item === 'string' ? item : item.id)).length;
      const r = fractionResult(current, items.length, 'cards missing');
      r.missingCards = items.filter(item => !ownedIds.has(typeof item === 'string' ? item : item.id));
      return r;
    },

    async custom_manual(config, ctx){
      const current = Math.max(0, Number(config.current) || 0);
      if(config.target){
        return fractionResult(current, Number(config.target), 'to go');
      }
      return countResult(current, current === 1 ? 'item' : 'items');
    },
  };

  async function computeGoalProgress(eff, ctx){
    const calc = GOAL_CALCULATORS[eff.goalType];
    if(!calc) return countResult(0, 'unsupported goal type');
    try{
      return await calc(eff.config || {}, ctx);
    }catch{
      return countResult(0, 'could not calculate right now');
    }
  }

  // ---- Shared context (one load per screen, reused across every goal a
  // visitor has selected) ----
  /* The collection's total value, for value_total. Newest of what the
     profile holds and what My Collection last cached locally -- the same
     rule the home page scoreboard uses, so a goal and the scoreboard can
     never show two different numbers. Failure is 0, never an error: a
     value goal that cannot read a total simply sits at zero rather than
     taking the whole goals page down with it. */
  async function readCollectionValue(userId){
    let profileValue = 0;
    try{
      const { data } = await client().from('profiles')
        .select('collection_value').eq('id', userId).single();
      profileValue = Number(data?.collection_value) || 0;
    }catch{}
    /* collection.js caches under this key as {userId, total, at} -- read
       it the same shape it is written, and only when it belongs to this
       account, so a shared phone never shows somebody else's total. */
    let localValue = 0;
    try{
      const v = JSON.parse(window.localStorage.getItem('infinite-pulls-collection-value') || 'null');
      if(v && v.userId === userId && typeof v.total === 'number') localValue = v.total;
    }catch{}
    return Math.max(profileValue, localValue);
  }

  async function buildContext(userId){
    const [allSpecies, ownedRows, collectionValue] = await Promise.all([
      pd().loadAllSpecies(),
      pd().fetchOwnedCollectionRows(userId),
      readCollectionValue(userId),
    ]);
    const discoveredMap = pd().computeDiscoveredMap(allSpecies, ownedRows);
    return { allSpecies, ownedRows, discoveredMap, collectionValue, userId };
  }

  /* AUTOMATIC BADGES.
     Some goals have nothing to choose. Gem Mint Ten, Grade Ladder,
     Monthly Momentum, Yearlong Collector, Value Milestone -- there is no
     set to pick, no region, no Pokemon. Every collector is already
     working on all of them whether they have heard of them or not, so
     asking somebody to press "+ Add This Goal" first is asking them to
     opt in to a fact that is already true. Nobody opts in to an
     achievement.

     Goals that DO carry a setting (which set, which region) stay picked,
     because the app cannot guess the answer.

     These are computed live and NOTHING IS WRITTEN. No row per user per
     badge, no completion timestamp, no un-earning when a collection
     value dips back under a threshold on a bad market week. The card
     says what is true right now. Persisting the moment somebody earns
     one is a later decision, and it needs a column to mark a row as
     "earned, and it stays earned" before it would be safe.

     The shape returned matches computeAllProgress exactly, so every
     renderer downstream cannot tell the two apart. */
  async function computeAutoProgress(userId, ctx, skipTemplateIds){
    let templates;
    try{ templates = await loadGoalTemplates(); }catch{ return []; }
    const skip = skipTemplateIds instanceof Set ? skipTemplateIds : new Set(skipTemplateIds || []);
    const auto = (templates || []).filter(t => t.enabled !== false && t.auto_track && !skip.has(t.id));
    const context = ctx || await buildContext(userId);
    return Promise.all(auto.map(async (t) => {
      const row = { id: 'auto-' + t.id, user_id: userId, template_id: t.id, template: t,
                    custom_config: null, is_primary: false, completed_at: null, auto: true };
      const eff = effectiveGoal(row);
      const progress = await computeGoalProgress(eff, context);
      return { userGoal: row, eff, progress, auto: true };
    }));
  }

  async function computeAllProgress(userId, userGoals, ctxOverride){
    const ctx = ctxOverride || await buildContext(userId);
    const results = await Promise.all(userGoals.map(async (row) => {
      const eff = effectiveGoal(row);
      const progress = await computeGoalProgress(eff, ctx);
      return { userGoal: row, eff, progress };
    }));
    return results;
  }

  // The one function collection.js's add-to-collection flow calls after a
  // successful insert. Recomputes every selected goal's progress, persists
  // any newly-crossed completed_at, clears one that dropped back below
  // 100% (a card removal un-completing a goal, mirroring My Pokédex's own
  // discover/un-discover symmetry), and hands back just the ones that
  // freshly completed so the caller can show a toast for them.
  async function checkAndUpdateGoalCompletions(userId){
    let userGoals;
    try{ userGoals = await loadUserGoals(userId, { forceRefresh: true }); }catch{ return { results: [], newlyCompleted: [] }; }
    if(!userGoals.length) return { results: [], newlyCompleted: [] };
    const ctx = await buildContext(userId);
    const results = await computeAllProgress(userId, userGoals, ctx);
    const newlyCompleted = [];
    await Promise.all(results.map(async ({ userGoal, eff, progress }) => {
      const wasComplete = !!userGoal.completed_at;
      if(progress.complete && !wasComplete){
        try{ await client().from('user_collector_goals').update({ completed_at: new Date().toISOString() }).eq('id', userGoal.id); }catch{}
        newlyCompleted.push({ userGoal, eff, progress });
      } else if(!progress.complete && wasComplete){
        try{ await client().from('user_collector_goals').update({ completed_at: null }).eq('id', userGoal.id); }catch{}
      }
    }));
    invalidateUserGoalsCache();
    return { results, newlyCompleted };
  }

  window.InfinitePullsCollectorGoals = {
    GOAL_TYPE_META,
    loadGoalTemplates, invalidateTemplatesCache, createTemplate, updateTemplate, deleteTemplate, reorderTemplates,
    loadUserGoals, invalidateUserGoalsCache, selectGoal, createCustomGoal, updateCustomManualCurrent,
    setPrimaryGoal, clearPrimaryGoal, deleteUserGoal,
    effectiveGoal, computeGoalProgress, buildContext, computeAllProgress, computeAutoProgress, checkAndUpdateGoalCompletions,
    fetchSetDetail, loadAllSets,
  };
})();
