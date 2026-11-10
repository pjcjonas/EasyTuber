/* Runtime image cache: decoded images, alpha masks (for click hit-testing) and content bounding boxes. */
(function (PT) {
  const MAX_DIM = 2048;   // uploads larger than this are downscaled (keeps memory + saves sane)
  const MASK_DIM = 256;   // resolution of the alpha mask used for hit testing / bbox

  function analyze(source, w, h) {
    const k = Math.min(1, MASK_DIM / Math.max(w, h));
    const mw = Math.max(1, Math.round(w * k)), mh = Math.max(1, Math.round(h * k));
    const c = document.createElement('canvas');
    c.width = mw; c.height = mh;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, mw, mh);
    const data = ctx.getImageData(0, 0, mw, mh).data;
    const alpha = new Uint8Array(mw * mh);
    let x0 = mw, y0 = mh, x1 = -1, y1 = -1;
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const a = data[(y * mw + x) * 4 + 3];
        alpha[y * mw + x] = a;
        if (a > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
    }
    const sx = w / mw, sy = h / mh;
    const bbox = x1 < 0
      ? { x: 0, y: 0, w, h }
      : { x: x0 * sx, y: y0 * sy, w: (x1 - x0 + 1) * sx, h: (y1 - y0 + 1) * sy };
    return { mask: { w: mw, h: mh, sx, sy, alpha }, bbox };
  }

  function makeEntry(source, w, h, isPlaceholder = false) {
    return { source, w, h, isPlaceholder, ...analyze(source, w, h) };
  }

  PT.Assets = {
    user: {},          // partId -> state -> entry
    placeholders: {},  // partId -> state -> entry

    initPlaceholders() {
      const ph = PT.makePlaceholders();
      for (const [id, states] of Object.entries(ph)) {
        this.placeholders[id] = {};
        for (const [st, cv] of Object.entries(states)) this.placeholders[id][st] = makeEntry(cv, cv.width, cv.height, true);
      }
    },

    // Turn a File into a (possibly downscaled) PNG data URL
    async fileToDataURL(file, maxDim = MAX_DIM) {
      let url = await PT.readFileAsDataURL(file);
      const img = await PT.loadImage(url);
      const w = img.naturalWidth, h = img.naturalHeight;
      if (Math.max(w, h) > maxDim) {
        const k = maxDim / Math.max(w, h);
        const c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        url = c.toDataURL('image/png');
      }
      return url;
    },

    async load(partId, state, dataURL) {
      const img = await PT.loadImage(dataURL);
      const entry = makeEntry(img, img.naturalWidth, img.naturalHeight);
      entry.url = dataURL;
      (this.user[partId] = this.user[partId] || {})[state] = entry;
      return entry;
    },

    // Small preview canvas cropped to the visible pixels (full-canvas exports would look tiny otherwise)
    thumb(entry, size = 96) {
      const bb = entry.bbox, pad = Math.max(bb.w, bb.h) * 0.06;
      const sw = bb.w + pad * 2, sh = bb.h + pad * 2, k = size / Math.max(sw, sh);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(entry.source, bb.x - pad, bb.y - pad, sw, sh, 0, 0, c.width, c.height);
      return c;
    },

    remove(partId, state) { if (this.user[partId]) delete this.user[partId][state]; },
    clearAll() { this.user = {}; },

    // Sync the cache with a project; images that haven't changed are reused.
    async loadProject(project) {
      const next = {}, jobs = [];
      for (const [id, part] of Object.entries(project.parts)) {
        for (const [st, url] of Object.entries(part.images || {})) {
          if (!url) continue;
          const old = this.user[id] && this.user[id][st];
          if (old && old.url === url) { (next[id] = next[id] || {})[st] = old; continue; }
          jobs.push(PT.loadImage(url).then((img) => {
            const e = makeEntry(img, img.naturalWidth, img.naturalHeight);
            e.url = url;
            (next[id] = next[id] || {})[st] = e;
          }).catch(() => { delete part.images[st]; }));
        }
      }
      await Promise.all(jobs);
      this.user = next;
    },

    hasUser(partId) { return !!this.user[partId] && Object.keys(this.user[partId]).length > 0; },

    // The image that defines a part's coordinate frame (first state that exists).
    primary(partId, usePlaceholder = true) {
      const def = PT.PART[partId];
      const set = this.hasUser(partId) ? this.user[partId] : (usePlaceholder ? this.placeholders[partId] : null);
      if (!set) return null;
      for (const st of def.states) if (set[st]) return set[st];
      return null;
    },

    /*
     * Pick the image to draw for a wanted state, with sensible fallbacks.
     * Returns { entry, squash } where squash (y scale) fakes a missing state.
     */
    resolve(partId, want, usePlaceholder = true) {
      const user = this.hasUser(partId);
      const set = user ? this.user[partId] : (usePlaceholder ? this.placeholders[partId] : null);
      if (!set) return null;
      const def = PT.PART[partId];
      if (def.states.length === 1) return set.main ? { entry: set.main, squash: 1, state: 'main' } : null;

      const chains = {
        eyes:  { open: ['open', 'half', 'closed'], half: ['half', 'closed', 'open'], closed: ['closed', 'half', 'open'] },
        mouth: { closed: ['closed', 'half', 'open'], half: ['half', 'open', 'closed'], open: ['open', 'half', 'closed'] },
      }[partId];
      const chain = chains[want] || def.states;
      for (const st of chain) {
        if (set[st]) {
          let squash = 1;
          // Only one eye image? squash it vertically to fake a blink.
          if (partId === 'eyes' && st === 'open' && want !== 'open') squash = want === 'closed' ? 0.1 : 0.5;
          // Only a closed mouth? stretch it vertically to fake talking.
          if (partId === 'mouth' && st === 'closed' && want !== 'closed') squash = want === 'open' ? 2.2 : 1.6;
          return { entry: set[st], squash, state: st };
        }
      }
      return null;
    },
  };
})(window.PT);
