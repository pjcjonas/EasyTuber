/* Side panels: part list, part inspector, motion / mic / stage settings. */
(function (PT) {
  const { el } = PT;

  const Panels = {
    syncers: [],
    get app() { return PT.App; },
    get project() { return PT.App.project; },

    init() {
      if (!this.tabsBound) {
        this.tabsBound = true;
        document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => this.showTab(b.dataset.tab)));
      }
      this.renderPartList();
      this.renderInspector();
      this.renderMotion();
      this.renderMic();
      this.renderStageTab();
      this.renderAvatars();
      this.renderActions();
    },

    showTab(name) {
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
      document.querySelectorAll('.tab-body').forEach((d) => (d.hidden = d.id !== 'tab-' + name));
    },

    /* ---------- generic controls ---------- */
    field(label, { min, max, step = 1, get, set, suffix = '', title }) {
      const range = el('input', { type: 'range', min, max, step });
      const num = el('input', { type: 'number', step });
      const sync = () => { const v = get(); range.value = v; if (document.activeElement !== num) num.value = +(+v).toFixed(step < 1 ? 2 : 0); };
      const apply = (v) => {
        v = parseFloat(v);
        if (!isFinite(v)) return;
        set(v);
        sync();
      };
      range.addEventListener('input', () => apply(range.value));
      num.addEventListener('change', () => apply(num.value));
      sync();
      this.syncers.push(sync);
      return el('div', { class: 'field', title }, el('label', {}, label + (suffix ? ` (${suffix})` : '')), range, num);
    },

    check(label, get, set, title) {
      const input = el('input', { type: 'checkbox' });
      input.checked = !!get();
      input.addEventListener('change', () => set(input.checked));
      this.syncers.push(() => { input.checked = !!get(); });
      return el('label', { class: 'check', title }, input, label);
    },

    section(title, ...children) { return el('div', { class: 'section' }, title ? el('h3', {}, title) : null, ...children); },
    note(text) { return el('p', { class: 'note' }, text); },

    makeDroppable(node, onFiles) {
      node.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); node.classList.add('over'); });
      node.addEventListener('dragleave', () => node.classList.remove('over'));
      node.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation(); node.classList.remove('over');
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
      });
    },

    pickFiles(target) {
      const input = document.getElementById('slotInput');
      input.multiple = !target.state;
      input.onchange = () => { if (input.files.length) PT.Editor.importFiles(input.files, target); input.value = ''; };
      input.click();
    },

    thumbFor(id) {
      const entry = PT.Assets.primary(id, true);
      const t = el('div', { class: 'thumb' + (entry && entry.isPlaceholder ? ' placeholder' : '') });
      if (entry) t.append(PT.Assets.thumb(entry, 80));
      return t;
    },

    /* ---------- left: part list ---------- */
    renderPartList() {
      const host = document.getElementById('partList');
      host.innerHTML = '';
      const app = this.app;

      const rootRow = el('div', { class: 'part-row' + (app.selected === 'root' ? ' selected' : ''), onclick: () => app.select('root') },
        el('div', { class: 'thumb' }, '🧍'),
        el('div', { class: 'part-meta' }, el('div', { class: 'part-name' }, 'Whole character'), el('div', { class: 'part-sub' }, 'Move / scale everything')));
      host.append(rootRow);

      let group = null;
      for (const def of PT.PARTS) {
        if (def.group !== group) { group = def.group; host.append(el('div', { class: 'group-title' }, group)); }
        const p = this.project.parts[def.id];
        const user = PT.Assets.user[def.id] || {};
        const count = def.states.filter((s) => user[s]).length;
        const sub = count === 0 ? 'empty, using placeholder'
          : def.states.length > 1 ? `${count}/${def.states.length} images` : 'uploaded';

        const eye = el('button', {
          class: 'icon-btn' + (p.visible ? '' : ' off'), title: p.visible ? 'Hide' : 'Show',
          onclick: (e) => { e.stopPropagation(); PT.Editor.pushUndo(true); p.visible = !p.visible; app.changed({ structure: true }); },
        }, p.visible ? '👁' : '—');

        const row = el('div', {
          class: 'part-row' + (app.selected === def.id ? ' selected' : ''),
          title: 'Click to select. Drop an image here to upload.',
          onclick: () => app.select(def.id),
        },
          this.thumbFor(def.id),
          el('div', { class: 'part-meta' }, el('div', { class: 'part-name' }, def.label), el('div', { class: 'part-sub' + (count ? ' ok' : '') }, sub)),
          eye);
        this.makeDroppable(row, (files) => PT.Editor.importFiles(files, { part: def.id }));
        host.append(row);
      }
    },

    /* ---------- right: Part tab ---------- */
    renderInspector() {
      this.syncers = this.syncers.filter((s) => !s.inspector);
      const host = document.getElementById('tab-part');
      host.innerHTML = '';
      const app = this.app, id = app.selected;
      const before = this.syncers.length;
      const mark = () => { for (let i = before; i < this.syncers.length; i++) this.syncers[i].inspector = true; };

      if (!id) {
        host.append(
          el('div', { class: 'title-row' }, el('h2', {}, 'Getting started')),
          this.section('',
            el('ol', { class: 'help-list' },
              el('li', {}, 'Drop all your layer PNGs on the box at the top left, or drop each one on its part.'),
              el('li', {}, 'Layers exported from the same canvas size line up automatically.'),
              el('li', {}, 'Click a part on the stage to select it. Drag to move, use the square to scale, the circle to rotate.'),
              el('li', {}, 'Drag the orange cross to set the joint (shoulder, elbow, chin…). Parts bend and rotate around it.'),
              el('li', {}, 'Start the mic, then switch to Live to watch it breathe, blink and talk.'),
            )),
          this.section('Shortcuts',
            el('ul', { class: 'help-list' },
              el('li', {}, el('span', { class: 'kbd' }, 'Space'), ' hold to fake talking'),
              el('li', {}, el('span', { class: 'kbd' }, 'B'), ' blink'),
              el('li', {}, el('span', { class: 'kbd' }, 'Arrows'), ' nudge (Shift = 10px)'),
              el('li', {}, el('span', { class: 'kbd' }, 'Wheel'), ' scale, Shift+wheel rotate'),
              el('li', {}, el('span', { class: 'kbd' }, 'Alt+drag'), ' move the whole character'),
              el('li', {}, el('span', { class: 'kbd' }, 'Shift+drag'), ' lock to an axis / snap rotation'),
              el('li', {}, el('span', { class: 'kbd' }, 'Tab'), ' switch Edit / Live'),
              el('li', {}, el('span', { class: 'kbd' }, 'Ctrl+Z'), ' undo'),
            )),
        );
        return;
      }

      if (id === 'root') {
        const r = this.project.root;
        const set = (k) => (v) => { PT.Editor.pushUndo(); r[k] = v; app.changed({ transform: true }); };
        host.append(
          el('div', { class: 'title-row' }, el('h2', {}, 'Whole character')),
          this.note('Moves and scales the full rig inside the stage frame. Scaling happens from the bottom center.'),
          this.section('Transform',
            this.field('X', { min: -800, max: 800, get: () => r.x, set: set('x') }),
            this.field('Y', { min: -800, max: 800, get: () => r.y, set: set('y') }),
            this.field('Scale', { min: 5, max: 300, suffix: '%', get: () => Math.round(r.scale * 100), set: (v) => set('scale')(v / 100) })),
          el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => { PT.Editor.pushUndo(true); Object.assign(r, { x: 0, y: 0, scale: 1 }); app.changed({ transform: true }); } }, 'Reset')),
        );
        mark();
        return;
      }

      const def = PT.PART[id], p = this.project.parts[id];
      const set = (k) => (v) => { PT.Editor.pushUndo(); p[k] = v; app.changed({ transform: true }); };

      // image slots
      const slots = el('div', { class: 'slots' + (def.states.length === 1 ? ' single' : '') });
      for (const st of def.states) {
        const entry = (PT.Assets.user[id] || {})[st];
        const previewing = def.states.length > 1 && (app.previewStates[id] || def.states[0]) === st;
        const slot = el('div', {
          class: 'slot' + (entry ? ' filled' : '') + (previewing ? ' previewing' : ''),
          title: entry ? 'Click to preview this state. Drop or double-click to replace.' : 'Click or drop an image',
          onclick: () => {
            if (def.states.length > 1) { app.previewStates[id] = st; this.renderInspector(); }
            if (!entry) this.pickFiles({ part: id, state: st });
          },
          ondblclick: () => this.pickFiles({ part: id, state: st }),
        },
          el('div', { class: 'slot-img' }, entry ? PT.Assets.thumb(entry, 128) : el('span', { class: 'plus' }, '+')),
          el('div', { class: 'slot-label' }, def.states.length > 1 ? def.stateLabels[st] : 'Image'),
          el('button', { class: 'slot-clear', title: 'Remove', onclick: (e) => { e.stopPropagation(); PT.Editor.clearSlot(id, st); } }, '×'));
        this.makeDroppable(slot, (files) => PT.Editor.importFiles([files[0]], { part: id, state: st }));
        slots.append(slot);
      }

      const order = this.project.order, idx = order.indexOf(id);
      const moveLayer = (dir) => {
        const j = idx + dir;
        if (j < 0 || j >= order.length) return;
        PT.Editor.pushUndo(true);
        [order[idx], order[j]] = [order[j], order[idx]];
        app.changed({ structure: true });
      };

      host.append(
        el('div', { class: 'title-row' }, el('h2', {}, def.label), el('span', { class: 'part-sub' }, def.group)),
        this.note(def.hint),
        this.section('Images', slots,
          def.states.length > 1 ? this.note('Click a filled slot to preview that state on the stage while editing.') : null,
          el('div', { class: 'row', style: { marginTop: '8px' } },
            el('button', {
              class: 'btn', onclick: () => PT.SheetEditor.forPart(id),
              title: def.states.length > 1 ? 'Crop all frames for this part out of one image' : 'Crop this part out of a bigger image',
            }, (this.project.sheets || []).some((s) => s.boxes.some((b) => b.part === id)) ? 'Edit sprite sheet crop…' : 'From sprite sheet…'))),
        this.frameAdjust(id) || '', // native append() would print a null as the text "null"
        this.section('Position',
          this.field('X', { min: -500, max: 1500, get: () => Math.round(p.x), set: set('x'), title: 'Joint position' }),
          this.field('Y', { min: -500, max: 1500, get: () => Math.round(p.y), set: set('y'), title: 'Joint position' }),
          this.field('Scale', { min: 1, max: 400, suffix: '%', get: () => Math.round(p.scale * 1000) / 10, set: (v) => set('scale')(Math.max(0.01, v / 100)), step: 0.5 }),
          this.field('Rotation', { min: -180, max: 180, suffix: '°', get: () => p.rot, set: set('rot'), step: 0.5 }),
          this.check('Flip horizontally', () => p.flip, (v) => { PT.Editor.pushUndo(true); p.flip = v; app.changed({ transform: true }); }),
          this.check('Visible', () => p.visible, (v) => { PT.Editor.pushUndo(true); p.visible = v; app.changed({ structure: true }); })),
        this.section('Joint (pivot)',
          this.note('The point this part rotates around and attaches to its parent with. You can also drag the orange cross.'),
          this.field('Pivot X', { min: -200, max: 2400, get: () => Math.round(p.px), set: (v) => this.setPivot(p, v, p.py) }),
          this.field('Pivot Y', { min: -200, max: 2400, get: () => Math.round(p.py), set: (v) => this.setPivot(p, p.px, v) })),
        this.section('Layer',
          el('div', { class: 'row' },
            el('button', { class: 'btn', onclick: () => moveLayer(-1), disabled: idx === 0 }, '↓ Send back'),
            el('button', { class: 'btn', onclick: () => moveLayer(1), disabled: idx === order.length - 1 }, '↑ Bring forward')),
          this.note(`Layer ${idx + 1} of ${order.length} (1 = furthest back).`)),
        this.section('Tools',
          el('div', { class: 'row' },
            el('button', {
              class: 'btn', title: 'Re-fit the image and recompute the pivot',
              onclick: () => {
                PT.Editor.pushUndo(true);
                const e = PT.Assets.primary(id, false);
                if (e) PT.Editor.autoPlace(id, e);
                else { const d = PT.defaultPart(id); Object.assign(p, { x: d.x, y: d.y, rot: d.rot, scale: d.scale, px: d.px, py: d.py, flip: false }); }
                app.changed({ transform: true });
              },
            }, 'Auto-place'),
            id.startsWith('arm') ? el('button', { class: 'btn', title: 'Copy this arm (both segments) to the other side, mirrored', onclick: () => PT.Editor.mirrorArm(id) }, 'Mirror to other arm') : null)),
      );
      mark();
    },

    sheetList() {
      const sheets = this.project.sheets || [], app = this.app;
      const wrap = el('div', {});
      if (!sheets.length) wrap.append(this.note('None yet. Use "Sprite sheet" in the top bar, or "From sprite sheet…" on a part.'));
      for (const s of sheets) {
        const used = s.boxes.filter((b) => b.part).length;
        wrap.append(el('div', { class: 'sheet-row' },
          el('span', { class: 'sheet-row-name', title: s.name }, s.name),
          el('span', { class: 'part-sub' }, `${used} crop${used === 1 ? '' : 's'}`),
          el('button', { class: 'btn small', onclick: () => PT.SheetEditor.show({ sheet: s }) }, 'Edit'),
          el('button', {
            class: 'icon-btn', title: 'Forget this sheet (cropped images stay)',
            onclick: () => { this.project.sheets = sheets.filter((x) => x !== s); app.changed({ structure: true }); },
          }, '🗑')));
      }
      wrap.append(el('div', { class: 'row', style: { marginTop: '6px' } }, el('button', { class: 'btn', onclick: () => PT.SheetEditor.pick() }, 'Add sprite sheet…')));
      return wrap;
    },

    // Per-frame offset/scale for multi-state parts, so frames from a sheet line up with each other
    frameAdjust(id) {
      const def = PT.PART[id], p = this.project.parts[id], app = this.app;
      if (def.states.length < 2 || !PT.Assets.hasUser(id)) return null;
      const st = app.previewStates[id] || def.states[0];
      const entry = (PT.Assets.user[id] || {})[st];
      if (!entry) {
        return this.section('Frame adjust', this.note(`No "${def.stateLabels[st]}" image yet. Click a filled slot to adjust that frame.`));
      }
      p.adj = p.adj || {};
      const A = () => p.adj[st] || { dx: 0, dy: 0, s: 1 };
      const set = (k) => (v) => { PT.Editor.pushUndo(); p.adj[st] = { ...A(), [k]: v }; app.changed({ transform: true }); };
      const lim = Math.round(Math.max(entry.w, entry.h) / 2);
      return this.section(`Frame adjust: ${def.stateLabels[st]}`,
        this.note('Nudges and scales only this frame, so it lines up with the others. The first frame is shown faintly underneath (onion skin).'),
        this.field('Offset X', { min: -lim, max: lim, get: () => Math.round(A().dx * 10) / 10, set: set('dx'), step: 0.5 }),
        this.field('Offset Y', { min: -lim, max: lim, get: () => Math.round(A().dy * 10) / 10, set: set('dy'), step: 0.5 }),
        this.field('Scale', { min: 25, max: 300, suffix: '%', get: () => Math.round(A().s * 1000) / 10, set: (v) => set('s')(Math.max(0.05, v / 100)), step: 0.5 }),
        el('div', { class: 'row' },
          el('button', { class: 'btn', onclick: () => { PT.Editor.pushUndo(true); delete p.adj[st]; app.changed({ transform: true }); } }, 'Reset this frame'),
          el('button', {
            class: 'btn', title: 'Cycle through the frames to check alignment',
            onclick: () => {
              const have = def.states.filter((s) => PT.Assets.user[id] && PT.Assets.user[id][s]);
              app.previewStates[id] = have[(have.indexOf(st) + 1) % have.length];
              this.renderInspector();
            },
          }, 'Next frame →')));
    },

    setPivot(p, px, py) {
      // keep the image fixed on screen while the pivot moves
      PT.Editor.pushUndo();
      const rest = PT.Renderer.restMatrix(p);
      const [x, y] = PT.M.apply(rest, px, py);
      Object.assign(p, { px, py, x, y });
      this.app.changed({ transform: true });
    },

    syncInspector() { for (const s of this.syncers) s(); },

    /* ---------- Motion tab ---------- */
    renderMotion() {
      const host = document.getElementById('tab-motion');
      const m = this.project.motion, app = this.app;
      const f = (label, key, min, max, step, title, suffix) =>
        this.field(label, { min, max, step, suffix, title, get: () => m[key], set: (v) => { m[key] = v; app.changed({ settings: true }); } });
      host.innerHTML = '';
      host.append(
        this.note('All motion is built in. These sliders only change how strong it is. Switch to Live to see it.'),
        this.section('Breathing',
          f('Speed', 'breathSpeed', 1.5, 9, 0.1, 'Seconds per breath (higher = slower)', 's'),
          f('Amount', 'breathAmount', 0, 3, 0.05),
          f('Idle sway', 'idleSway', 0, 3, 0.05, 'Gentle head and body drift while idle')),
        this.section('Blinking',
          f('Every', 'blinkInterval', 1, 12, 0.1, 'Average seconds between blinks', 's'),
          f('Double blink', 'doubleBlink', 0, 0.8, 0.01, 'Chance of a double blink'),
          el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => app.animator.blink() }, 'Blink now (B)'))),
        this.section('Talking',
          f('Head bob', 'headBob', 0, 3, 0.05, 'Head hops on each syllable'),
          f('Head tilt', 'headTilt', 0, 3, 0.05, 'Head rocks side to side while talking'),
          f('Body bounce', 'bodyBounce', 0, 3, 0.05),
          f('Gestures', 'gesture', 0, 3, 0.05, 'Arms move when you talk')),
        this.section('Secondary motion',
          f('Arm sway', 'armSway', 0, 3, 0.05, 'Idle arm movement'),
          f('Hair physics', 'hairPhysics', 0, 3, 0.05, 'How much the hair swings after the head moves')),
        el('div', { class: 'row' }, el('button', {
          class: 'btn', onclick: () => { Object.assign(m, PT.DEFAULT_MOTION); this.syncInspector(); app.changed({ settings: true }); },
        }, 'Reset motion to defaults')),
      );
    },

    /* ---------- Mic tab ---------- */
    renderMic() {
      const host = document.getElementById('tab-mic');
      const mic = this.project.mic, app = this.app;
      const f = (label, key, min, max, step, title, suffix) =>
        this.field(label, { min, max, step, suffix, title, get: () => mic[key], set: (v) => { mic[key] = v; app.changed({ settings: true }); } });

      const select = el('select', { id: 'micSelect' }, el('option', { value: '' }, 'Default microphone'));
      select.addEventListener('change', async () => {
        mic.deviceId = select.value; app.changed({ settings: true });
        if (PT.Audio.running) app.startMic();
      });
      this.micSelect = select;

      const tuneBtn = el('button', { class: 'btn', onclick: () => this.tune(tuneBtn) }, 'Tune to my voice');

      host.innerHTML = '';
      host.append(
        this.section('Input', select,
          el('div', { class: 'row', style: { marginTop: '8px' } },
            el('button', { class: 'btn', id: 'btnMic2', onclick: () => app.toggleMic() }, 'Start / stop mic'), tuneBtn)),
        this.section('Sensitivity',
          f('Sensitivity', 'sensitivity', 0, 100, 1, 'Boosts or lowers the input level'),
          f('Talk at', 'talk', 0.02, 0.95, 0.01, 'Level where the mouth starts to open (half)'),
          f('Open at', 'open', 0.05, 1, 0.01, 'Level where the mouth fully opens'),
          f('Hold', 'hold', 0, 600, 10, 'How long the mouth stays open after you stop. Longer = calmer', 'ms'),
          this.note('You can also drag the white and purple markers on the meter under the stage.')),
        this.section('Tips', el('ul', { class: 'help-list' },
          el('li', {}, 'Talk normally and watch the meter. The bar should pass "talk" on every word and "open" on louder syllables.'),
          el('li', {}, 'If the mouth flaps on background noise, raise "Talk at" or lower Sensitivity.'),
          el('li', {}, 'No "Half" mouth image? The rig uses the open mouth for both.'))),
      );
      this.refreshDevices();
    },

    async refreshDevices() {
      const sel = this.micSelect; if (!sel) return;
      const list = await PT.Audio.devices();
      const cur = this.project.mic.deviceId;
      sel.innerHTML = '';
      sel.append(el('option', { value: '' }, 'Default microphone'));
      list.forEach((d, i) => { if (d.deviceId && d.deviceId !== 'default') sel.append(el('option', { value: d.deviceId }, d.label || `Microphone ${i + 1}`)); });
      sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
    },

    // Measure 1.5 s of silence, then 3 s of talking, and set thresholds from that
    async tune(btn) {
      const app = this.app, mic = this.project.mic;
      if (!PT.Audio.running) { await app.startMic(); if (!PT.Audio.running) return; }
      const sample = (ms) => new Promise((res) => {
        const vals = [], t0 = performance.now();
        const tick = () => { vals.push(app.level); if (performance.now() - t0 < ms) requestAnimationFrame(tick); else res(vals); };
        tick();
      });
      btn.disabled = true;
      btn.textContent = 'Stay quiet…';
      const quiet = await sample(1500);
      btn.textContent = 'Now talk normally…';
      const talk = await sample(3000);
      btn.disabled = false; btn.textContent = 'Tune to my voice';
      const sorted = (a) => a.slice().sort((x, y) => x - y);
      const q = sorted(quiet), t = sorted(talk);
      const noise = q[Math.floor(q.length * 0.95)] || 0;
      const speech = t[Math.floor(t.length * 0.7)] || 0;
      if (speech - noise < 0.08) { PT.toast('Couldn\'t hear much difference between quiet and talking. Try raising Sensitivity and tune again.', 'warn', 6000); return; }
      mic.talk = PT.clamp(noise + (speech - noise) * 0.3, 0.03, 0.9);
      mic.open = PT.clamp(noise + (speech - noise) * 0.85, mic.talk + 0.05, 0.98);
      this.syncInspector();
      app.changed({ settings: true });
      PT.toast('Mic tuned to your voice.');
    },

    /* ---------- Stage tab ---------- */
    obsUrl() {
      const url = location.origin + '/?stage=1';
      const input = el('input', { class: 'obs-url', value: url, readonly: true, onfocus: (e) => e.target.select() });
      const copy = el('button', { class: 'btn', onclick: async () => {
        try { await navigator.clipboard.writeText(url); } catch (e) { input.select(); document.execCommand('copy'); }
        PT.toast('OBS URL copied');
      } }, 'Copy');
      return el('div', { class: 'obs-row' }, input, copy);
    },

    /* Virtual camera: the desktop app sends the stage to the "OBS Virtual Camera" device,
       which Zoom, Discord, Teams etc. list as a camera. cam = the last status from the app. */
    cameraBox() {
      const cam = this.cam;
      if (cam === undefined) {            // first time: ask the app (null = not the desktop app)
        this.cam = null;
        PT.Storage.vcam().then((s) => { if (s) { this.cam = s; this.renderStageTab(); } });
      }
      if (!cam) return null;
      const btn = el('button', {
        class: 'btn' + (cam.on ? '' : ' primary'), disabled: !!this.camBusy,
        onclick: async () => {
          this.camBusy = true; this.renderStageTab();
          const s = await PT.Storage.vcam(!cam.on);
          this.camBusy = false;
          if (s) this.cam = s;
          this.renderStageTab();
          if (!s) PT.toast('The virtual camera did not answer. Try restarting EASY-TUBER.', 'error', 7000);
          else if (s.error) PT.toast(s.error, 'error', 12000);
          else if (s.on) PT.toast(`Camera on. Pick "${s.device}" as the camera in your call or chat program.`, '', 8000);
        },
      }, this.camBusy ? 'Working…' : cam.on ? 'Stop camera' : 'Start camera');
      return this.section('Virtual camera',
        el('div', { class: 'row' }, btn, el('span', { class: 'chip' + (cam.on ? ' hot' : '') }, cam.on ? 'on' : 'off')),
        cam.error ? el('p', { class: 'note warn-text' }, cam.error) : null,
        this.note(`Shows your avatar as a camera in Zoom, Discord, Teams and others: choose "${cam.device}" there. Needs OBS Studio installed (not running). A camera can't be transparent, so Transparent shows black.`));
    },

    renderStageTab() {
      const host = document.getElementById('tab-stageTab');
      const st = this.project.stage, app = this.app;
      this.syncers = this.syncers.filter((s) => !s.stageTab);
      const before = this.syncers.length;

      const opts = [['transparent', 'Transparent', 'checker'], ['green', 'Green screen', '#00ff00'], ['blue', 'Blue screen', '#0000ff'], ['magenta', 'Magenta', '#ff00ff']];
      const sw = el('div', { class: 'swatches' });
      for (const [k, label, color] of opts) {
        sw.append(el('button', {
          class: 'swatch' + (color === 'checker' ? ' checker' : '') + (st.bg === k ? ' active' : ''), title: label,
          style: color === 'checker' ? null : { background: color },
          onclick: () => { st.bg = k; app.changed({ settings: true }); this.renderStageTab(); },
        }));
      }
      const colorIn = el('input', { type: 'color', value: st.color, title: 'Custom color', class: 'swatch' + (st.bg === 'custom' ? ' active' : ''), style: { padding: 0 } });
      colorIn.addEventListener('input', () => { st.bg = 'custom'; st.color = colorIn.value; app.changed({ settings: true }); });
      colorIn.addEventListener('change', () => this.renderStageTab());
      sw.append(colorIn);

      const list = el('ol', { class: 'order-list' });
      const order = this.project.order;
      for (let i = order.length - 1; i >= 0; i--) {
        const id = order[i], def = PT.PART[id];
        const mv = (dir) => { const j = i + dir; if (j < 0 || j >= order.length) return; PT.Editor.pushUndo(true); [order[i], order[j]] = [order[j], order[i]]; app.changed({ structure: true }); };
        list.append(el('li', { class: app.selected === id ? 'selected' : '' },
          el('span', { onclick: () => app.select(id), style: { cursor: 'pointer' } }, (def.group.includes('arm') ? def.group.replace(' arm', '') + ' ' : '') + def.label),
          el('button', { class: 'icon-btn', title: 'Bring forward', onclick: () => mv(1), disabled: i === order.length - 1 }, '↑'),
          el('button', { class: 'icon-btn', title: 'Send back', onclick: () => mv(-1), disabled: i === 0 }, '↓')));
      }

      host.innerHTML = '';
      host.append(
        this.section('Background', sw, this.note('Used by the stage window. Transparent shows a checkerboard here.')),
        this.section('Editor',
          this.check('Show placeholder art for empty parts', () => st.placeholders, (v) => { st.placeholders = v; app.changed({ structure: true }); }),
          this.check('Show joints and bones', () => st.skeleton, (v) => { st.skeleton = v; app.changed({ settings: true }); }),
          this.check('Dragging a part moves the parts attached to it', () => st.moveChildren, (v) => { st.moveChildren = v; app.changed({ settings: true }); },
            'e.g. moving the face also moves eyes, mouth and hair'),
          this.check('Onion skin when lining up eye / mouth frames', () => st.onion, (v) => { st.onion = v; app.changed({ settings: true }); })),
        this.section('Sprite sheets', this.sheetList()),
        this.section('Draw order (top = front)', list),
        this.section('Streaming with OBS', this.obsUrl(), el('ol', { class: 'help-list' },
          el('li', {}, 'In OBS: + → Browser. Paste the URL above, width 1920, height 1080.'),
          el('li', {}, 'Leave Background on Transparent: no chroma key needed.'),
          el('li', {}, 'Keep EASY-TUBER open with the mic on. It can be minimized.')),
          this.note('Or use Window Capture: pick Green screen, click "Open stage window" and capture "EASY-TUBER Stage" with a Chroma Key filter.')),
      );
      const camera = this.cameraBox();
      if (camera) host.firstChild.after(camera);   // under Background, which it uses
      for (let i = before; i < this.syncers.length; i++) this.syncers[i].stageTab = true;
    },

    /* ---------- Avatars tab ---------- */
    // listen for the next key combination; onKey(accelerator) or onKey('') to clear
    captureKey(btn, onKey) {
      if (this.capture) this.capture.cancel();
      const A = PT.Avatars;
      btn.textContent = 'Press keys…';
      btn.classList.add('capturing');
      A.pause();   // or pressing a key that's already bound would switch avatars instead
      let finished = false;
      const done = async (acc) => {
        if (finished) return;
        finished = true;
        window.removeEventListener('keydown', onDown, true);
        window.removeEventListener('blur', onBlur);
        this.capture = null;
        if (acc === undefined) await A.register();
        else await onKey(acc);
      };
      const onDown = (e) => {
        e.preventDefault(); e.stopPropagation();
        const plain = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
        if (e.key === 'Escape') return done();
        if (plain && (e.key === 'Backspace' || e.key === 'Delete')) return done('');
        const r = A.acceleratorFromEvent(e);
        if (!r) return;   // only modifiers so far
        if (r.error) { PT.toast(r.error, 'warn', 6000); return; }
        done(r.accelerator);
      };
      const onBlur = () => done();
      window.addEventListener('keydown', onDown, true);
      window.addEventListener('blur', onBlur);
      this.capture = { cancel: () => done() };
    },

    hotkeyRow(target, current) {
      const A = PT.Avatars;
      const bad = current && A.supported && A.status[current] === false;
      const cap = el('span', {
        class: 'keycap' + (current ? '' : ' none') + (bad ? ' bad' : ''),
        title: bad ? 'Another program is already using this key combination. Pick a different one.' : '',
      }, current ? A.prettyKey(current) : 'No hotkey');
      const set = el('button', { class: 'btn small', title: 'Press the key combination to use. Esc cancels, Backspace removes it.' }, current ? 'Change' : 'Set key');
      set.onclick = () => this.captureKey(set, async (acc) => {
        if (acc && A.keyInUse(acc, target)) {
          PT.toast(`${A.prettyKey(acc)} is already used for another avatar or action.`, 'warn', 5000);
          await A.register();
          return;
        }
        await A.setHotkey(target, acc);
        if (acc) PT.toast(`Hotkey set: ${A.prettyKey(acc)}`);
      });
      const clear = current ? el('button', { class: 'icon-btn', title: 'Remove hotkey', onclick: () => A.setHotkey(target, '') }, '✕') : null;
      return el('div', { class: 'key-row' }, cap, set, clear);
    },

    renderAvatars() {
      const host = document.getElementById('tab-avatars');
      if (!host || this.app.stageMode) return;
      if (this.capture) this.capture.cancel();
      const A = PT.Avatars, p = this.project, app = this.app;

      const rows = el('div', { class: 'avatar-list' });
      for (const a of p.avatars) {
        const on = a.id === p.activeAvatar;
        const name = el('input', { class: 'av-name', value: a.name, maxlength: 60, title: 'Avatar name' });
        name.addEventListener('change', () => A.rename(a, name.value));
        name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
        rows.append(el('div', { class: 'avatar-row' + (on ? ' active' : '') },
          el('div', { class: 'av-top' },
            el('span', { class: 'av-dot', title: on ? 'On screen now' : '' }),
            name,
            on ? el('span', { class: 'av-badge' }, 'On screen')
              : el('button', { class: 'btn small', title: 'Switch to this avatar', onclick: () => A.switchTo(a.id) }, 'Show')),
          el('div', { class: 'av-bottom' },
            this.hotkeyRow(a, a.hotkey),
            el('button', {
              class: 'icon-btn', title: 'Delete this avatar', disabled: p.avatars.length < 2,
              onclick: () => { if (confirm(`Delete "${a.name}" and its images?`)) A.remove(a); },
            }, '🗑'))));
      }

      const fileIn = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
      fileIn.addEventListener('change', async () => {
        const f = fileIn.files[0]; fileIn.value = '';
        if (!f) return;
        try { await A.importFile(f); await A.register(); } catch (e) { PT.toast('Could not read that file: ' + e.message, 'error'); }
      });

      const random = p.activeAvatar === A.RANDOM;
      const anyBad = A.supported && Object.values(A.status).some((ok) => ok === false);

      host.innerHTML = '';
      host.append(
        this.section('Your avatars',
          random ? el('p', { class: 'note' }, '🎲 A random mix is on screen. Keep it as an avatar, or switch to one below.') : null,
          rows,
          el('div', { class: 'row' },
            el('button', { class: 'btn', title: 'Start a new avatar from the placeholder', onclick: () => A.addBlank() }, '+ New avatar'),
            el('button', { class: 'btn', title: 'Copy what is on screen into a new avatar, e.g. for an outfit change', onclick: () => A.duplicate() }, 'Duplicate')),
          el('div', { class: 'row', style: { marginTop: '6px' } },
            el('button', { class: 'btn', title: 'Add the avatars from a saved .easytuber.json file', onclick: () => fileIn.click() }, 'Add from file…'), fileIn),
          this.note('Each avatar has its own images, positions and draw order. Motion, mic and stage settings are shared.')),
        this.section('Random mix',
          this.note('Builds a new look from your avatars: each part (both pieces of an arm together) comes from a random avatar. Works best when your avatars were drawn on the same canvas.'),
          this.hotkeyRow('random', p.hotkeys.random),
          el('div', { class: 'row', style: { marginTop: '8px' } },
            el('button', { class: 'btn', onclick: () => A.switchTo(A.RANDOM) }, '🎲 Mix now'),
            random ? el('button', { class: 'btn', title: 'Keep the mix on screen as a new avatar', onclick: () => A.keepMix() }, 'Keep this mix') : null)),
        this.section('Next avatar',
          this.note('Steps through your avatars in order.'),
          this.hotkeyRow('next', p.hotkeys.next)),
        this.section('Switch animation',
          this.check('Parts drop off the screen, then the new avatar climbs back in', () => p.switchFx, (v) => { p.switchFx = v; app.changed({ settings: true }); }),
          el('div', { class: 'row' }, el('button', {
            class: 'btn', title: 'Play the animation here and in OBS',
            onclick: () => { PT.Transition.play(); PT.Storage.live({ type: 'switch-out', test: true }); },
          }, 'Test the animation'))),
        this.section('About hotkeys',
          A.supported
            ? el('ul', { class: 'help-list' },
              el('li', {}, 'They work everywhere, even while you\'re in a game, as long as EASY-TUBER is running.'),
              el('li', {}, 'While EASY-TUBER is running, the keys you bind don\'t reach other programs. Use combinations you don\'t need elsewhere, like Ctrl+Alt+1 or the numpad.'),
              el('li', {}, 'OBS shows the switch too: the stage page follows along.'))
            : this.note('Global hotkeys work in the EASY-TUBER desktop app.'),
          anyBad ? el('p', { class: 'note warn-text' }, 'A hotkey shown in red is taken by another program, so it won\'t work. Pick a different one.') : null),
      );
    },
  };

  /* ---------- Actions tab ---------- */
  Object.assign(Panels, {
    // one action: play it, its hotkey, its settings
    actionRow(def) {
      const p = this.project, app = this.app;
      const cfg = () => (p.actions[def.id] = p.actions[def.id] || { hotkey: '', settings: {} });
      const settings = def.settings.map((s) => {
        const get = () => PT.Actions.settingsFor(p, def)[s.key];
        const set = (v) => { cfg().settings[s.key] = v; app.changed({ settings: true }); };
        return s.type === 'check'
          ? this.check(s.label, get, set)
          : this.field(s.label, { min: s.min, max: s.max, step: s.step, suffix: s.suffix, get, set: (v) => set(PT.clamp(v, s.min, s.max)) });
      });
      return el('div', { class: 'avatar-row action-row' },
        el('div', { class: 'av-top' },
          el('span', { class: 'action-name', title: 'id: ' + def.id }, def.label),
          el('span', { class: 'action-len' }, (def.duration / 1000).toFixed(1) + ' s'),
          el('button', { class: 'btn small', title: 'Play it here, in the stage window and in OBS', onclick: () => app.playAction(def.id) }, '▶ Test')),
        el('div', { class: 'av-bottom' }, this.hotkeyRow('action:' + def.id, (p.actions[def.id] || {}).hotkey || '')),
        settings.length ? el('details', { class: 'action-settings' }, el('summary', {}, 'Settings'), ...settings) : null);
    },

    // Streamer.bot: one step or a sequence, as a URL for a Fetch URL sub-action
    streamerBot(defs) {
      const p = this.project;
      const choices = [
        ...defs.map((d) => [d.id, d.label]),
        ['next', 'Next avatar'], ['random', 'Random mix'],
        ...p.avatars.map((a) => ['avatar:' + a.id, 'Show ' + a.name]),
      ];
      const labels = new Map(choices);
      const pick = el('select', { 'aria-label': 'Action for Streamer.bot' }, ...choices.map(([v, l]) => el('option', { value: v }, l)));
      if (labels.has(this.sbPick)) pick.value = this.sbPick;
      const seq = this.sbSequence = (this.sbSequence || []).filter((v) => labels.has(v));
      const timing = this.sbTiming = this.sbTiming || { startDelay: '', delay: '' };

      const url = el('input', { class: 'obs-url', readonly: true, onfocus: (e) => e.target.select() });
      const copy = el('button', { class: 'btn', onclick: async () => {
        try { await navigator.clipboard.writeText(url.value); } catch (e) { url.select(); document.execCommand('copy'); }
        PT.toast('Streamer.bot URL copied');
      } }, 'Copy');
      const list = el('ol', { class: 'help-list seq-list', 'aria-label': 'Sequence' });
      const fields = [['startDelay', 'Start delay (s)', 0, '0'], ['delay', 'Time between steps (s)', 0.1, 'Auto']].map(([key, label, min, ph]) => {
        const input = el('input', { type: 'number', min, max: 60, step: 0.1, placeholder: ph, value: timing[key] });
        input.addEventListener('input', () => { timing[key] = input.value; update(); });
        return { key, input, row: el('div', { class: 'field field-inline' }, el('label', {}, label), input) };
      });
      const timingBox = el('div', {}, ...fields.map((f) => f.row));
      const bad = el('p', { class: 'note warn-text' }, 'Start delay is 0 to 60 s, time between steps 0.1 to 60 s, in tenths. Leave "Auto" to wait for each step to finish.');

      const build = (useSeq) => {
        const u = new URL('/api/streamerbot', location.origin);
        u.hostname = '127.0.0.1';
        if (!useSeq) { u.searchParams.set('action', pick.value); return u; }
        u.searchParams.set('sequence', seq.join(','));
        for (const f of fields) if (f.input.value !== '') u.searchParams.set(f.key, String(f.input.valueAsNumber));
        return u;
      };
      const test = async (useSeq) => {
        const u = build(useSeq);
        u.hostname = location.hostname;          // same origin as this page
        if (this.app.mode === 'edit') this.app.setMode('live');
        try { await PT.Storage.runActionUrl(u); PT.toast(useSeq ? 'Sequence started' : 'Playing ' + labels.get(pick.value)); } catch (e) { PT.toast('Could not run it: ' + e.message, 'error'); }
      };
      const add = el('button', { class: 'btn small', onclick: () => { seq.push(pick.value); update(); } }, 'Add to sequence');
      const testSeq = el('button', { class: 'btn small', onclick: () => test(true) }, '▶ Test sequence');
      const clear = el('button', { class: 'btn small', onclick: () => { seq.length = 0; update(); } }, 'Clear');
      const seqRow = el('div', { class: 'row' }, testSeq, clear);

      const update = () => {
        const has = seq.length > 0;
        const invalid = has && fields.some((f) => !f.input.validity.valid);
        url.value = invalid ? '' : build(has).href;
        copy.disabled = testSeq.disabled = invalid;
        add.disabled = seq.length >= 8;
        list.hidden = seqRow.hidden = timingBox.hidden = !has;
        bad.hidden = !invalid;
        list.replaceChildren(...seq.map((v, i) => el('li', {}, labels.get(v) + ' ',
          el('button', { class: 'icon-btn', title: 'Remove this step', onclick: () => { seq.splice(i, 1); update(); } }, '✕'))));
      };
      pick.addEventListener('change', () => { this.sbPick = pick.value; update(); });
      update();

      return this.section('Streamer.bot',
        this.note('Pick an action, or build a sequence of up to 8 steps. The URL plays the sequence when there is one.'),
        pick,
        el('div', { class: 'row', style: { marginTop: '6px' } },
          el('button', { class: 'btn small', onclick: () => test(false) }, '▶ Test'), add),
        list, timingBox, bad, seqRow,
        el('div', { class: 'obs-row', style: { marginTop: '8px' } }, url, copy),
        el('ol', { class: 'help-list' },
          el('li', {}, 'In Streamer.bot on this computer, add a "Fetch URL" sub-action and paste the URL.'),
          el('li', {}, 'Add the header X-EasyTuber-Control with the value streamerbot.'),
          el('li', {}, 'EASY-TUBER must be running. The stage page in OBS plays it too.')));
    },

    renderActions() {
      const host = document.getElementById('tab-actions');
      if (!host || this.app.stageMode) return;
      if (this.capture) this.capture.cancel();
      this.syncers = this.syncers.filter((s) => !s.actionsTab);
      const before = this.syncers.length;
      const defs = PT.Actions.list();
      const server = PT.Storage.server;

      // the folder action files go in, and a reload for after adding or changing one
      const folder = el('div', { class: 'row', style: { marginTop: '8px' } },
        el('button', { class: 'btn small', title: this.app.actionsFolder || '', onclick: async () => {
          try { await PT.Storage.openActionsFolder(); } catch (e) { PT.toast('Could not open the folder: ' + e.message, 'error'); }
        } }, 'Open actions folder'),
        el('button', { class: 'btn small', title: 'Load the action files again: here, in the stage window and in OBS', onclick: () => {
          PT.Storage.live({ type: 'reload-actions' });
          setTimeout(() => location.reload(), 150);   // after the message has gone out
        } }, 'Reload actions'));
      const skipped = (this.app.actionLoad && this.app.actionLoad.failed) || [];

      host.innerHTML = '';
      host.append(
        this.section('Your actions',
          defs.length
            ? el('div', { class: 'avatar-list' }, ...defs.map((d) => this.actionRow(d)))
            : el('div', {},
              this.note('No actions yet. An action is an animation you made: a wave, a spin, a prop that flies in.'),
              this.note(server
                ? 'Each one is a single file. Put it in the actions folder and click Reload actions.'
                : 'Each one is a single file. Actions load in the EASY-TUBER desktop app.')),
          defs.length ? this.note('Test switches the editor to Live. OBS and the stage window play it too.') : null,
          ...skipped.map((f) => el('p', { class: 'note warn-text' }, `${f.src.split('/').pop()} was skipped: ${f.message}`)),
          server ? folder : null,
          server ? this.note('Only add action files you trust: an action is a small program that runs inside EASY-TUBER.') : null),
        server ? this.streamerBot(defs)
          : this.section('Streamer.bot', this.note('Hotkeys and Streamer.bot work in the EASY-TUBER desktop app.')),
      );
      for (let i = before; i < this.syncers.length; i++) this.syncers[i].actionsTab = true;
    },
  });

  PT.Panels = Panels;
})(window.PT);
