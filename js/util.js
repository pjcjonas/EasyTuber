/* Shared helpers: 2D affine matrices, math, DOM, toasts. Global namespace: PT */
window.PT = window.PT || {};

(function (PT) {
  const DEG = Math.PI / 180;

  // Affine matrix as [a, b, c, d, e, f] (same layout as canvas setTransform)
  const M = {
    id: () => [1, 0, 0, 1, 0, 0],
    t: (x, y) => [1, 0, 0, 1, x, y],
    s: (x, y) => [x, 0, 0, y === undefined ? x : y, 0, 0],
    r: (deg) => { const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG); return [c, s, -s, c, 0, 0]; },
    mul(m, n) {
      return [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
      ];
    },
    chain(...ms) { return ms.reduce((acc, m) => M.mul(acc, m)); },
    apply: (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
    applyVec: (m, x, y) => [m[0] * x + m[2] * y, m[1] * x + m[3] * y],
    inv(m) {
      const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
      return [
        m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
        (m[2] * m[5] - m[3] * m[4]) / det,
        (m[1] * m[4] - m[0] * m[5]) / det,
      ];
    },
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  // frame-rate independent exponential approach
  const approach = (cur, target, rate, dt) => target + (cur - target) * Math.exp(-rate * dt);

  class Spring {
    constructor(stiffness = 120, damping = 12) { this.k = stiffness; this.c = damping; this.x = 0; this.v = 0; }
    step(target, dt) {
      // semi-implicit Euler with substeps for stability
      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const a = this.k * (target - this.x) - this.c * this.v;
        this.v += a * h;
        this.x += this.v * h;
      }
      return this.x;
    }
  }

  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return e;
  }

  function toast(msg, kind = '', ms = 3800) {
    const host = document.getElementById('toasts');
    if (!host) return;
    const t = el('div', { class: 'toast ' + kind }, msg);
    host.append(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, ms);
    setTimeout(() => t.remove(), ms + 350);
  }

  function debounce(fn, ms) {
    let id;
    return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); };
  }

  const deepClone = (o) => JSON.parse(JSON.stringify(o));

  function readFileAsDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
  }

  /* Where a picture in the avatar is: "img:<hash>" is a file the app keeps (see storage.js),
     anything else (a data URL, a path) is used as it is. */
  const isImageRef = (v) => typeof v === 'string' && /^img:[0-9a-f]{64}$/.test(v);
  const imageSrc = (v) => (isImageRef(v) ? 'api/image/' + v.slice(4) : v);

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Could not load image'));
      img.src = imageSrc(src);
    });
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  Object.assign(PT, { M, DEG, clamp, lerp, approach, Spring, el, toast, debounce, deepClone, readFileAsDataURL, loadImage, isImageRef, imageSrc, download });
})(window.PT);
