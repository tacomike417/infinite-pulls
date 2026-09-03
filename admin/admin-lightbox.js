/* A LIGHTBOX THAT BORROWS A CARD RATHER THAN COPYING ONE.
 * 3 September 2026.
 *
 * openLightbox('dexcard-card', 'Make card art') lifts that section out of the
 * page, puts it in a panel over everything, and puts it back when the panel
 * closes.
 *
 * MOVED, NOT CLONED, and that is the whole design. A copy would mean two
 * elements with the same ids, every getElementById in dex-card-builder.js
 * finding whichever came first, and half the listeners attached to the half
 * that is not on screen. Moving the real node keeps every id unique and
 * carries every listener along with the element it is bound to -- the same
 * bargain admin-tabs.js and admin-foldout.js already make.
 *
 * So this file knows nothing about card art. It knows how to borrow a
 * section and give it back.
 */
(function () {
  'use strict';

  let host = null;      // where the borrowed section lives when we are closed
  let borrowed = null;  // the section itself
  let lastFocus = null;

  function shell() {
    let el = document.getElementById('admin-lightbox');
    if (el) return el;

    el = document.createElement('div');
    el.id = 'admin-lightbox';
    el.className = 'lightbox';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML =
      '<div class="lightbox-backdrop" data-close></div>' +
      '<div class="lightbox-panel" role="document">' +
        '<div class="lightbox-head">' +
          '<strong class="lightbox-title"></strong>' +
          '<button type="button" class="lightbox-x" data-close aria-label="Close">✕</button>' +
        '</div>' +
        '<div class="lightbox-body"></div>' +
        '<div class="lightbox-foot">' +
          '<button type="button" class="primary-btn" data-close>Done</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);

    el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
    /* Escape closes, because every other dialog he has ever used does. */
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.hidden) close();
    });
    return el;
  }

  function open(sectionId, title) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    const box = shell();

    lastFocus = document.activeElement;
    box.querySelector('.lightbox-title').textContent = title || '';

    /* A marker is left exactly where the section was standing, so it goes
       back into the same place in the same tab -- not appended to the end of
       whatever happens to be open when he closes this. */
    host = document.createComment('lightbox-slot');
    section.parentNode.insertBefore(host, section);
    borrowed = section;
    box.querySelector('.lightbox-body').appendChild(section);

    box.hidden = false;
    document.body.classList.add('has-lightbox');
    const first = section.querySelector('input, textarea, select, button');
    if (first) first.focus();
  }

  function close() {
    const box = document.getElementById('admin-lightbox');
    if (!box || box.hidden) return;
    if (borrowed && host && host.parentNode) {
      host.parentNode.insertBefore(borrowed, host);
      host.parentNode.removeChild(host);
    }
    borrowed = null;
    host = null;
    box.hidden = true;
    document.body.classList.remove('has-lightbox');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  window.AdminLightbox = { open, close };
})();
