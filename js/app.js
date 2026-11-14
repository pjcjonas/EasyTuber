/* Boot, main loop, top bar, meter, keyboard, drag & drop, stage window. */
(function (PT) {
  const $ = (id) => document.getElementById(id);
  const FRAME_MIN_MS = 1000 / 75;   // the least time between two drawn frames (see frame())

  const App = {
    project: null,
    selected: null,
    mode: 'edit',
    previewStates: { eyes: 'open', mouth: 'closed' },
    level: 0,
    simTalk: false,
    stageMode: false,
    stepped: 0,          // when running actions were last moved on (by a frame, or by the timer in init)
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
      // the action files: the app's js/actions/ and the user's actions folder (the same list on every page)
      const actionFiles = await PT.Storage.actionFiles();
      this.actionsFolder = actionFiles.folder;
      this.actionLoad = await PT.Actions.loadAll(actionFiles.files);

      this.renderer = new PT.Renderer($('stage'));
      this.renderer.stageMode = this.stageMode;
      // ?cam=1: the hidden stage page the desktop app films for the virtual camera
      this.camMode = this.stageMode && new URLSearchParams(location.search).has('cam');
      this.renderer.camMode = this.camMode;
      PT.Actions.page = this.camMode ? 'cam' : this.stageMode ? 'stage' : 'editor';   // who plays action sounds
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
      /* A minimised window gets about one frame a second. Actions must not wait for it: their
         sounds, timed steps and endings are kept on time from a timer while frames are scarce. */
      setInterval(() => {
        const now = performance.now();
        if (now - this.stepped > 25 && PT.Actions.active) { this.stepped = now; PT.Actions.update(now, this.project); }
      }, 33);
    },

    /* ---------------- stage window (for OBS) ---------------- */
    initStage() {
      document.body.classList.add('stage-mode');
      document.title = 'EASY-TUBER Stage';
      this.mode = 'live';
      this.inOBS = !!window.obsstudio || this.camMode;   // no mic of its own: the editor's mic drives it
      // an avatar switch: the editor says "switch-out", then saves the new avatar
      let switching = false;
      const reload = PT.debounce(async () => {
        const p = (await PT.Storage.load()).project;
        if (!p) return;
        const np = PT.normalizeProject(p);
        // the image cache is shared: let the old avatar finish falling before loading the new art
        if (switching) while (PT.Transition.falling) await new Promise((r) => setTimeout(r, 30));
        await PT.Assets.loadProject(np);
        this.project = np;
        if (switching) {
          switching = false;
          // (unless the 6 s safety net already brought the parts back)
          if (PT.Transition.phase === 'out' || PT.Transition.phase === 'hidden') PT.Transition.in();
        }
      }, 150);
      PT.Storage.onMessage((msg) => {
        if (msg.type === 'project-saved') reload();
        else if (msg.type === 'level') { this.remote.v = msg.v; this.remote.t = performance.now(); }
        else if (msg.type === 'blink') this.animator.blink();
        else if (msg.type === 'action') PT.Actions.play(msg.id, msg, this.project);
        else if (msg.type === 'action-stop') PT.Actions.release(msg.id);
        else if (msg.type === 'reload-actions') location.reload();   // the editor is loading its action files again
        else if (msg.type === 'switch-out') {
          if (msg.test) PT.Transition.play();
          else { switching = true; PT.Transition.out(); }
        }
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
      this.checkForUpdate();
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
        window.open(url, 'easytuber-stage', 'width=960,height=540');
      };
      $('btnExport').onclick = async () => {
        const name = (this.project.name || 'easy-tuber').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        try {
          // one file with the pictures inside it, so it opens on any computer
          PT.download(`${name}.easytuber.json`, JSON.stringify(await PT.Storage.inlined(this.project)));
          PT.toast('Saved. Use "Open file" to load it again, on any computer.');
        } catch (e) { PT.toast('Could not save the file: ' + e.message, 'error', 8000); }
      };
      $('btnSheet').onclick = () => PT.SheetEditor.pick(this.selected && this.selected !== 'root' && PT.PART[this.selected].states.length > 1 ? this.selected : null);
      $('btnImport').onclick = () => $('importInput').click();
      $('importInput').onchange = async (e) => {
        const f = e.target.files[0]; e.target.value = '';
        if (!f) return;
        try {
          const data = JSON.parse(await f.text());
          if (!data || !data.parts) throw new Error('not an EASY-TUBER file');
          const missing = await PT.Storage.missingPictures(data);
          if (missing) throw new Error(`${missing} of its pictures are not in the file. It looks like the app's own working copy from another computer: use "Save file" there and open that file instead.`);
          await this.loadProject(PT.normalizeProject(data));
          PT.toast(`Loaded ${f.name}`);
        } catch (err) { PT.toast('Could not open file: ' + err.message, 'error'); }
      };
      $('btnReset').onclick = async () => {
        if (!confirm('Remove all avatars and uploaded images, and reset every setting?')) return;
        const kept = await this.backupNow('reset');
        await this.loadProject(PT.defaultProject());
        PT.toast(kept ? 'Reset to the placeholder character. The avatar you had is under Stage → Backups.' : 'Reset to the placeholder character.', '', kept ? 7000 : undefined);
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

      // actions (js/actions/*.js): the server plays them on every page, this one included
      PT.Actions.onError = (def, e) => PT.toast(`Action "${def.label}" stopped with an error: ${e.message}`, 'error', 8000);
      for (const f of this.actionLoad.failed) PT.toast(`Action file ${f.src.split('/').pop()} was skipped: ${f.message}`, 'error', 10000);
      // the server needs the actions (with their cooldowns) and the saved sequences to check and time requests
      this.sendCatalogNow = () => PT.Storage.setActions(PT.Actions.catalog(this.project), PT.Actions.savedSequences(this.project));
      this.sendCatalog = PT.debounce(this.sendCatalogNow, 300);
      this.sendCatalogNow();
      PT.Storage.onLive((msg) => {
        if (msg.type === 'action') PT.Actions.play(msg.id, msg, this.project);
        else if (msg.type === 'action-stop') PT.Actions.release(msg.id);
      });
      PT.Actions.onHeld = () => PT.Panels.syncHeld();

      // global hotkeys: registered by the desktop app, delivered here even while you're in a game
      PT.Storage.onHotkey((action) => PT.Avatars.handle(action));
      PT.Avatars.register();
      if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', () => PT.Panels.refreshDevices());
      }
      if (!window.isSecureContext) {
        PT.toast('Microphone needs a secure page. Close this tab, run start.bat and use the localhost address it opens.', 'warn', 10000);
      }
    },

    /* Once, when the editor starts: say so if a newer version is out. Off with the Stage tab setting. */
    async checkForUpdate() {
      if (this.stageMode || !PT.Storage.server || this.project.stage.updateNotice === false) return;
      const v = await PT.Storage.version(true);
      if (!v || !v.newer || !/^https:\/\/github\.com\//.test(v.url)) return;
      PT.toast(PT.el('span', {}, `EASY-TUBER ${v.latest} is out (you have ${v.current}). `,
        PT.el('a', { href: v.url, target: '_blank', rel: 'noopener' }, 'Get it')), '', 15000);
    },

    /* Keep a backup of the avatar as it is right now, before something replaces it.
       True if the avatar is safe in a backup (a new one, or one that already held exactly this). */
    async backupNow(reason) {
      if (!PT.Storage.server) return false;
      try {
        await PT.Storage.save(this.project);   // what is on screen, not what was saved half a second ago
        await PT.Storage.settled();
        await PT.Storage.makeBackup(reason);
        return true;
      } catch (e) { console.warn(e); return false; }
    },

    async restoreBackup(id) {
      try {
        const data = await PT.Storage.readBackup(id);
        if (!data || !data.parts) throw new Error('it is not an avatar file');
        const missing = await PT.Storage.missingPictures(data);
        await this.backupNow('restore');
        await this.loadProject(PT.normalizeProject(data));
        if (missing) PT.toast(`Backup restored, but ${missing} of its pictures are no longer in the images folder.`, 'warn', 9000);
        else PT.toast('Backup restored. The avatar you had before is in the list too.', '', 6000);
      } catch (e) { PT.toast('Could not restore the backup: ' + e.message, 'error', 8000); }
    },

    async loadProject(p) {
      await PT.Assets.loadProject(p);
      this.project = p;
      this.selected = null;
      PT.Editor.resetHistory();
      PT.Panels.syncers = [];
      PT.Panels.init();
      this.save();
      PT.Avatars.register();
      this.sendCatalog();   // the new project's cooldowns
    },

    // after an avatar switch put a different look on screen
    afterLookChange() {
      this.selected = null;
      this.previewStates = { eyes: 'open', mouth: 'closed' };
      PT.Editor.resetHistory();
      PT.Panels.renderPartList();
      PT.Panels.renderInspector();
      PT.Panels.renderStageTab();
      PT.Panels.renderAvatars();
    },

    /* Play an action here, in the stage window and in OBS. In the desktop app it goes through the
       same URL Streamer.bot uses, so a working Test means a working Streamer.bot setup. */
    async playAction(id) {
      const def = PT.Actions.get(id);
      if (!def) return;
      if (this.mode === 'edit') this.setMode('live');   // Edit shows the rest pose, without motion
      if (PT.Storage.server) {
        const url = new URL('api/streamerbot', location.href);
        url.searchParams.set('action', id);
        url.searchParams.set('force', '1');   // your own Test is never held back by a cooldown
        try { await PT.Storage.runActionUrl(url); } catch (e) { PT.toast('Could not play the action: ' + e.message, 'error'); }
        return;
      }
      // without the desktop app: this page and the stage window only. A held action is a switch.
      if (def.hold && PT.Actions.isHeld(id)) {
        PT.Actions.release(id);
        PT.Storage.post({ type: 'action-stop', id });
        return;
      }
      const msg = PT.Actions.newPlay(id);
      PT.Actions.play(id, msg, this.project);
      PT.Storage.post(msg);
    },

    // stop every action, held or not, on every page (and a sequence that is waiting)
    async stopActions() {
      if (PT.Storage.server) {
        const url = new URL('api/streamerbot', location.href);
        url.searchParams.set('stop', 'all');
        try { await PT.Storage.runActionUrl(url); } catch (e) { PT.toast('Could not stop the actions: ' + e.message, 'error'); }
        return;
      }
      PT.Actions.release();
      PT.Storage.post({ type: 'action-stop' });
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
      /* The screen may refresh 144 or 240 times a second; the avatar doesn't need to be worked out
         and drawn that often. Skipping frames that come too soon keeps it between 55 and 75 a second
         on fast screens, and changes nothing on a 60 Hz one. */
      if (now - this.last < FRAME_MIN_MS) { requestAnimationFrame((tt) => this.frame(tt)); return; }
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
      this.stepped = now;
      const act = PT.Actions.update(now, p);   // running actions: extra motion + eye / mouth overrides

      const editing = !this.stageMode && this.mode === 'edit';
      const showAct = !!act && !editing;        // Edit mode shows the rest pose only
      const R = this.renderer;
      R.resize();
      const pose = R.computePose(p, editing ? null : showAct ? PT.Actions.mergeDeltas(anim.deltas, act.deltas) : anim.deltas);
      this.lastPose = pose;
      if (showAct) PT.Actions.setPose(pose, R);
      R.clear(p, editing);
      if (showAct) PT.Actions.draw('behind', R);
      const switching = PT.Transition.active;
      const actFx = showAct && PT.Actions.hasPartFx;
      R.drawRig(p, pose, editing ? this.previewStates : showAct ? { ...anim.states, ...act.states } : anim.states, {
        dimPlaceholders: editing,
        onionPart: editing && p.stage.onion ? this.selected : null,
        fx: switching || actFx
          ? (id, t) => PT.Actions.combineFx(switching ? PT.Transition.fx(id, t) : null, actFx ? PT.Actions.partFx(id) : null)
          : null,
      });
      if (showAct) PT.Actions.draw('front', R);
      if (editing && !switching) PT.Editor.drawOverlay(pose);
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
