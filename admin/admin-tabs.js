/* The admin panel, grouped into tabs.
 *
 * This file does not restructure index.html and does not touch admin.js.
 * It finds the sections that are already there, moves them into panels,
 * and builds a tab strip above them. Everything keeps its id, so every
 * getElementById in admin.js and infinite-dex-admin.js still finds what it
 * is looking for, and every listener already attached goes along with the
 * element it is attached to.
 *
 * WHY IT IS WORTH DOING
 *
 * The panel had grown to thirteen sections on one scroll. Jeff meets all
 * of it at once, every time, including the eleven things he is not here to
 * do. Tabs are not decoration on a page that long; they are the difference
 * between a panel he uses and one he avoids.
 *
 * THE GROUPING
 *
 * By what he came here to DO, not by which feature built it.
 *
 *   Today         a customer is standing there right now
 *   Infinite Dex  the collecting side, cards and rewards and goals
 *   Promote       anything announced to customers: banner, push, events, deals
 *   Gallery       photos: posting them, and what customers have sent in
 *   Marketing     artwork and posters, and whatever else gets generated
 *   The Store     the physical shop: address, hours, stock, demand
 *
 * Marketing is one section today and deliberately has a tab to itself:
 * card-art generation is going in beside it, and it is a different job
 * from telling customers something.
 *
 * If a section is ever added to index.html and not listed below, it is not
 * lost -- it lands in the last tab. Failing that way round was deliberate.
 */
(function () {
  'use strict';

  const TABS = [
    {
      id: 'today',
      label: 'Today',
      hint: 'A customer at the counter, and how the shop is doing.',
      members: ['dex-redeem-card', 'stats-card']
    },
    {
      id: 'dex',
      label: 'Infinite Dex',
      hint: 'Whether it is running at all, the cards customers collect, what they are worth, and the goals alongside them.',
      members: ['dex-switch-card', 'dex-card', 'dex-rewards-card', 'goals-card']
    },
    {
      id: 'promote',
      label: 'Promote',
      hint: 'Anything you announce to customers — on the app, on their phone, or on the calendar.',
      members: ['banner-card', 'push-card', 'events-card', 'deals-card']
    },
    {
      id: 'gallery',
      label: 'Gallery',
      hint: 'Photos of the shop and what is in it. Take a picture, pick a caption, post it.',
      members: ['gallery-master-card', 'gallery-post-card', 'gallery-queue-card']
    },
    {
      id: 'marketing',
      label: 'Marketing',
      hint: 'Posters and card art. Fill the form in and it writes the prompt; you send it and get a picture back.',
      members: ['marketing-card', 'dexcard-card']
    },
    {
      id: 'store',
      label: 'The Store',
      hint: 'The shop itself: where it is, when it is open, and what is on the shelf.',
      // #admin-form wraps Store Info AND Hours in one form with one save
      // button, so it moves as one piece. Splitting them would break saving.
      members: ['admin-form', 'clover-card', 'shop-pulse-card']
    }
  ];

  const STORE_KEY = 'infinite-pulls-admin-tab';

  function build() {
    const content = document.getElementById('admin-content');
    if (!content || content.dataset.tabbed === '1') return;

    // Everything that is a card or the store-info form, in the order the
    // page already has them. Anything not claimed below joins the last tab.
    const loose = [...content.children].filter(
      (n) => n.classList.contains('admin-card') || n.id === 'admin-form');
    if (loose.length < 2) return;   // nothing to organise; leave it alone

    const strip = document.createElement('div');
    strip.className = 'tab-strip';
    const list = document.createElement('div');
    list.className = 'tab-list';
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', 'Admin sections');
    strip.appendChild(list);

    const claimed = new Set();
    const panels = [];

    TABS.forEach((tab) => {
      const panel = document.createElement('div');
      panel.className = 'tab-panel';
      panel.id = 'tabpanel-' + tab.id;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', 'tab-' + tab.id);
      panel.hidden = true;

      if (tab.hint) {
        const hint = document.createElement('p');
        hint.className = 'tab-hint';
        hint.textContent = tab.hint;
        panel.appendChild(hint);
      }

      tab.members.forEach((id) => {
        const node = document.getElementById(id);
        if (node && loose.includes(node)) {
          panel.appendChild(node);        // move, not clone
          claimed.add(node);
        }
      });

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab-btn';
      btn.id = 'tab-' + tab.id;
      btn.dataset.tab = tab.id;
      btn.textContent = tab.label;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', panel.id);
      btn.setAttribute('aria-selected', 'false');
      btn.tabIndex = -1;

      list.appendChild(btn);
      panels.push({ tab, panel, btn });
    });

    // Nothing gets lost. A section added later and not grouped shows up
    // here rather than vanishing off the page.
    const orphans = loose.filter((n) => !claimed.has(n));
    if (orphans.length) orphans.forEach((n) => panels[panels.length - 1].panel.appendChild(n));

    content.appendChild(strip);
    panels.forEach((p) => content.appendChild(p.panel));
    content.dataset.tabbed = '1';

    function show(id, remember) {
      const found = panels.find((p) => p.tab.id === id) || panels[0];
      panels.forEach((p) => {
        const on = p === found;
        p.panel.hidden = !on;
        p.btn.classList.toggle('is-on', on);
        p.btn.setAttribute('aria-selected', on ? 'true' : 'false');
        p.btn.tabIndex = on ? 0 : -1;
      });
      found.btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (typeof edges === 'function') edges();
      if (remember) {
        try { window.localStorage.setItem(STORE_KEY, found.tab.id); } catch (_) {}
      }
    }

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (btn) { show(btn.dataset.tab, true); window.scrollTo({ top: 0, behavior: 'instant' }); }
    });

    // Arrow keys, because a tab strip that only works with a mouse is not
    // a tab strip.
    list.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const i = panels.findIndex((p) => p.btn.getAttribute('aria-selected') === 'true');
      const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + panels.length) % panels.length;
      show(panels[next].tab.id, true);
      panels[next].btn.focus();
    });

    // Fade whichever edge has more tabs beyond it, so a strip that scrolls
    // looks like one. Runs on scroll, on resize, and once at the start.
    function edges() {
      const more = list.scrollWidth - list.clientWidth;
      list.classList.toggle('can-left', list.scrollLeft > 4);
      list.classList.toggle('can-right', more > 4 && list.scrollLeft < more - 4);
    }
    list.addEventListener('scroll', edges, { passive: true });
    window.addEventListener('resize', edges);
    edges();

    // ?tab=dex wins, then whatever he was last looking at, then Today.
    let start = new URLSearchParams(location.search).get('tab');
    if (!start) { try { start = window.localStorage.getItem(STORE_KEY); } catch (_) {} }
    show(start || 'today', false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();

  window.InfinitePullsAdminTabs = { TABS, build };
})();
