/* Turning one phone photo into the four pictures it has to become.
 *
 * Shared by the admin upload form and the customer submit form, which is
 * why it is its own file — /admin/ does not load the public app's
 * JavaScript, and two copies of a crop function is two crop functions to
 * fix when the watermark moves.
 *
 * WHAT COMES OUT
 *
 *   full     max 1600px on the long edge. What the gallery page shows.
 *   square   1080x1080, watermarked. The Facebook/Instagram feed post.
 *   story    1080x1920, watermarked. Instagram/Facebook stories.
 *   og       1200x630,  watermarked. The link preview card.
 *
 * WHY ALL OF THEM ARE MADE HERE, IN THE BROWSER, AT UPLOAD TIME
 *
 * Three reasons, in order of how much they matter.
 *
 * 1. Facebook caches a link preview the first time it scrapes it and does
 *    not come back. A crop generated later, or on demand, or differently
 *    on a second request, means a post already in somebody's feed shows a
 *    picture that no longer matches. The crops have to exist and be final
 *    before the link is ever shared.
 *
 * 2. It costs nothing and needs no server. Same approach as the "Share My
 *    Collector Card" button on the public profile pages — canvas, done on
 *    the phone that took the photo.
 *
 * 3. Jeff gets branded pictures out of a snapshot without doing anything.
 *    That is the whole point of the feature: his phone photos come back
 *    looking like a shop made them.
 *
 * ON THE CROPPING
 *
 * Centre-weighted, but biased slightly ABOVE centre. Cards, faces and
 * the interesting part of a shelf are almost always in the upper half of
 * a phone photo, and a dead-centre square crop reliably cuts the top off
 * a card standing upright. This is a small thing that makes the
 * difference between usable output and output Jeff re-does by hand.
 */
(function () {
  'use strict';

  const LONG_EDGE   = 1600;
  const JPEG_Q      = 0.86;
  const SITE        = 'infinitepulls.com';
  const WORDMARK    = 'INFINITE PULLS';

  // Upper-middle. 0 would be the very top, 0.5 dead centre.
  const VERTICAL_BIAS = 0.42;

  const SIZES = {
    square: { w: 1080, h: 1080 },
    story:  { w: 1080, h: 1920 },
    og:     { w: 1200, h: 630  }
  };

  /* ---------- loading ---------------------------------------------- */

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      // Only matters for the optional logo, which may come from storage.
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = src;
    });
  }

  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) {
        reject(new Error('That file is not a picture.'));
        return;
      }
      const url = URL.createObjectURL(file);
      loadImage(url)
        .then((img) => { URL.revokeObjectURL(url); resolve(img); })
        .catch((err) => { URL.revokeObjectURL(url); reject(err); });
    });
  }

  /* ---------- the watermark ----------------------------------------- */

  /* A wordmark and the address, bottom-left, over a soft gradient so it
   * stays readable on a light photo and a dark one without having to know
   * which it is.
   *
   * Text rather than the logo PNG on purpose: infinite-pulls-logo.png is
   * 2MB, which is a real wait on a phone on shop wifi, and the thing that
   * actually earns a click is the address being legible. If a small logo
   * is ever added to assets/, pass its URL as opts.logo and it is drawn
   * alongside.
   */
  async function watermark(ctx, w, h, opts) {
    const pad   = Math.round(w * 0.045);
    const band  = Math.round(h * 0.20);
    const scale = Math.min(w, h);

    const grad = ctx.createLinearGradient(0, h - band, 0, h);
    grad.addColorStop(0, 'rgba(3, 7, 13, 0)');
    grad.addColorStop(1, 'rgba(3, 7, 13, 0.78)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, h - band, w, band);

    let x = pad;

    if (opts && opts.logo) {
      try {
        const logo = await loadImage(opts.logo);
        const lh = Math.round(scale * 0.085);
        const lw = Math.round(lh * (logo.width / logo.height));
        ctx.drawImage(logo, x, h - pad - lh, lw, lh);
        x += lw + Math.round(pad * 0.6);
      } catch (_) {
        // A missing logo is not a reason to fail a whole upload.
      }
    }

    const markSize = Math.round(scale * 0.042);
    const siteSize = Math.round(scale * 0.030);

    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = Math.round(scale * 0.012);

    ctx.font = `700 ${markSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.letterSpacing = '2px';
    ctx.fillText(WORDMARK, x, h - pad - siteSize - Math.round(scale * 0.014));

    ctx.font = `500 ${siteSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.letterSpacing = '0px';
    ctx.fillText(SITE, x, h - pad);

    ctx.shadowBlur = 0;
  }

  /* ---------- the crops ---------------------------------------------- */

  function drawCover(ctx, img, w, h) {
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = (w - dw) / 2;
    // The upper-middle bias described at the top of this file.
    const dy = (h - dh) * VERTICAL_BIAS;
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not save that image.'))),
        'image/jpeg',
        JPEG_Q
      );
    });
  }

  async function crop(img, size, opts) {
    const canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext('2d');

    // A photo that does not fill the frame should sit on the shop's dark,
    // not on transparent-turned-black or white.
    ctx.fillStyle = '#03070d';
    ctx.fillRect(0, 0, size.w, size.h);

    drawCover(ctx, img, size.w, size.h);
    if (!opts || opts.watermark !== false) await watermark(ctx, size.w, size.h, opts);

    return canvasToBlob(canvas);
  }

  /* Down-scale only. Blowing a small photo up to 1600 makes it worse and
   * bigger at the same time. */
  async function resizeLongEdge(img, maxEdge) {
    const longest = Math.max(img.width, img.height);
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    return { blob: await canvasToBlob(canvas), width: w, height: h };
  }

  /* ---------- what the forms actually call ---------------------------- */

  /* One photo in, four blobs out.
   *
   * opts.crops === false does the resize only. That is what the customer
   * submit form uses: a submission that may never be approved does not
   * need three branded crops made for it, and generating them would put
   * the shop's watermark on a photo before anybody had agreed to publish
   * it. The crops are made if and when Jeff approves it.
   */
  async function prepare(file, opts) {
    const options = opts || {};
    const img = await fileToImage(file);
    const full = await resizeLongEdge(img, options.maxEdge || LONG_EDGE);

    const out = {
      full: full.blob,
      width: full.width,
      height: full.height,
      square: null,
      story: null,
      og: null
    };

    if (options.crops === false) return out;

    out.square = await crop(img, SIZES.square, options);
    out.story  = await crop(img, SIZES.story,  options);
    out.og     = await crop(img, SIZES.og,     options);

    return out;
  }

  /* Hands a generated crop to the phone as a download. Used by the "save
   * for Instagram" buttons after a post is published. */
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  window.InfinitePullsGalleryImage = {
    prepare,
    crop,
    resizeLongEdge,
    fileToImage,
    download,
    SIZES,
    LONG_EDGE
  };
})();
