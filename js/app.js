/* Boot, main loop, top bar, meter, keyboard, drag & drop, stage window. */
(function (PT) {
  const $ = (id) => document.getElementById(id);

  const App = {
    project: null,
    selected: null,
    mode: 'edit',
    previewStates: { eyes: 'open', mouth: 'closed' },
    level: 0,
    simTalk: false,
    stageMode: false,
    remote: { v: 0, t: -1e9 },
    lastPose: null,
    lastAnim: null,

    async init() {
      this.stageMode = new URLSearchParams(location.search).has('stage');
      PT.Assets.initPlaceholders();
      await PT.Storage.init();
      const loaded = await PT.Storage.load();
      this.project = PT.normalizeProject(loaded.project);
      await PT.Assets.loadProject(this.project);

      this.renderer = new PT.Renderer($('stage'));
      this.renderer.stageMode = this.stageMode;
      this.animator = new PT.Animator();
      this.save = PT.debounce(() => PT.Storage.save(this.project), 500);
      // first run with the file server: copy the avatar from this browser into the file OBS reads
      if (!this.stageMode && loaded.pushToServer) PT.Storage.save(this.project);

      if (this.stageMode) this.initStage();
      else this.initEditor();

      window.addEventListener('resize', () => this.renderer.resize());
      this.renderer.resize();
      this.last = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    },

    /* ---------------- stage window (for OBS) ---------------- */
    initStage() {
      document.body.classList.add('stage-mode');
      document.title = 'EASY-TUBER Stage';
      this.mode = 'live';
      this.inOBS = !!window.obsstudio;
      const reload = PT.debounce(async () => {
        const p = (await PT.Storage.load()).project;
        if (!p) return;
        const np = PT.normalizeProject(p);
        await PT.Assets.loadProject(np);
        this.project = np;
      }, 150);
      PT.Storage.onMessage((msg) => {
        if (msg.type === 'project-saved') reload();
        else if (msg.type === 'level') { this.remote.v = msg.v; this.remote.t = performance.now(); }
        else if (msg.type === 'blink') this.animator.blink();
      });
      const btn = $('clickToStart');
      btn.addEventListener('click', async () => {
        if (PT.Audio.running) await PT.Audio.resume();
        else await this.startMic();
      });
      // start our own mic straight away if permission was already given
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'microphone' }).then((s) => { if (s.state === 'granted' && !this.inOBS) this.startMic(true); }).catch(() => {});
      }
    },

    /* ---------------- editor ---------------- */
    initEditor() {
      PT.Editor.attach($('stage'));
      if (/Electron/.test(navigator.userAgent) && location.port !== '8777') {
        PT.toast(`Port 8777 was busy (another copy or an old start.bat?). The OBS URL is now ${location.origin}/?stage=1`, 'error', 12000);
      }
      // while this tab is hidden the main loop is paused: keep sending the mic level to the stage
      PT.Audio.onTick = (dt) => {
        if (performance.now() - this.last < 200) return;
        const v = PT.Audio.read(dt, this.project.mic.sensitivity);
        PT.Storage.live({ type: 'level', v });
      };
      PT.Panels.init();

      $('modeEdit').onclick = () => this.setMode('edit');
      $('modeLive').onclick = () => this.setMode('live');
      $('btnUndo').onclick = () => PT.Editor.undo();
      $('btnRedo').onclick = () => PT.Editor.redo();
      $('btnMic').onclick = () => this.toggleMic();
      $('btnStage').onclick = () => {
        const url = location.href.split('?')[0].split('#')[0] + '?stage=1';
        window.open(url, 'easytuber-stage', 'width=640,height=720');
      };
      $('btnExport').onclick = () => {
        const name = (this.project.name || 'easy-tuber').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        PT.download(`${name}.easytuber.json`, JSON.stringify(this.project));
        PT.toast('Saved. Use "Open file" to load it again, on any computer.');
      };
      $('btnSheet').onclick = () => PT.SheetEditor.pick(this.selected && this.selected !== 'root' && PT.PART[this.selected].states.length > 1 ? this.selected : null);
      $('btnImport').onclick = () => $('importInput').click();
      $('importInput').onchange = async (e) => {
        const f = e.target.files[0]; e.target.value = '';
        if (!f) return;
        try {
          const data = JSON.parse(await f.text());
          if (!data || !data.parts) throw new Error('not an EASY-TUBER file');
          await this.loadProject(PT.normalizeProject(data));
          PT.toast(`Loaded ${f.name}`);
        } catch (err) { PT.toast('Could not open file: ' + err.message, 'error'); }
      };
      $('btnReset').onclick = async () => {
        if (!confirm('Remove all uploaded images and reset every setting?')) return;
        await this.loadProject(PT.defaultProject());
        PT.toast('Reset to the placeholder character.');
      };

      // bulk drop zone
      const dz = $('dropAll'), dzIn = $('dropAllInput');
      dz.onclick = () => dzIn.click();
      dz.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') dzIn.click(); };
      dzIn.onchange = () => { if (dzIn.files.length) PT.Editor.importFiles(dzIn.files); dzIn.value = ''; };
      PT.Panels.makeDroppable(dz, (files) => PT.Editor.importFiles(files));

      // dropping on the stage: route by filename, or into the selected part
      const wrap = $('stageWrap');
      PT.Panels.makeDroppable(wrap, (files) => {
        const routed = Array.from(files).some((f) => PT.routeFilename(f.name).part);
        const sel = this.selected && this.selected !== 'root' ? this.selected : null;
        if (!routed && sel) PT.Editor.importFiles(files, { part: sel });
        else PT.Editor.importFiles(files);
      });
      // never let a missed drop navigate away from the app
      window.addEventListener('dragover', (e) => e.preventDefault());
      window.addEventListener('drop', (e) => e.preventDefault());

      // test-talk button
      const tt = $('btnTalkTest');
      tt.addEventListener('pointerdown', () => { this.simTalk = true; });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => tt.addEventListener(ev, () => { this.simTalk = false; }));

      this.initMeter();
      this.initKeys();
      this.setMode('edit');
      if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', () => PT.Panels.refreshDevices());
      }
      if (!window.isSecureContext) {
        PT.toast('Microphone needs a secure page. Close this tab, run start.bat and use the localhost address it opens.', 'warn', 10000);
      }
    },

    async loadProject(p) {
      await PT.Assets.loadProject(p);
      this.project = p;
      this.selected = null;
      PT.Editor.resetHistory();
      PT.Panels.syncers = [];
      PT.Panels.init();
      this.save();
    },

    setMode(mode) {
      this.mode = mode;
      $('modeEdit').classList.toggle('active', mode === 'edit');
      $('modeLive').classList.toggle('active', mode === 'live');
      $('stageHint').textContent = mode === 'edit'
        ? 'Edit: rest pose. Click a part to select. Drag to move · square = scale · circle = rotate · orange cross = joint'
        : 'Live: breathing, blinking and talking. Hold Space to test without a mic.';
      PT.Editor.hover = null;
    },

    select(id) {
      this.selected = id;
      if (this.stageMode) return;
      PT.Panels.renderPartList();
      PT.Panels.renderInspector();
      PT.Panels.renderStageTab();
      if (id) PT.Panels.showTab('part');
    },

    changed(o = {}) {
      this.save();
      if (this.stageMode) return;
      if (o.structure) { PT.Panels.renderPartList(); PT.Panels.renderInspector(); PT.Panels.renderStageTab(); }
      else if (o.transform || o.settings) PT.Panels.syncInspector();
    },

    /* ---------------- mic ---------------- */
    async startMic(quiet = false) {
      try {
        await PT.Audio.start(this.project.mic.deviceId);
        if (!this.stageMode) { PT.Panels.refreshDevices(); if (!quiet) PT.toast('Microphone on. Talk and watch the meter.'); }
      } catch (e) {
        const msg = e.name === 'NotAllowedError' ? 'Microphone permission was blocked. Allow it from the icon in the address bar.'
          : e.name === 'NotFoundError' ? 'No microphone found.'
          : e.message;
        if (!quiet) PT.toast(msg, 'error', 7000);
      }
      this.updateMicButton();
    },
    toggleMic() { if (PT.Audio.running) { PT.Audio.stop(); this.updateMicButton(); } else this.startMic(); },
    updateMicButton() {
      const b = $('btnMic');
      if (!b) return;
      b.textContent = PT.Audio.running ? '🎤 Mic on' : '🎤 Start mic';
      b.classList.toggle('on', PT.Audio.running);
    },

    simLevel(t) {
      const s = this.sim || (this.sim = { next: 0, start: 0, dur: 0.2, peak: 0.7 });
      if (t >= s.next) {
        s.start = t; s.dur = 0.11 + Math.random() * 0.16; s.next = t + s.dur;
        s.peak = Math.random() < 0.12 ? 0.15 : 0.45 + Math.random() * 0.55;   // occasional pause
      }
      const ph = (t - s.start) / s.dur;
      return s.peak * (0.3 + 0.7 * Math.sin(Math.PI * PT.clamp(ph, 0, 1)));
    },

    /* ---------------- meter ---------------- */
    initMeter() {
      const meter = $('meter');
      const bind = (mark, key) => {
        mark.addEventListener('pointerdown', (e) => {
          e.preventDefault(); mark.setPointerCapture(e.pointerId);
          const move = (ev) => {
            const r = meter.getBoundingClientRect();
            const mic = this.project.mic;
            let v = PT.clamp((ev.clientX - r.left) / r.width, 0.02, 1);
            if (key === 'talk') v = Math.min(v, mic.open - 0.02); else v = Math.max(v, mic.talk + 0.02);
            mic[key] = Math.round(v * 100) / 100;
            this.changed({ settings: true });
          };
          const up = () => { mark.removeEventListener('pointermove', move); mark.removeEventListener('pointerup', up); };
          mark.addEventListener('pointermove', move);
          mark.addEventListener('pointerup', up);
        });
      };
      bind($('markTalk'), 'talk');
      bind($('markOpen'), 'open');
    },

    updateMeter(anim) {
      $('meterFill').style.width = (this.level * 100).toFixed(1) + '%';
      $('markTalk').style.left = this.project.mic.talk * 100 + '%';
      $('markOpen').style.left = this.project.mic.open * 100 + '%';
      const cm = $('chipMouth'), ce = $('chipEyes');
      const mouth = 'mouth: ' + anim.states.mouth, eyes = 'eyes: ' + anim.states.eyes;
      if (cm.textContent !== mouth) { cm.textContent = mouth; cm.classList.toggle('hot', anim.states.mouth !== 'closed'); }
      if (ce.textContent !== eyes) ce.textContent = eyes;
    },

    /* ---------------- keyboard ---------------- */
    initKeys() {
      const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      window.addEventListener('keydown', (e) => {
        if (typing(e)) return;
        const k = e.key;
        if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? PT.Editor.redo() : PT.Editor.undo(); return; }
        if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'y') { e.preventDefault(); PT.Editor.redo(); return; }
        if (e.ctrlKey || e.metaKey) return;
        if (k === ' ') { e.preventDefault(); this.simTalk = true; return; }
        if (k === 'b' || k === 'B') { this.animator.blink(); PT.Storage.live({ type: 'blink' }); return; }
        if (k === 'Tab') { e.preventDefault(); this.setMode(this.mode === 'edit' ? 'live' : 'edit'); return; }
        if (k === 'Escape') { this.select(null); return; }
        if (this.mode === 'edit' && k.startsWith('Arrow')) {
          e.preventDefault();
          const s = e.shiftKey ? 10 : 1;
          PT.Editor.nudge(k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0);
        }
      });
      window.addEventListener('keyup', (e) => { if (e.key === ' ') this.simTalk = false; });
      window.addEventListener('blur', () => { this.simTalk = false; });
    },

    /* ---------------- main loop ---------------- */
    frame(now) {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      const t = now / 1000;
      const p = this.project;

      // where does the loudness come from?
      const ownMic = PT.Audio.running && !PT.Audio.suspended;
      const micLevel = PT.Audio.read(dt, p.mic.sensitivity);
      const remoteFresh = now - this.remote.t < 400;
      let level = 0;
      if (this.simTalk) level = this.simLevel(t);
      else if (this.stageMode && remoteFresh) level = this.remote.v;   // the editor's mic wins
      else if (ownMic) level = micLevel;
      this.level = level;

      if (!this.stageMode && (ownMic || this.simTalk)) PT.Storage.live({ type: 'level', v: level });
      if (this.stageMode) $('clickToStart').hidden = ownMic || remoteFresh || this.inOBS;

      const anim = this.animator.update(dt, level, p.motion, p.mic);
      this.lastAnim = anim;

      const editing = !this.stageMode && this.mode === 'edit';
      const R = this.renderer;
      R.resize();
      const pose = R.computePose(p, editing ? null : anim.deltas);
      this.lastPose = pose;
      R.clear(p, editing);
      R.drawRig(p, pose, editing ? this.previewStates : anim.states, {
        dimPlaceholders: editing,
        onionPart: editing && p.stage.onion ? this.selected : null,
      });
      if (editing) PT.Editor.drawOverlay(pose);
      if (!this.stageMode) this.updateMeter(anim);

      requestAnimationFrame((tt) => this.frame(tt));
    },
  };

  PT.App = App;
  window.addEventListener('DOMContentLoaded', () => App.init().catch((e) => {
    console.error(e);
    PT.toast('Startup error: ' + e.message, 'error', 10000);
  }));
})(window.PT);
