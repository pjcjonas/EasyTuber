/* Sprite sheet cropper: load one image, mark crop boxes, assign each box to a part/state,
   and crop them into the rig. Sheets are kept in the project so crops can be re-edited later. */
(function (PT) {
  const { el, clamp } = PT;
  const COLORS = ['#8b7bff', '#4fd1a5', '#ffb547', '#ff6b81', '#5ac8fa', '#f78fb3', '#c3e88d', '#ffd166', '#9be7ff', '#e0a3ff'];
  const HANDLE = 7;
  let uid = 0;
  const newId = (p) => p + Date.now().toString(36) + (uid++).toString(36);

  // every part/state slot as an option
  function slotOptions() {
    const out = [{ v: '', label: '— not used —' }];
    for (const def of PT.PARTS) {
      const prefix = def.group.includes('arm') ? def.group + ': ' : '';
      for (const st of def.states) {
        out.push({ v: def.id + '|' + st, label: prefix + def.label + (def.states.length > 1 ? ' — ' + def.stateLabels[st] : '') });
      }
    }
    return out;
  }
  const slotLabel = (b) => {
    if (!b.part) return 'not used';
    const o = slotOptions().find((x) => x.v === b.part + '|' + b.state);
    return o ? o.label : b.part;
  };

  const SheetEditor = {
    open: false,

    // Pick a file then open the cropper (part = slot set to fill by default)
    pick(part = null) {
      const input = el('input', { type: 'file', accept: 'image/*' });
      input.onchange = () => { if (input.files[0]) this.openFile(input.files[0], part); };
      input.click();
    },

    async openFile(file, part = null) {
      try {
        const url = await PT.Assets.fileToDataURL(file, 4096);
        await this.show({ url, name: file.name.replace(/\.[^.]+$/, ''), part });
      } catch (e) { PT.toast('Could not open sprite sheet: ' + e.message, 'error'); }
    },

    // Open the existing sheet that feeds this part, or ask for a new one
    forPart(part) {
      const sheet = (PT.App.project.sheets || []).find((s) => s.boxes.some((b) => b.part === part));
      if (sheet) this.show({ sheet, part });
      else this.pick(part);
    },

    async show({ sheet, url, name, part }) {
      if (this.open) this.close();
      const s = sheet ? PT.deepClone(sheet) : { id: newId('s'), name: name || 'Sprite sheet', url, w: 0, h: 0, boxes: [] };
      this.img = await PT.loadImage(s.url);
      s.w = this.img.naturalWidth; s.h = this.img.naturalHeight;
      this.sheet = s;
      this.isNew = !sheet;
      this.sel = null;
      this.target = part || '';
      const sizes = new Set(s.boxes.map((b) => b.w + 'x' + b.h));
      this.linked = s.boxes.length > 1 ? sizes.size === 1 : true;
      this.build();
      this.open = true;

      if (!sheet && part) {
        // guess the layout from the sheet's shape: one frame per state, in a row or a column
        const n = PT.PART[part].states.length;
        const vertical = s.h > s.w * 1.4;
        this.grid(vertical ? 1 : n, vertical ? n : 1, part);
      } else if (!sheet) {
        this.autoDetect(Math.round(Math.max(s.w, s.h) * 0.02));
      }
      this.renderList();
      requestAnimationFrame(() => { this.fit(); this.draw(); });
    },

    close() {
      if (!this.open) return;
      this.open = false;
      window.removeEventListener('keydown', this.onKey, true);
      window.removeEventListener('resize', this.onResize);
      this.back.remove();
    },

    /* ---------------- DOM ---------------- */
    build() {
      this.canvas = el('canvas');
      this.wrap = el('div', { class: 'sheet-canvas' }, this.canvas,
        el('div', { class: 'sheet-help' }, 'Drag on empty space to draw a box · drag a box to move · handles resize · wheel zooms · right-drag or Space+drag pans · Delete removes'));
      this.list = el('div', { class: 'box-list' });
      this.targetSel = el('select', {}, el('option', { value: '' }, '— don\'t assign —'),
        ...PT.PARTS.map((d) => el('option', { value: d.id }, (d.group.includes('arm') ? d.group + ': ' : '') + d.label + (d.states.length > 1 ? ` (${d.states.length} frames)` : ''))));
      this.targetSel.value = this.target;
      this.targetSel.onchange = () => { this.target = this.targetSel.value; };

      const n0 = this.target ? PT.PART[this.target].states.length : 3;
      const cols = el('input', { type: 'number', min: 1, max: 32, value: this.sheet.h > this.sheet.w * 1.4 ? 1 : n0 });
      const rows = el('input', { type: 'number', min: 1, max: 32, value: this.sheet.h > this.sheet.w * 1.4 ? n0 : 1 });
      const gap = el('input', { type: 'number', min: 0, max: 400, value: Math.round(Math.max(this.sheet.w, this.sheet.h) * 0.02) });
      const linked = el('input', { type: 'checkbox' });
      linked.checked = this.linked;
      linked.onchange = () => {
        this.linked = linked.checked;
        if (this.linked) this.equalize(this.selBox() || this.sheet.boxes[0]);
        this.refresh();
      };
      this.linkedInput = linked;

      const side = el('div', { class: 'sheet-side' },
        el('div', { class: 'section' }, el('h3', {}, 'Split into a grid'),
          el('div', { class: 'grid-row' }, el('label', {}, 'Columns'), cols, el('label', {}, 'Rows'), rows),
          el('div', { class: 'field-inline' }, el('label', {}, 'Assign in order to'), this.targetSel),
          el('button', { class: 'btn', onclick: () => { this.grid(+cols.value || 1, +rows.value || 1, this.target); this.refresh(); } }, 'Split sheet into grid'),
          el('p', { class: 'note' }, 'Equal cells keep animation frames perfectly aligned. Best for eyes and mouths.')),
        el('div', { class: 'section' }, el('h3', {}, 'Find sprites automatically'),
          el('div', { class: 'field-inline' }, el('label', {}, 'Join pieces closer than (px)'), gap),
          el('button', { class: 'btn', onclick: () => { this.autoDetect(+gap.value || 0); this.refresh(); } }, 'Detect sprites'),
          el('p', { class: 'note' }, 'Boxes each separate drawing on a transparent sheet. Raise the number if a pair of eyes gets split in two.')),
        el('div', { class: 'section' },
          el('div', { class: 'title-row' }, el('h3', {}, 'Crop boxes'),
            el('button', { class: 'btn small', onclick: () => { this.addBox(); this.refresh(); } }, '+ Add box')),
          el('label', { class: 'check' }, linked, 'Keep all boxes the same size (frames stay aligned)'),
          this.list),
      );

      const name = el('input', { class: 'sheet-name', value: this.sheet.name, title: 'Sheet name' });
      name.oninput = () => { this.sheet.name = name.value; };

      this.back = el('div', { class: 'modal-back' },
        el('div', { class: 'modal sheet-modal', role: 'dialog', 'aria-label': 'Sprite sheet' },
          el('header', { class: 'modal-head' },
            el('h2', {}, 'Sprite sheet'), name,
            el('span', { class: 'part-sub' }, `${this.sheet.w} × ${this.sheet.h}px`),
            el('button', { class: 'icon-btn close', title: 'Close', onclick: () => this.close() }, '✕')),
          el('div', { class: 'modal-body' }, this.wrap, side),
          el('footer', { class: 'modal-foot' },
            el('span', { class: 'note', id: 'sheetStatus' }),
            el('button', { class: 'btn ghost', onclick: () => this.close() }, 'Cancel'),
            el('button', { class: 'btn primary', onclick: () => this.apply() }, 'Crop into rig'))));
      document.body.append(this.back);

      this.onKey = (e) => this.key(e);
      this.onResize = () => this.draw();
      window.addEventListener('keydown', this.onKey, true);
      window.addEventListener('resize', this.onResize);
      this.canvas.addEventListener('pointerdown', (e) => this.down(e));
      this.canvas.addEventListener('pointermove', (e) => this.move(e));
      this.canvas.addEventListener('pointerup', (e) => this.up(e));
      this.canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
      this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      this.renderList();
    },

    refresh() { this.renderList(); this.draw(); },

    renderList() {
      const opts = slotOptions();
      this.list.innerHTML = '';
      this.syncers = [];
      const boxes = this.sheet.boxes;
      if (!boxes.length) this.list.append(el('p', { class: 'note' }, 'No boxes yet. Split, detect, or draw one on the sheet.'));
      boxes.forEach((b, i) => {
        const sel = el('select', {}, ...opts.map((o) => el('option', { value: o.v }, o.label)));
        sel.value = b.part ? b.part + '|' + b.state : '';
        sel.onchange = () => {
          const [part, state] = sel.value ? sel.value.split('|') : [null, null];
          // a slot can only be fed by one box
          if (part) for (const o of boxes) if (o !== b && o.part === part && o.state === state) { o.part = null; o.state = null; }
          b.part = part; b.state = state;
          this.refresh();
        };
        const num = (k) => {
          const inp = el('input', { type: 'number', value: b[k], title: k });
          inp.onchange = () => {
            b[k] = Math.round(+inp.value || 0);
            if (k === 'w' || k === 'h') { b[k] = Math.max(2, b[k]); if (this.linked) this.equalize(b); }
            this.clampBox(b);
            this.refresh();
          };
          this.syncers.push(() => { if (document.activeElement !== inp) inp.value = b[k]; });
          return el('label', {}, k.toUpperCase(), inp);
        };
        const item = el('div', {
          class: 'box-item' + (this.sel === b.id ? ' selected' : ''),
          onclick: (e) => { if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT') { this.sel = b.id; this.refresh(); } },
        },
          el('div', { class: 'box-top' },
            el('span', { class: 'box-num', style: { background: COLORS[i % COLORS.length] } }, i + 1), sel,
            el('button', { class: 'icon-btn', title: 'Delete box', onclick: (e) => { e.stopPropagation(); this.remove(b.id); } }, '🗑')),
          el('div', { class: 'box-nums' }, num('x'), num('y'), num('w'), num('h')));
        this.list.append(item);
        if (this.sel === b.id) requestAnimationFrame(() => item.scrollIntoView({ block: 'nearest' }));
      });
      const used = boxes.filter((b) => b.part).length;
      const st = document.getElementById('sheetStatus');
      if (st) st.textContent = `${boxes.length} box${boxes.length === 1 ? '' : 'es'}, ${used} assigned`;
    },

    syncList() { (this.syncers || []).forEach((f) => f()); },

    /* ---------------- box operations ---------------- */
    selBox() { return this.sheet.boxes.find((b) => b.id === this.sel) || null; },

    clampBox(b) {
      const { w, h } = this.sheet;
      b.w = clamp(Math.round(b.w), 2, w); b.h = clamp(Math.round(b.h), 2, h);
      b.x = clamp(Math.round(b.x), 0, w - b.w); b.y = clamp(Math.round(b.y), 0, h - b.h);
    },

    equalize(src) {
      if (!src) return;
      for (const b of this.sheet.boxes) if (b !== src) { b.w = src.w; b.h = src.h; this.clampBox(b); }
    },

    addBox(cx, cy) {
      const s = this.sheet, ref = this.selBox() || s.boxes[s.boxes.length - 1];
      const w = ref ? ref.w : Math.round(s.w / 3), h = ref ? ref.h : Math.round(s.h / 3);
      const b = { id: newId('b'), part: null, state: null, w, h,
        x: cx !== undefined ? cx - w / 2 : (ref ? ref.x + 12 : 0), y: cy !== undefined ? cy - h / 2 : (ref ? ref.y + 12 : 0) };
      this.clampBox(b);
      s.boxes.push(b);
      this.sel = b.id;
      return b;
    },

    remove(id) {
      this.sheet.boxes = this.sheet.boxes.filter((b) => b.id !== id);
      if (this.sel === id) this.sel = null;
      this.refresh();
    },

    grid(cols, rows, part) {
      const s = this.sheet, cw = s.w / cols, ch = s.h / rows;
      const states = part ? PT.PART[part].states : [];
      s.boxes = [];
      let i = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++, i++) {
          const b = { id: newId('b'), x: Math.round(c * cw), y: Math.round(r * ch), w: Math.floor(cw), h: Math.floor(ch), part: null, state: null };
          if (part && i < states.length) { b.part = part; b.state = states[i]; }
          s.boxes.push(b);
        }
      }
      this.sel = s.boxes[0] ? s.boxes[0].id : null;
      this.linked = true;
      if (this.linkedInput) this.linkedInput.checked = true;
    },

    // Connected opaque regions -> boxes (pieces closer than `gap` px are merged)
    autoDetect(gap) {
      const s = this.sheet;
      const K = Math.min(1, 640 / Math.max(s.w, s.h));
      const mw = Math.max(1, Math.round(s.w * K)), mh = Math.max(1, Math.round(s.h * K));
      const c = el('canvas', { width: mw, height: mh });
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(this.img, 0, 0, mw, mh);
      const data = ctx.getImageData(0, 0, mw, mh).data;
      const solid = new Uint8Array(mw * mh);
      let count = 0;
      for (let i = 0; i < mw * mh; i++) if (data[i * 4 + 3] > 16) { solid[i] = 1; count++; }
      if (count > mw * mh * 0.92) {
        PT.toast('This sheet has no transparent background, so sprites can\'t be found automatically. Use the grid or draw boxes.', 'warn', 6000);
        return;
      }
      // dilate so nearby pieces join
      const r = Math.max(0, Math.round((gap * K) / 2));
      let grown = solid;
      if (r > 0) {
        const tmp = new Uint8Array(mw * mh); grown = new Uint8Array(mw * mh);
        for (let y = 0; y < mh; y++) {
          let run = -1e9;
          for (let x = 0; x < mw; x++) { if (solid[y * mw + x]) run = x; if (x - run <= r) tmp[y * mw + x] = 1; }
          run = 1e9;
          for (let x = mw - 1; x >= 0; x--) { if (solid[y * mw + x]) run = x; if (run - x <= r) tmp[y * mw + x] = 1; }
        }
        for (let x = 0; x < mw; x++) {
          let run = -1e9;
          for (let y = 0; y < mh; y++) { if (tmp[y * mw + x]) run = y; if (y - run <= r) grown[y * mw + x] = 1; }
          run = 1e9;
          for (let y = mh - 1; y >= 0; y--) { if (tmp[y * mw + x]) run = y; if (run - y <= r) grown[y * mw + x] = 1; }
        }
      }
      // label components, bbox over the original (undilated) pixels
      const label = new Int32Array(mw * mh);
      const found = [];
      const stack = [];
      let next = 1;
      for (let i = 0; i < mw * mh; i++) {
        if (!grown[i] || label[i]) continue;
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, px = 0;
        label[i] = next; stack.push(i);
        while (stack.length) {
          const j = stack.pop(), x = j % mw, y = (j / mw) | 0;
          if (solid[j]) { px++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          const nb = [x > 0 ? j - 1 : -1, x < mw - 1 ? j + 1 : -1, y > 0 ? j - mw : -1, y < mh - 1 ? j + mw : -1];
          for (const k of nb) if (k >= 0 && grown[k] && !label[k]) { label[k] = next; stack.push(k); }
        }
        next++;
        if (px >= 6 && x1 >= 0) found.push({ x0, y0, x1, y1 });
      }
      if (!found.length) { PT.toast('No sprites found on this sheet.', 'warn'); return; }
      const pad = 2;
      const boxes = found.map((f) => {
        const b = { id: newId('b'), part: null, state: null,
          x: Math.floor(f.x0 / K) - pad, y: Math.floor(f.y0 / K) - pad,
          w: Math.ceil((f.x1 - f.x0 + 1) / K) + pad * 2, h: Math.ceil((f.y1 - f.y0 + 1) / K) + pad * 2 };
        this.clampBox(b);
        return b;
      });
      // reading order: rows top to bottom, then left to right
      const band = Math.max(1, s.h * 0.08);
      boxes.sort((a, b) => Math.round((a.y + a.h / 2) / band) - Math.round((b.y + b.h / 2) / band) || a.x - b.x);
      s.boxes = boxes;
      this.sel = boxes[0].id;
      this.linked = false;
      if (this.linkedInput) this.linkedInput.checked = false;
      // pre-assign if a part was chosen and the count fits
      if (this.target) {
        const states = PT.PART[this.target].states;
        boxes.slice(0, states.length).forEach((b, i) => { b.part = this.target; b.state = states[i]; });
      }
      PT.toast(`Found ${boxes.length} sprite${boxes.length === 1 ? '' : 's'}.`);
    },

    /* ---------------- view ---------------- */
    fit() {
      const r = this.wrap.getBoundingClientRect(), pad = 24;
      this.k = Math.min((r.width - pad * 2) / this.sheet.w, (r.height - pad * 2) / this.sheet.h);
      this.ox = (r.width - this.sheet.w * this.k) / 2;
      this.oy = (r.height - this.sheet.h * this.k) / 2;
    },
    toSheet(e) {
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      return { sx: x, sy: y, x: (x - this.ox) / this.k, y: (y - this.oy) / this.k };
    },
    toScreen(x, y) { return [x * this.k + this.ox, y * this.k + this.oy]; },

    handlesOf(b) {
      const [x0, y0] = this.toScreen(b.x, b.y), [x1, y1] = this.toScreen(b.x + b.w, b.y + b.h);
      const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
      return { nw: [x0, y0], n: [xm, y0], ne: [x1, y0], e: [x1, ym], se: [x1, y1], s: [xm, y1], sw: [x0, y1], w: [x0, ym] };
    },

    draw() {
      if (!this.open && !this.canvas) return;
      const c = this.canvas, dpr = window.devicePixelRatio || 1, r = this.wrap.getBoundingClientRect();
      const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const ctx = c.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // checkerboard behind the sheet
      const [sx0, sy0] = this.toScreen(0, 0), sw = this.sheet.w * this.k, sh = this.sheet.h * this.k;
      if (!this.checker) {
        const p = el('canvas', { width: 16, height: 16 }), g = p.getContext('2d');
        g.fillStyle = '#2a2638'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#211e2d'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
        this.checker = ctx.createPattern(p, 'repeat');
      }
      ctx.fillStyle = this.checker; ctx.fillRect(sx0, sy0, sw, sh);
      ctx.imageSmoothingEnabled = this.k < 2;
      ctx.drawImage(this.img, sx0, sy0, sw, sh);
      ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1; ctx.strokeRect(sx0 - 0.5, sy0 - 0.5, sw + 1, sh + 1);

      ctx.font = '600 12px system-ui, sans-serif';
      this.sheet.boxes.forEach((b, i) => {
        const col = COLORS[i % COLORS.length], selected = b.id === this.sel;
        const [x0, y0] = this.toScreen(b.x, b.y), w = b.w * this.k, h = b.h * this.k;
        ctx.fillStyle = col + (selected ? '2e' : '18'); ctx.fillRect(x0, y0, w, h);
        ctx.strokeStyle = col; ctx.lineWidth = selected ? 2.5 : 1.5;
        ctx.setLineDash(b.part ? [] : [6, 4]);
        ctx.strokeRect(x0, y0, w, h);
        ctx.setLineDash([]);
        const text = `${i + 1}  ${slotLabel(b)}`;
        const tw = ctx.measureText(text).width + 10;
        ctx.fillStyle = col; ctx.fillRect(x0, y0 - 18, tw, 18);
        ctx.fillStyle = '#14121c'; ctx.fillText(text, x0 + 5, y0 - 5);
        if (selected) {
          ctx.fillStyle = '#fff'; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
          for (const [hx, hy] of Object.values(this.handlesOf(b))) {
            ctx.fillRect(hx - HANDLE / 2 - 1, hy - HANDLE / 2 - 1, HANDLE + 2, HANDLE + 2);
            ctx.strokeRect(hx - HANDLE / 2 - 1, hy - HANDLE / 2 - 1, HANDLE + 2, HANDLE + 2);
          }
        }
      });
    },

    /* ---------------- interaction ---------------- */
    down(e) {
      const p = this.toSheet(e);
      this.canvas.setPointerCapture(e.pointerId);
      if (e.button === 1 || e.button === 2 || this.space) {
        this.drag = { kind: 'pan', sx: p.sx, sy: p.sy, ox: this.ox, oy: this.oy };
        return;
      }
      const sel = this.selBox();
      if (sel) {
        for (const [code, [hx, hy]] of Object.entries(this.handlesOf(sel))) {
          if (Math.abs(p.sx - hx) <= HANDLE && Math.abs(p.sy - hy) <= HANDLE) {
            this.drag = { kind: 'resize', code, b: sel, start: p, o: { ...sel } };
            return;
          }
        }
      }
      const boxes = this.sheet.boxes;
      for (let i = boxes.length - 1; i >= 0; i--) {
        const b = boxes[i];
        if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
          if (this.sel !== b.id) { this.sel = b.id; this.renderList(); }
          this.drag = { kind: 'move', b, start: p, o: { ...b } };
          this.draw();
          return;
        }
      }
      if (p.x < 0 || p.y < 0 || p.x > this.sheet.w || p.y > this.sheet.h) { this.sel = null; this.refresh(); return; }
      if (this.linked && boxes.length) {
        // same-size mode: drop a box of the shared size here and move it
        const b = this.addBox(p.x, p.y);
        this.drag = { kind: 'move', b, start: p, o: { ...b } };
      } else {
        const b = { id: newId('b'), part: null, state: null, x: Math.round(p.x), y: Math.round(p.y), w: 2, h: 2 };
        boxes.push(b); this.sel = b.id;
        this.drag = { kind: 'draw', b, start: p };
      }
      this.refresh();
    },

    move(e) {
      const d = this.drag;
      if (!d) {
        const p = this.toSheet(e), sel = this.selBox();
        let cur = this.space ? 'grab' : 'crosshair';
        if (sel) {
          for (const [code, [hx, hy]] of Object.entries(this.handlesOf(sel))) {
            if (Math.abs(p.sx - hx) <= HANDLE && Math.abs(p.sy - hy) <= HANDLE) { cur = (code === 'n' || code === 's') ? 'ns-resize' : (code === 'e' || code === 'w') ? 'ew-resize' : (code === 'nw' || code === 'se') ? 'nwse-resize' : 'nesw-resize'; break; }
          }
        }
        if (cur === 'crosshair' && this.sheet.boxes.some((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)) cur = 'move';
        this.canvas.style.cursor = cur;
        return;
      }
      const p = this.toSheet(e);
      if (d.kind === 'pan') { this.ox = d.ox + p.sx - d.sx; this.oy = d.oy + p.sy - d.sy; this.draw(); return; }
      const dx = p.x - d.start.x, dy = p.y - d.start.y, b = d.b;
      if (d.kind === 'move') {
        b.x = d.o.x + dx; b.y = d.o.y + dy;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) b.y = d.o.y; else b.x = d.o.x; }
      } else if (d.kind === 'draw') {
        b.x = Math.min(d.start.x, p.x); b.y = Math.min(d.start.y, p.y);
        b.w = Math.abs(dx); b.h = Math.abs(dy);
      } else if (d.kind === 'resize') {
        const o = d.o, c = d.code;
        let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
        if (c.includes('w')) x0 = Math.min(x1 - 2, o.x + dx);
        if (c.includes('e')) x1 = Math.max(x0 + 2, o.x + o.w + dx);
        if (c.includes('n')) y0 = Math.min(y1 - 2, o.y + dy);
        if (c.includes('s')) y1 = Math.max(y0 + 2, o.y + o.h + dy);
        b.x = x0; b.y = y0; b.w = x1 - x0; b.h = y1 - y0;
      }
      this.clampBox(b);
      if (this.linked && (d.kind === 'resize' || d.kind === 'draw')) this.equalize(b);
      this.syncList();
      this.draw();
    },

    up() {
      const d = this.drag;
      this.drag = null;
      if (d && d.kind === 'draw' && (d.b.w < 4 || d.b.h < 4)) this.remove(d.b.id);
      else if (d && d.kind !== 'pan') this.refresh();
    },

    wheel(e) {
      e.preventDefault();
      const p = this.toSheet(e), f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const k = clamp(this.k * f, 0.02, 40);
      this.ox = p.sx - (p.sx - this.ox) * (k / this.k);
      this.oy = p.sy - (p.sy - this.oy) * (k / this.k);
      this.k = k;
      this.draw();
    },

    key(e) {
      if (!this.open) return;
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); this.close(); return; }
      if (typing) { e.stopPropagation(); return; }
      e.stopPropagation();   // keep editor shortcuts out while the cropper is open
      if (e.key === ' ') { e.preventDefault(); if (!this.space) { this.space = true; this.canvas.style.cursor = 'grab'; window.addEventListener('keyup', this.spaceUp = (ev) => { if (ev.key === ' ') { this.space = false; window.removeEventListener('keyup', this.spaceUp); } }); } return; }
      const b = this.selBox();
      if (!b) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.remove(b.id); return; }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const s = e.shiftKey ? 10 : 1;
        b.x += e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0;
        b.y += e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0;
        this.clampBox(b); this.syncList(); this.draw();
      }
    },

    /* ---------------- apply ---------------- */
    async apply() {
      const s = this.sheet;
      const jobs = s.boxes.filter((b) => b.part);
      if (!jobs.length) { PT.toast('Assign at least one box to a part first (the dropdown on each box).', 'warn'); return; }
      const project = PT.App.project;
      for (const b of jobs) {
        const c = el('canvas', { width: b.w, height: b.h });
        c.getContext('2d').drawImage(this.img, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
        await PT.Editor.uploadData(b.part, b.state, c.toDataURL('image/png'), { noAlign: true });
      }
      // keep the sheet so the crops can be edited later; a slot belongs to only one sheet
      project.sheets = (project.sheets || []).filter((x) => x.id !== s.id);
      for (const other of project.sheets) {
        other.boxes.forEach((ob) => { if (jobs.some((j) => j.part === ob.part && j.state === ob.state)) { ob.part = null; ob.state = null; } });
      }
      project.sheets = project.sheets.filter((x) => x.boxes.some((ob) => ob.part));
      project.sheets.push(PT.deepClone(s));

      const first = jobs[0].part;
      this.close();
      PT.Editor.resetHistory();
      PT.App.select(first);
      PT.App.changed({ structure: true });
      PT.toast(`Cropped ${jobs.length} image${jobs.length === 1 ? '' : 's'} from the sheet. Use "Frame adjust" if a frame needs nudging.`, '', 5000);
    },
  };

  PT.SheetEditor = SheetEditor;
})(window.PT);
