/* FOLD-OUT CARDS -- a labelled row that opens what is under it.
 *
 * Add `data-foldout="Make a poster"` to any .admin-card and it becomes a row
 * with that label on it. Tap the row, the card's contents come down. Tap it
 * again, they fold away. That is the whole feature.
 *
 * Like admin-tabs.js, this does not rewrite index.html and does not touch
 * admin.js. It moves the nodes that are already there, so every id survives
 * and every listener goes along with the element it is attached to.
 *
 * WHY A LABELLED ROW AND NOT A ⊕
 *
 * The obvious version of this is a circled plus. It was considered and
 * turned down, and the reason is worth keeping.
 *
 * The person using this panel did not know the tab strip scrolled sideways.
 * Not because he could not work the control -- he worked it the moment it
 * was pointed out -- but because he does not go poking at things to find out
 * what they do. An icon on its own says "something happens here" without
 * saying what, and that is precisely the class of thing he does not find.
 *
 * It also gets worse as this page grows, which is the direction it is going.
 * One ⊕ is a puzzle solved once. Four of them down a page is four unlabelled
 * doors, and finding the poster maker means opening all of them. A word on
 * each row means reading instead of opening.
 *
 * The chevron rather than a plus is deliberate too: a plus promises "make a
 * new one", and what actually happens is "there is more under here".
 *
 * TWO RULES, BOTH FOR THE SAME REASON
 *
 * Closed on every load -- compacting the page is the point, and predictable
 * beats clever. And rows are INDEPENDENT: opening one never closes another.
 * An accordion that snaps things shut on its own is how somebody nervous
 * concludes they have broken it.
 */
(function () {
  'use strict';

  const CHEVRON =
    '<svg class="foldout-chev" viewBox="0 0 24 24" aria-hidden="true" fill="none" '
    + 'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M6 9l6 6 6-6"/></svg>';

  function fold(card) {
    if (card.dataset.foldoutReady === '1') return;

    const heading = card.querySelector('h2');
    const label = (card.dataset.foldout || '').trim()
      || (heading ? heading.textContent.trim() : 'More');

    /* Everything that is not the heading goes into the body. Read the
       children into an array FIRST -- appending to the body removes them
       from the card as we go, and a live list would skip every other one. */
    const body = document.createElement('div');
    body.className = 'foldout-body';
    body.id = card.id + '-foldout-body';
    body.hidden = true;
    [...card.children].forEach((node) => {
      if (node !== heading) body.appendChild(node);
    });

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'foldout-head';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', body.id);
    btn.innerHTML = '<span class="foldout-label"></span>' + CHEVRON;
    btn.querySelector('.foldout-label').textContent = label;

    /* The button goes INSIDE the heading rather than replacing it. The card
       keeps a real h2 in the document outline, and a screen reader still
       hears a heading it can jump to -- it just happens to be a button. */
    if (heading) {
      heading.textContent = '';
      heading.className = (heading.className + ' foldout-h').trim();
      heading.appendChild(btn);
      card.insertBefore(body, heading.nextSibling);
    } else {
      card.insertBefore(btn, card.firstChild);
      card.appendChild(body);
    }

    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      body.hidden = open;
      card.classList.toggle('is-open', !open);
    });

    card.classList.add('is-foldout');
    card.dataset.foldoutReady = '1';
  }

  function build() {
    document.querySelectorAll('.admin-card[data-foldout]').forEach(fold);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
