/* Import a Photoshop file (.psd): each layer becomes a part's image.

   The file is read with ag-psd (js/vendor/ag-psd.js, MIT), loaded the first time a PSD is dropped.
   Layers are matched to parts by their names, the way dropped files are. A layer that matches
   nothing is offered as a new part of your own. Every image is written at the full size of the
   document, so the parts line up exactly as they do in Photoshop. */
(function (PT) {
  const { el } = PT;
  const MAX_SIDE = 4096;     // a larger document is scaled down to this
  const MAX_LAYERS = 300;

  let lib = null;
  function loadLib() {
    if (window.agPsd) return Promise.resolve(window.agPsd);
    if (!lib) {
      lib = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/vendor/ag-psd.js';
        s.onload = () => (window.agPsd ? resolve(window.agPsd) : reject(new Error('the PSD reader did not load')));
        s.onerror = () => { lib = null; reject(new Error('the PSD reader could not be loaded')); };
        document.head.append(s);
      });
    }
    return lib;
  }

  // layer names that say which frame or side, not which part: the group they are in says the part
  const GENERIC = /^(layer|copy|group|open|opened|close|closed|shut|half|mid|small|wide|big|talk|blink|left|right|l|r|upper|lower|top|bottom|front|back|behind|rear|main|base|idle|quiet|\d+)$/;

  /* The layers with pixels, from the back to the front: [{ name, path, layer, hidden, opacity }].
     path = the names of the groups the layer is in, outermost first. A layer inside a hidden
     group counts as hidden; opacity includes the groups'. */
  function flatten(psd) {
    const out = [];
    const walk = (children, path, hidden, opacity) => {
      for (const l of (children || []).slice().reverse()) {          // ag-psd lists the front layer first
        const name = String(l.name == null ? '' : l.name).trim();
        const hid = hidden || !!l.hidden, op = opacity * (Number.isFinite(l.opacity) ? l.opacity : 1);
        if (Array.isArray(l.children)) { walk(l.children, path.concat(name), hid, op); continue; }
        if (!(l.right > l.left && l.bottom > l.top)) continue;       // no pixels: an empty or adjustment layer
        if (l.adjustment) continue;
        out.push({ name: name || 'Layer', path, layer: l, hidden: hid, opacity: op });
      }
    };
    walk(psd && psd.children, [], false, 1);
    return out;
  }

  /* Where each layer should go: 'part:state', 'new' (a part of your own, with parent) or 'skip'.
     room = how many more custom parts may be added. */
  function plan(layers, room = PT.MAX_CUSTOM_PARTS) {
    const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return layers.map((l) => {
      let r = PT.routeFilename(l.name + '.png');
      // "open" in a group called "Eyes": the group names the part
      if (!r.part && l.path.length && words(l.name).every((w) => GENERIC.test(w))) r = PT.routeFilename(l.path.concat(l.name).join(' ') + '.png');
      if (r.part) return { to: r.part + ':' + r.state };
      if (l.hidden || room <= 0) return { to: 'skip' };              // a hidden layer nothing claims is most likely a scrap
      room--;
      // it hangs from the part its group stands for ("Hat" in "Head" -> the face), else from the torso
      let parent = 'torso';
      for (let i = l.path.length - 1; i >= 0; i--) { const g = PT.routeFilename(l.path[i] + '.png'); if (g.part) { parent = g.part; break; } }
      return { to: 'new', parent };
    });
  }

  /* The drawing order after an import. order = the project's order (back to front);
     imported = [[part id, how far to the front its layer is in the document]…].
     Built-in parts that were imported swap places among themselves to match the document, and the
     parts nothing was imported for stay where they are. Each of the user's own parts goes right
     in front of the imported part below it in the document (or behind them all). */
  function reorder(order, imported) {
    const z = new Map(imported), custom = (id) => !!(PT.PART[id] && PT.PART[id].custom);
    const byDoc = [...z.keys()].sort((a, b) => z.get(a) - z.get(b));
    const base = order.filter((id) => z.has(id) && !custom(id));
    const baseSorted = base.slice().sort((a, b) => z.get(a) - z.get(b));
    let out = order.map((id) => (base.includes(id) ? baseSorted.shift() : id)).filter((id) => !(z.has(id) && custom(id)));
    byDoc.forEach((id, n) => {
      if (!custom(id)) return;
      const below = byDoc.slice(0, n).reverse().find((x) => out.includes(x));
      if (below) { out.splice(out.indexOf(below) + 1, 0, id); return; }
      const above = byDoc.slice(n + 1).find((x) => out.includes(x));
      out.splice(above ? out.indexOf(above) : out.length, 0, id);
    });
    return out;
  }

  const Psd = {
    MAX_SIDE, flatten, plan, reorder, loadLib,

    // read a dropped .psd and show what will go where
    async open(file) {
      let psd, ag;
      try {
        ag = await loadLib();
        // useRawData: a layer's pixels are only unpacked when asked for (canvasOf), one layer at a time
        psd = ag.readPsd(await file.arrayBuffer(), { useRawData: true, skipCompositeImageData: true, skipThumbnail: true, skipLinkedFilesData: true });
      } catch (e) { PT.toast(`Could not read ${file.name}: ${e.message}`, 'error', 8000); return; }
      const layers = flatten(psd).slice(0, MAX_LAYERS);
      if (!layers.length || !(psd.width > 0 && psd.height > 0)) { PT.toast(`${file.name} has no layers with pictures in them.`, 'warn', 6000); return; }
      this.show({ ag, psd, layers, name: file.name });
    },

    canvasOf(ag, layer) { return (ag.getLayerCanvas && ag.getLayerCanvas(layer)) || layer.canvas || null; },

    thumb(ag, layer) {
      const c = el('canvas', { class: 'psd-thumb', width: 44, height: 44 });
      try {
        const src = this.canvasOf(ag, layer);
        if (src && src.width && src.height) {
          const k = Math.min(44 / src.width, 44 / src.height);
          c.getContext('2d').drawImage(src, (44 - src.width * k) / 2, (44 - src.height * k) / 2, src.width * k, src.height * k);
        }
      } catch (e) { /* no thumbnail */ }
      return c;
    },

    show(job) {
      this.close();
      const choices = plan(job.layers, PT.MAX_CUSTOM_PARTS - PT.App.project.customParts.length);
      const targets = [];
      for (const d of PT.PARTS) for (const st of d.states) targets.push([d.id + ':' + st, PT.partName(d) + (d.states.length > 1 ? ': ' + d.stateLabels[st] : '')]);
      const rows = job.layers.map((l, i) => {
        const sel = el('select', { 'aria-label': 'Goes to' },
          el('option', { value: 'skip' }, 'Leave out'),
          el('option', { value: 'new' }, 'A new part of its own'),
          ...targets.map(([v, label]) => el('option', { value: v }, label)));
        sel.value = choices[i].to;
        sel.onchange = () => { choices[i] = { ...choices[i], to: sel.value, parent: choices[i].parent || 'torso' }; };
        return el('div', { class: 'psd-row' + (l.hidden ? ' hidden-layer' : '') },
          this.thumb(job.ag, l.layer),
          el('div', { class: 'psd-name', title: l.path.concat(l.name).join(' / ') },
            el('div', {}, l.name), el('div', { class: 'part-sub' }, (l.path.length ? l.path.join(' / ') : 'top level') + (l.hidden ? ' · hidden' : ''))),
          sel);
      });
      const avatar = PT.Avatars.activeName();
      this.back = el('div', { class: 'modal-back' },
        el('div', { class: 'modal psd-modal', role: 'dialog', 'aria-label': 'Import a PSD' },
          el('header', { class: 'modal-head' },
            el('h2', {}, 'Import ' + job.name),
            el('span', { class: 'part-sub' }, `${job.psd.width} × ${job.psd.height}px, ${job.layers.length} layer${job.layers.length === 1 ? '' : 's'}`),
            el('button', { class: 'icon-btn close', title: 'Close', onclick: () => this.close() }, '✕')),
          el('div', { class: 'psd-list' },
            el('p', { class: 'note' }, `Each layer becomes the image of a part of "${avatar}", replacing the image that part has. Layers were matched by their names; change any that are wrong. Several layers sent to the same part are put together into one image.`),
            ...rows),
          el('footer', { class: 'modal-foot' },
            el('span', { class: 'note' }, 'Listed from the back to the front.'),
            el('button', { class: 'btn ghost', onclick: () => this.close() }, 'Cancel'),
            el('button', { class: 'btn primary', onclick: (e) => { e.target.disabled = true; this.apply(job, choices); } }, 'Import'))));
      this.onKey = (e) => { if (e.key === 'Escape') this.close(); };
      window.addEventListener('keydown', this.onKey, true);
      document.body.append(this.back);
    },

    close() {
      if (this.back) this.back.remove();
      if (this.onKey) window.removeEventListener('keydown', this.onKey, true);
      this.back = this.onKey = null;
    },

    /* Make the images and hand them to the editor. choices[i] says where layer i goes. */
    async apply(job, choices) {
      const app = PT.App, { ag, psd, layers } = job;
      const k = Math.min(1, MAX_SIDE / Math.max(psd.width, psd.height));
      const W = Math.max(1, Math.round(psd.width * k)), H = Math.max(1, Math.round(psd.height * k));
      try {
        // new parts first: the skeleton has to know them before they get an image
        const groups = new Map();   // 'part:state' -> { layers: [index…] }, in the order first seen (back to front)
        let added = 0;
        layers.forEach((l, i) => {
          let to = choices[i].to;
          if (to === 'skip') return;
          if (to === 'new') {
            const id = app.addPart(l.name.slice(0, 40), PT.PART[choices[i].parent] ? choices[i].parent : 'torso');
            if (!id) return;   // no room for more parts
            added++;
            to = id + ':main';
          }
          if (!groups.has(to)) groups.set(to, []);
          groups.get(to).push(i);
        });
        if (!groups.size) { this.close(); PT.toast('Nothing to import.', 'warn'); return; }

        // built-in parts first, so the parts that follow line up with them
        const jobs = [...groups.entries()].map(([to, idx]) => ({ part: to.split(':')[0], state: to.split(':')[1], idx }));
        const rank = (id) => { const i = PT.BASE_PARTS.findIndex((d) => d.id === id); return i < 0 ? 999 : i; };
        jobs.sort((a, b) => rank(a.part) - rank(b.part));
        let done = 0;
        for (const j of jobs) {
          const c = document.createElement('canvas'); c.width = W; c.height = H;
          const g = c.getContext('2d');
          g.imageSmoothingQuality = 'high';
          for (const i of j.idx) {
            const l = layers[i], src = this.canvasOf(ag, l.layer);
            if (!src) continue;
            g.globalAlpha = Math.max(0, Math.min(1, l.opacity));
            g.drawImage(src, l.layer.left * k, l.layer.top * k, src.width * k, src.height * k);
          }
          await PT.Editor.uploadData(j.part, j.state, c.toDataURL('image/png'));
          done++;
        }

        app.project.order = Psd.reorder(app.project.order, jobs.map((j) => [j.part, Math.max(...j.idx)]));

        PT.Editor.resetHistory();
        this.close();
        app.changed({ structure: true });
        PT.toast(`Imported ${done} image${done === 1 ? '' : 's'} from ${job.name}` + (added ? `, with ${added} new part${added === 1 ? '' : 's'} of your own.` : '.'), '', 6000);
      } catch (e) {
        console.error(e);
        this.close();
        app.changed({ structure: true });
        PT.toast(`The import stopped: ${e.message}`, 'error', 8000);
      }
    },
  };

  PT.Psd = Psd;
})(window.PT);
