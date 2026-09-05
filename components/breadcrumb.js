/* WHERE AM I?
 *
 * The app was missing the one thing every app needs and none of its pages
 * were carrying: a statement of where you are, and a way back that is not
 * the phone's own back button.
 *
 * The bar at the bottom shows six destinations and highlights one of them.
 * That works while you are on one of those six. Nine more pages live in
 * the menu -- My Account, Collector Goals, The Gallery, Events, Deals,
 * Location, Hours, Contact, About -- and Card Lookup lives nowhere at all.
 * Land on any of those and nothing on screen says what you are looking at.
 *
 * So: Home > My Collection. Home is a link. The current page is not,
 * because a link to where you already are is a tap that does nothing.
 *
 * IT TAKES ITS NAMES FROM THE NAV
 *
 * Both nav lists are exported by components/navbar.js and read here rather
 * than copied. A page renamed in the nav is renamed here on the same
 * commit -- which matters in an app that has already renamed "Badges" to
 * "Collector Goals" and "Infinite Dex" to "Infinite Rewards" and is not
 * finished.
 *
 * NOTHING ON HOME. You cannot be lost on the front page, and "Home" on its
 * own is a row of furniture saying nothing.
 */
(function () {
  'use strict';

  const el = () => document.getElementById('breadcrumb');

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  /* Pages the nav does not list, because they are reached from inside
     something else rather than from a menu. Card Lookup is the loudest
     example: the busiest screen in the app and the only one with no name
     anywhere on it. */
  const EXTRA = {
    lookup: 'Card Lookup',
    menu:   'Menu'
  };

  function labelFor(page) {
    const nav = window.InfinitePullsNavbar;
    if (nav) {
      const lists = [nav.primaryNav || [], nav.menuNav || []];
      for (const list of lists) {
        const hit = list.find((i) => i.page === page);
        if (hit) return hit.label;
      }
    }
    if (EXTRA[page]) return EXTRA[page];
    // Never shows a route name at somebody: "not-a-page" reads as a bug.
    return page ? page.charAt(0).toUpperCase() + page.slice(1) : '';
  }

  /* A THIRD CRUMB, for the places a page has rooms inside it.
   *
   * My Collection is four screens wearing one name -- Collection, Wish
   * List, Sealed, and Portfolio View -- and the breadcrumb said "My
   * Collection" for all of them. Somebody two taps deep in a wish list had
   * nothing on screen distinguishing it from the collection itself.
   *
   * Set by the page that owns the state, because only it knows which room
   * you are in. Cleared automatically on every navigation, so a stale
   * "Wish List" can never follow somebody onto another page. */
  let currentPage = '';
  let sub = '';

  function setSub(label) {
    sub = String(label || '');
    draw();
  }

  function draw() {
    const root = el();
    if (!root) return;

    if (!currentPage || currentPage === 'home') {
      root.hidden = true;
      root.innerHTML = '';
      return;
    }

    const label = labelFor(currentPage);
    root.hidden = false;

    // With a sub-crumb the page's own name becomes a link back to it --
    // the way out of the room and into the rest of the house.
    const pageCrumb = sub
      ? `<a href="?page=${esc(currentPage)}" data-route="${esc(currentPage)}" class="crumb-home">${esc(label)}</a>`
      : `<span class="crumb-here" aria-current="page">${esc(label)}</span>`;

    root.innerHTML = `
      <a href="?page=home" data-route="home" class="crumb-home">Home</a>
      <span class="crumb-sep" aria-hidden="true">›</span>
      ${pageCrumb}
      ${sub ? `<span class="crumb-sep" aria-hidden="true">›</span>
               <span class="crumb-here" aria-current="page">${esc(sub)}</span>` : ''}`;
  }

  function render(page) {
    currentPage = page || '';
    sub = '';   // never let a room's name follow somebody to another page
    draw();
  }

  window.InfinitePullsBreadcrumb = { render, setSub, labelFor };
})();
