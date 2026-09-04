/* SCANNING A BARCODE OFF A SEALED BOX.
 *
 * WHY THIS IS SEPARATE FROM THE CARD SCANNER
 *
 * They look like the same job and are not. The card scanner takes ONE
 * photograph and reads it, because a card is flat, held still, and the
 * thing being read is printed at a known size. A barcode is small, on the
 * back or the bottom of a box, and the natural way anybody scans one is to
 * move the phone until it catches -- so this watches the video stream
 * continuously and closes itself the instant it reads something.
 *
 * That difference is the whole user experience. Point, and it is done.
 *
 * WHY A BARCODE AND NOT THE WORDS ON THE BOX
 *
 * A Pokemon Center Elite Trainer Box and an ordinary one share a set name,
 * a product type and nearly an artwork. They are different products at
 * different prices, and their barcodes differ. So do reprint waves, a
 * Japanese box beside its English twin, and a warehouse bundle beside the
 * single box inside it. None of that is legible as text; all of it is in
 * the barcode.
 *
 * WHAT IT RUNS ON
 *
 * BarcodeDetector, which is native in Chrome on Android -- no library, no
 * download, no cost. It is NOT in Safari on iOS. supported() answers
 * honestly so the caller can say so plainly rather than opening a camera
 * that will never succeed.
 */
(function () {
  'use strict';

  // EAN-13 and UPC-A cover retail packaging; the others cost nothing to
  // ask for and occasionally appear on distributor stickers.
  const FORMATS = ['ean_13', 'upc_a', 'ean_8', 'upc_e', 'code_128', 'itf'];

  function supported() {
    return typeof window !== 'undefined' && 'BarcodeDetector' in window;
  }

  function cameraAvailable() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /* Resolves to the barcode string, or null if cancelled, or the string
     'unavailable' when there is no camera or no detector. Deliberately the
     same shape the card scanner returns, so callers handle both the same
     way. */
  function scan() {
    return new Promise(async (resolve) => {
      if (!supported() || !cameraAvailable()) return resolve('unavailable');

      let detector;
      try {
        detector = new window.BarcodeDetector({ formats: FORMATS });
      } catch (_) {
        return resolve('unavailable');
      }

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false
        });
      } catch (_) {
        return resolve('unavailable');
      }

      const overlay = document.createElement('div');
      overlay.className = 'scan-overlay barcode-overlay';
      overlay.innerHTML = `
        <div class="scan-stage">
          <video class="scan-video" playsinline muted autoplay></video>
          <div class="scan-mask" aria-hidden="true">
            <div class="barcode-guide"></div>
          </div>
        </div>
        <div class="scan-controls">
          <p class="scan-tip">Point at the barcode on the box. It reads by itself — no button.</p>
          <div class="scan-buttons">
            <button type="button" class="ghost-btn scan-cancel">Cancel</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      document.body.classList.add('scan-open');

      const video = overlay.querySelector('.scan-video');
      video.srcObject = stream;

      let done = false;
      let timer = null;

      function finish(value) {
        if (done) return;
        done = true;
        if (timer) clearInterval(timer);
        try { stream.getTracks().forEach((t) => t.stop()); } catch (_) { /* already gone */ }
        overlay.remove();
        document.body.classList.remove('scan-open');
        resolve(value);
      }

      overlay.querySelector('.scan-cancel').addEventListener('click', () => finish(null));

      try { await video.play(); } catch (_) { /* autoplay attribute covers it */ }

      /* Six times a second. Fast enough that it feels instant, slow enough
         that it is not fighting the camera for the phone. */
      timer = setInterval(async () => {
        if (done || video.readyState < 2) return;
        let found = [];
        try { found = await detector.detect(video); } catch (_) { return; }
        const hit = found.find((b) => b && b.rawValue && /^\d{6,14}$/.test(b.rawValue));
        if (hit) {
          // A short buzz, where the phone allows it: he is looking at the
          // box, not at the screen.
          try { navigator.vibrate && navigator.vibrate(40); } catch (_) { /* fine */ }
          finish(normalize(hit.rawValue));
        }
      }, 160);

      // Nobody stands there forever. Closing beats a camera left running.
      setTimeout(() => finish(null), 45000);
    });
  }

  /* A UPC-A is a 12-digit code; the same product scanned elsewhere may
     come back as the 13-digit EAN with a leading zero. Storing both would
     mean the same box is two products, so they are folded to one form. */
  function normalize(raw) {
    const s = String(raw || '').replace(/\D/g, '');
    if (s.length === 13 && s.charAt(0) === '0') return s.slice(1);
    return s;
  }

  window.InfinitePullsBarcode = { scan, supported, normalize, FORMATS };
})();
