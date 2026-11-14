/* Canvas editing (select / move / pivot / rotate / scale), uploads + auto-placement, mirroring, undo. */
(function (PT) {
  const { M } = PT;
  const PRIORITY = ['torso', 'face', 'neck', 'hairBack', 'hairFront', 'eyes', 'mouth', 'armLUpper', 'armRUpper', 'armLLower', 'armRLower'];

  const Editor = {
    drag: null,
    hover: null,
    undoStack: [], redoStack: [], lastPush: 0,

    get app() { return PT.App; },
    get project() { return PT.App.project; },

    /* ---------------- undo ---------------- */
    snapshot() {
      const p = this.project;
      const parts = {};
      for (const [id, v] of Object.entries(p.parts)) { const { images, ...rest } = v; parts[id] = { ...rest }; }
      return JSON.stringify({ parts, root: p.root, order: p.order });
    },
    restore(json) {
      const s = JSON.parse(json), p = this.project;
      for (const [id, v] of Object.entries(s.parts)) Object.assign(p.parts[id], v);
      p.root = s.root; p.order = s.order;
      this.app.changed({ structure: true });
    },
    pushUndo(force = false) {
      const now = performance.now();
      if (!force && now - this.lastPush < 700) return;   // coalesce slider scrubs
      this.lastPush = now;
      this.undoStack.push(this.snapshot());
      if (this.undoStack.length > 100) this.undoStack.shift();
      this.redoStack = [];
    },
    undo() { if (!this.undoStack.length) return; this.redoStack.push(this.snapshot()); this.restore(this.undoStack.pop()); this.lastPush = 0; },
    redo() { if (!this.redoStack.length) return; this.undoStack.push(this.snapshot()); this.restore(this.redoStack.pop()); this.lastPush = 0; },
    resetHistory() { this.undoStack = []; this.redoStack = []; },

    /* ---------------- hierarchy helpers ---------------- */
    descendants(id) {
      const out = [];
      const walk = (pid) => { for (const d of PT.PARTS) if (d.parent === pid) { out.push(d.id); walk(d.id); } };
      walk(id);
      return out;
    },

    /* ---------------- uploads ---------------- */
    pivotFromBBox(bb, kind) {
      const cx = bb.x + bb.w / 2;
      switch (kind) {
        case 'bottom': return [cx, bb.y + bb.h * 0.97];
        case 'top': return [cx, bb.y + bb.h * 0.06];
        case 'shoulder': return [cx, bb.y + Math.min(bb.w, bb.h) * 0.42];
        default: return [cx, bb.y + bb.h / 2];
      }
    },

    primaryState(id) {
      const set = PT.Assets.user[id];
      if (!set) return null;
      return PT.PART[id].states.find((s) => set[s]) || null;
    },

    // Place a part's first uploaded image. If its pixel size matches another uploaded part,
    // assume both were exported from the same canvas and line them up exactly.
    autoPlace(id, entry, noAlign = false) {
      const p = this.project.parts[id], def = PT.PART[id], L = PT.LAYOUT[id];
      const [px, py] = this.pivotFromBBox(entry.bbox, def.pivot);
      for (const rid of noAlign ? [] : PRIORITY) {
        if (rid === id || !PT.Assets.hasUser(rid)) continue;
        const e = PT.Assets.primary(rid, false);
        if (e && e.w === entry.w && e.h === entry.h) {
          const rp = this.project.parts[rid];
          const rest = PT.Renderer.restMatrix(rp);
          Object.assign(p, { rot: rp.rot, scale: rp.scale, flip: rp.flip, px, py });
          [p.x, p.y] = M.apply(rest, px, py);
          return 'aligned';
        }
      }
      // otherwise: scale to fit the default slot, keep the joint where it was
      Object.assign(p, { scale: Math.min(L.w / entry.bbox.w, L.h / entry.bbox.h), rot: 0, flip: false, px, py });
      return 'fitted';
    },

    async uploadOne(id, state, file) {
      return this.uploadData(id, state, await PT.Assets.fileToDataURL(file));
    },

    // noAlign: image came from a sprite sheet crop, so equal sizes don't mean "same canvas"
    async uploadData(id, state, url, { noAlign = false } = {}) {
      const p = this.project.parts[id];
      const hadUser = PT.Assets.hasUser(id);
      const oldPrimState = this.primaryState(id);
      const oldPrim = hadUser ? PT.Assets.primary(id, false) : null;
      const entry = await PT.Assets.load(id, state, url);
      p.images[state] = url;
      const newPrim = PT.Assets.primary(id, false);

      if (!hadUser) return this.autoPlace(id, entry, noAlign);
      if (oldPrimState === state) {
        // replaced the frame-defining image
        if (oldPrim.w !== entry.w || oldPrim.h !== entry.h) return this.autoPlace(id, entry, noAlign);
      } else if (newPrim === entry && oldPrim) {
        // a new image became the primary: keep the old one visually where it was
        p.px += (entry.w - oldPrim.w) / 2;
        p.py += (entry.h - oldPrim.h) / 2;
      }
      return 'added';
    },

    clearSlot(id, state) {
      const p = this.project.parts[id];
      const oldPrimState = this.primaryState(id);
      const oldPrim = PT.Assets.primary(id, false);
      PT.Assets.remove(id, state);
      delete p.images[state];
      if (p.adj) delete p.adj[state];
      if (!PT.Assets.hasUser(id)) {
        const d = PT.defaultPart(id);
        Object.assign(p, { x: d.x, y: d.y, rot: d.rot, scale: d.scale, px: d.px, py: d.py, flip: false });
      } else if (oldPrimState === state) {
        const np = PT.Assets.primary(id, false);
        if (np && oldPrim) { p.px -= (oldPrim.w - np.w) / 2; p.py -= (oldPrim.h - np.h) / 2; }
      }
      this.resetHistory();
      this.app.changed({ structure: true });
    },

    // files: FileList/array. target: optional {part, state}
    async importFiles(files, target = null) {
      // a Photoshop file: its layers are the parts (see psd.js)
      const psd = Array.from(files).find((f) => /\.psd$/i.test(f.name));
      if (psd) return PT.Psd.open(psd);
      files = Array.from(files).filter((f) => /^image\//.test(f.type) || /\.(png|webp|gif|jpe?g)$/i.test(f.name));
      // files named like "eyes_sheet.png" / "mouth-sprites.png" open the sprite sheet cropper
      const sheets = files.filter((f) => /sheet|sprite|atlas/i.test(f.name));
      if (sheets.length) {
        files = files.filter((f) => !sheets.includes(f));
        const r = PT.routeFilename(sheets[0].name.replace(/sheet|sprites?|atlas/gi, ''));
        PT.SheetEditor.openFile(sheets[0], (target && target.part) || r.part || null);
        if (!files.length) return;
      }
      if (!files.length) { PT.toast('No image files found.', 'warn'); return; }

      const jobs = [], unmatched = [];
      if (target && target.part) {
        const def = PT.PART[target.part];
        if (target.state && files.length === 1) jobs.push({ part: target.part, state: target.state, file: files[0] });
        else {
          const free = def.states.filter((s) => !PT.Assets.user[target.part] || !PT.Assets.user[target.part][s]);
          const used = new Set();
          for (const f of files) {
            let st = null;
            if (def.states.length > 1) {
              const r = PT.routeFilename(f.name);
              if (r.part === target.part && !used.has(r.state)) st = r.state;
            }
            if (!st) st = free.find((s) => !used.has(s)) || def.states.find((s) => !used.has(s));
            if (!st) break;
            used.add(st);
            jobs.push({ part: target.part, state: st, file: f });
          }
        }
      } else {
        for (const f of files) {
          const r = PT.routeFilename(f.name);
          if (r.part) jobs.push({ part: r.part, state: r.state, file: f });
          else unmatched.push(f.name + (r.reason ? ` (${r.reason})` : ''));
        }
        jobs.sort((a, b) => PRIORITY.indexOf(a.part) - PRIORITY.indexOf(b.part));
      }

      let aligned = 0, done = 0, last = null;
      for (const j of jobs) {
        try {
          const res = await this.uploadOne(j.part, j.state, j.file);
          if (res === 'aligned') aligned++;
          done++; last = j.part;
        } catch (e) {
          PT.toast(`Could not load ${j.file.name}: ${e.message}`, 'error');
        }
      }
      this.resetHistory();
      if (last) this.app.select(last);
      this.app.changed({ structure: true });

      if (done) {
        let msg = `Added ${done} image${done > 1 ? 's' : ''}.`;
        if (aligned) msg += ` ${aligned} lined up automatically (same canvas size).`;
        PT.toast(msg);
      }
      if (unmatched.length) {
        PT.toast(`Couldn't tell which part these are, drop them on a part instead: ${unmatched.join(', ')}`, 'warn', 7000);
      }
    },

    /* ---------------- mirroring ---------------- */
    async mirrorArm(id) {
      const side = id.startsWith('armL') ? 'L' : 'R', other = side === 'L' ? 'R' : 'L';
      this.pushUndo(true);
      for (const seg of ['Upper', 'Lower']) {
        const src = 'arm' + side + seg, dst = 'arm' + other + seg;
        const a = this.project.parts[src], b = this.project.parts[dst];
        for (const st of Object.keys(b.images)) PT.Assets.remove(dst, st);
        b.images = { ...a.images };
        b.adj = PT.deepClone(a.adj || {});   // image-space offsets: the flip mirrors them already
        for (const [st, url] of Object.entries(b.images)) await PT.Assets.load(dst, st, url);
        Object.assign(b, {
          x: PT.CHAR_W - a.x, y: a.y, rot: -a.rot, scale: a.scale, px: a.px, py: a.py,
          flip: PT.Assets.hasUser(dst) ? !a.flip : false, visible: a.visible,
        });
        if (!PT.Assets.hasUser(dst)) { const d = PT.defaultPart(dst); Object.assign(b, { px: d.px, py: d.py }); }
      }
      this.resetHistory();
      this.app.changed({ structure: true });
      PT.toast(`Mirrored the ${side === 'L' ? 'left' : 'right'} arm onto the ${other === 'L' ? 'left' : 'right'} side.`);
    },

    /* ---------------- canvas interaction ---------------- */
    attach(canvas) {
      this.canvas = canvas;
      canvas.addEventListener('pointerdown', (e) => this.onDown(e));
      canvas.addEventListener('pointermove', (e) => this.onMove(e));
      window.addEventListener('pointerup', (e) => this.onUp(e));
      canvas.addEventListener('pointerleave', () => { if (!this.drag) this.hover = null; });
      canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      canvas.addEventListener('dblclick', () => { if (this.app.mode === 'edit' && !this.hover) this.app.select('root'); });
    },

    canvasPoint(e) {
      const r = this.canvas.getBoundingClientRect(), dpr = this.app.renderer.dpr;
      return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
    },

    // On-screen handle positions for the selected part
    handles(pose) {
      const id = this.app.selected;
      if (!id || id === 'root' || !pose[id]) return null;
      const entry = PT.Assets.primary(id, this.project.stage.placeholders);
      if (!entry) return null;
      const p = this.project.parts[id], m = pose[id].world, bb = entry.bbox, dpr = this.app.renderer.dpr;
      const corners = [[bb.x, bb.y], [bb.x + bb.w, bb.y], [bb.x + bb.w, bb.y + bb.h], [bb.x, bb.y + bb.h]].map(([x, y]) => M.apply(m, x, y));
      const pivot = M.apply(pose.base, p.x, p.y);
      const top = M.apply(m, bb.x + bb.w / 2, bb.y);
      let [ux, uy] = M.applyVec(m, 0, -1);
      const len = Math.hypot(ux, uy) || 1; ux /= len; uy /= len;
      const rotate = [top[0] + ux * 30 * dpr, top[1] + uy * 30 * dpr];
      return { corners, pivot, top, rotate, scale: corners[2] };
    },

    onDown(e) {
      const app = this.app;
      if (app.mode !== 'edit' || e.button !== 0) return;
      this.canvas.setPointerCapture(e.pointerId);
      const pt = this.canvasPoint(e), dpr = app.renderer.dpr, R = 11 * dpr;
      const pose = app.lastPose;
      const near = (a) => a && Math.hypot(a[0] - pt[0], a[1] - pt[1]) < R;
      const h = this.handles(pose);
      const id = app.selected;

      if (h && near(h.pivot)) return this.startDrag('pivot', pt, pose);
      if (h && near(h.rotate)) return this.startDrag('rotate', pt, pose);
      if (h && near(h.scale)) return this.startDrag('scale', pt, pose);

      const hit = app.renderer.hitTest(this.project, pose, app.previewStates, pt[0], pt[1]);
      if (id === 'root' && (hit || e.altKey)) return this.startDrag('root', pt, pose);
      if (e.altKey) { app.select('root'); return this.startDrag('root', pt, pose); }
      if (hit) {
        if (hit !== id) app.select(hit);
        return this.startDrag('move', pt, pose);
      }
      app.select(null);
    },

    startDrag(kind, pt, pose) {
      this.pushUndo(true);
      const id = this.app.selected, p = this.project.parts[id];
      const toChar = M.inv(pose.base), toStage = M.inv(this.app.renderer.view());
      const d = { kind, id, start: pt, toChar, toStage, pose };
      if (kind === 'move') {
        const ids = [id, ...(this.project.stage.moveChildren ? this.descendants(id) : [])];
        d.ids = ids.map((i) => [i, this.project.parts[i].x, this.project.parts[i].y]);
        d.c0 = M.apply(toChar, ...pt);
      } else if (kind === 'root') {
        d.r0 = { ...this.project.root };
        d.s0 = M.apply(toStage, ...pt);
      } else {
        const pv = M.apply(pose.base, p.x, p.y);
        d.pv = pv;
        d.rot0 = p.rot; d.scale0 = p.scale;
        d.a0 = Math.atan2(pt[1] - pv[1], pt[0] - pv[0]);
        d.r0 = Math.hypot(pt[0] - pv[0], pt[1] - pv[1]) || 1;
      }
      this.drag = d;
    },

    onMove(e) {
      const app = this.app;
      if (app.mode !== 'edit') { this.canvas.style.cursor = 'default'; return; }
      const pt = this.canvasPoint(e);
      const d = this.drag;
      if (!d) {
        const pose = app.lastPose; if (!pose) return;
        const h = this.handles(pose), R = 11 * app.renderer.dpr;
        const near = (a) => a && Math.hypot(a[0] - pt[0], a[1] - pt[1]) < R;
        this.hover = app.renderer.hitTest(this.project, pose, app.previewStates, pt[0], pt[1]);
        this.canvas.style.cursor = h && near(h.pivot) ? 'crosshair'
          : h && near(h.rotate) ? 'grab'
          : h && near(h.scale) ? 'nwse-resize'
          : this.hover ? 'move' : 'default';
        return;
      }
      const p = this.project.parts[d.id];
      if (d.kind === 'move') {
        const c = M.apply(d.toChar, ...pt);
        let dx = c[0] - d.c0[0], dy = c[1] - d.c0[1];
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        for (const [i, x, y] of d.ids) { this.project.parts[i].x = x + dx; this.project.parts[i].y = y + dy; }
      } else if (d.kind === 'root') {
        const s = M.apply(d.toStage, ...pt);
        this.project.root.x = d.r0.x + s[0] - d.s0[0];
        this.project.root.y = d.r0.y + s[1] - d.s0[1];
      } else if (d.kind === 'pivot') {
        // move the pivot but keep the image where it is
        const [u, v] = M.apply(M.inv(d.pose[d.id].world), ...pt);
        const [cx, cy] = M.apply(d.toChar, ...pt);
        p.px = u; p.py = v; p.x = cx; p.y = cy;
      } else if (d.kind === 'rotate') {
        const a = Math.atan2(pt[1] - d.pv[1], pt[0] - d.pv[0]);
        let r = d.rot0 + (a - d.a0) / PT.DEG;
        if (e.shiftKey) r = Math.round(r / 15) * 15;
        p.rot = Math.round(r * 10) / 10;
      } else if (d.kind === 'scale') {
        const r = Math.hypot(pt[0] - d.pv[0], pt[1] - d.pv[1]);
        p.scale = PT.clamp(d.scale0 * r / d.r0, 0.01, 20);
      }
      app.changed({ transform: true });
    },

    onUp() {
      if (this.drag) { this.drag = null; this.app.changed({ transform: true, commit: true }); }
    },

    onWheel(e) {
      const app = this.app;
      if (app.mode !== 'edit' || !app.selected) return;
      e.preventDefault();
      this.pushUndo();
      const up = e.deltaY < 0;
      if (app.selected === 'root') {
        this.project.root.scale = PT.clamp(this.project.root.scale * (up ? 1.04 : 1 / 1.04), 0.05, 10);
      } else {
        const p = this.project.parts[app.selected];
        if (e.shiftKey || e.altKey) p.rot = Math.round((p.rot + (up ? -2 : 2)) * 10) / 10;
        else p.scale = PT.clamp(p.scale * (up ? 1.04 : 1 / 1.04), 0.01, 20);
      }
      app.changed({ transform: true, commit: true });
    },

    nudge(dx, dy) {
      const app = this.app;
      if (!app.selected) return;
      this.pushUndo();
      if (app.selected === 'root') { this.project.root.x += dx; this.project.root.y += dy; }
      else {
        const ids = [app.selected, ...(this.project.stage.moveChildren ? this.descendants(app.selected) : [])];
        for (const i of ids) { this.project.parts[i].x += dx; this.project.parts[i].y += dy; }
      }
      app.changed({ transform: true, commit: true });
    },

    /* ---------------- overlay ---------------- */
    drawOverlay(pose) {
      const app = this.app, ctx = app.renderer.ctx, dpr = app.renderer.dpr, proj = this.project;
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      // skeleton: bones between joints
      if (proj.stage.skeleton) {
        ctx.lineWidth = 2 * dpr;
        for (const def of PT.PARTS) {
          const p = proj.parts[def.id];
          if (!p.visible) continue;
          const j = M.apply(pose.base, p.x, p.y);
          if (def.parent) {
            const pp = proj.parts[def.parent];
            const pj = M.apply(pose.base, pp.x, pp.y);
            ctx.strokeStyle = 'rgba(139,123,255,.45)';
            ctx.beginPath(); ctx.moveTo(pj[0], pj[1]); ctx.lineTo(j[0], j[1]); ctx.stroke();
          }
          ctx.fillStyle = 'rgba(179,168,255,.8)';
          ctx.beginPath(); ctx.arc(j[0], j[1], 3.2 * dpr, 0, Math.PI * 2); ctx.fill();
        }
      }

      // hover outline
      if (this.hover && this.hover !== app.selected && !this.drag) this.outline(pose, this.hover, 'rgba(255,255,255,.35)', [4, 4]);

      const h = this.handles(pose);
      if (!h) return;
      this.outline(pose, app.selected, '#8b7bff', [6, 4]);
      // rotate handle
      ctx.strokeStyle = '#8b7bff'; ctx.lineWidth = 1.5 * dpr; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(h.top[0], h.top[1]); ctx.lineTo(h.rotate[0], h.rotate[1]); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(h.rotate[0], h.rotate[1], 6 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // scale handle
      const s = 6 * dpr;
      ctx.fillRect(h.scale[0] - s, h.scale[1] - s, s * 2, s * 2); ctx.strokeRect(h.scale[0] - s, h.scale[1] - s, s * 2, s * 2);
      // pivot / joint
      const [x, y] = h.pivot, r = 8 * dpr;
      ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r * 1.6, y); ctx.lineTo(x + r * 1.6, y); ctx.moveTo(x, y - r * 1.6); ctx.lineTo(x, y + r * 1.6); ctx.stroke();
    },

    outline(pose, id, color, dash) {
      const entry = PT.Assets.primary(id, this.project.stage.placeholders);
      if (!entry || !pose[id]) return;
      const ctx = this.app.renderer.ctx, dpr = this.app.renderer.dpr, bb = entry.bbox, m = pose[id].world;
      const pts = [[bb.x, bb.y], [bb.x + bb.w, bb.y], [bb.x + bb.w, bb.y + bb.h], [bb.x, bb.y + bb.h]].map(([x, y]) => M.apply(m, x, y));
      ctx.strokeStyle = color; ctx.lineWidth = 1.5 * dpr; ctx.setLineDash(dash.map((v) => v * dpr));
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]);
    },
  };

  PT.Editor = Editor;
})(window.PT);
